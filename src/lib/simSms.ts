import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

export type SmsPayload = {
  id: string;
  recipientPhone: string;
  message: string;
};

type NativeSmsBridge = {
  send: (payload: { phoneNumber: string; message: string }) => Promise<{ sent: boolean }>;
};

const BRIDGE_NAME = 'TherapyCareSms';

function nativeBridge(): NativeSmsBridge | null {
  if (!Capacitor.isNativePlatform()) return null;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, NativeSmsBridge> } }).Capacitor?.Plugins;
  return plugins?.[BRIDGE_NAME] ?? null;
}

export async function sendSmsViaJioSim(payload: SmsPayload) {
  const bridge = nativeBridge();
  if (!bridge) {
    throw new Error('SIM SMS is available only in the Therapy Care Android APK.');
  }

  const result = await bridge.send({
    phoneNumber: payload.recipientPhone,
    message: payload.message,
  });

  if (!result.sent) throw new Error('Android SIM SMS was not accepted for sending.');

  await supabase
    .from('sms_queue')
    .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', payload.id);
}

export async function processDueSmsQueue(limit = 20) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('sms_queue')
    .select('id, recipient_phone, message')
    .eq('status', 'queued')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (error) throw error;

  for (const row of data ?? []) {
    try {
      await supabase.from('sms_queue').update({ status: 'sending', attempts: 1, updated_at: new Date().toISOString() }).eq('id', row.id);
      await sendSmsViaJioSim({ id: row.id, recipientPhone: row.recipient_phone, message: row.message });
    } catch (err) {
      await supabase.from('sms_queue').update({
        status: 'failed',
        last_error: err instanceof Error ? err.message : 'Unknown SMS error',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    }
  }
}
