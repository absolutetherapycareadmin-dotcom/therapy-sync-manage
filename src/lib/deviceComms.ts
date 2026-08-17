import { Capacitor } from "@capacitor/core";

import { SmsBridge } from "@/integrations/smsBridge";
import { supabase } from "@/integrations/supabase/client";

/**
 * Normal SMS and normal cellular calls are executed only by the centre Android
 * device. The escalation state in Supabase is authoritative; queue workers
 * re-check it before handing a message/call to the device.
 */

export type SmsQueueRow = {
  id: string;
  appointment_id: string | null;
  communication_event_id: string | null;
  recipient_role: string;
  recipient_phone: string;
  message_type: string;
  message: string;
  scheduled_for: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
};

export type CallQueueRow = {
  id: string;
  appointment_id: string | null;
  communication_event_id: string | null;
  recipient_role: string;
  recipient_phone: string;
  call_type: string;
  scheduled_for: string;
  status: string;
  attempts: number;
  last_error: string | null;
  dialed_at: string | null;
  created_at: string;
};

export const MAX_ATTEMPTS = 3;

export function isNativeDevice() {
  return Capacitor.isNativePlatform();
}

export function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

export function isValidPhone(phone: string) {
  return /^\+?\d{8,15}$/.test(normalizePhone(phone));
}

export type DeviceCapabilities = {
  native: boolean;
  smsGranted: boolean;
  callGranted: boolean;
  telephony: boolean;
  reason?: string | undefined;
};

export async function deviceCapabilities(): Promise<DeviceCapabilities> {
  if (!isNativeDevice()) {
    return {
      native: false,
      smsGranted: false,
      callGranted: false,
      telephony: false,
      reason: "Open the Therapy Care Android app on the centre device to send SMS and place calls.",
    };
  }
  try {
    const sms = await SmsBridge.checkPermission();
    const call = await SmsBridge.checkCallPermission();
    return {
      native: true,
      smsGranted: sms.granted,
      callGranted: call.granted,
      telephony: sms.telephony,
      reason: sms.telephony ? undefined : "No SIM/telephony capability detected on this device.",
    };
  } catch (err) {
    return {
      native: true,
      smsGranted: false,
      callGranted: false,
      telephony: false,
      reason: err instanceof Error ? err.message : "Device bridge unavailable",
    };
  }
}

export async function requestSmsPermission() {
  if (!isNativeDevice()) throw new Error("Available only in the Therapy Care Android app.");
  await SmsBridge.requestPermission();
}

export async function requestCallPermission() {
  if (!isNativeDevice()) throw new Error("Available only in the Therapy Care Android app.");
  await SmsBridge.requestCallPermission();
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Unknown device error";
}

async function escalationIsActive(eventId: string | null, stage: "sms" | "call") {
  if (!eventId) return true;
  const { data, error } = await supabase
    .from("communication_escalations")
    .select("status,current_stage")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return stage === "sms"
    ? data?.status === "waiting_whatsapp" || data?.status === "waiting_sms"
    : data?.status === "waiting_call";
}

async function failSms(row: SmsQueueRow, message: string) {
  const attempts = row.attempts + 1;
  await supabase
    .from("sms_queue")
    .update({
      status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      attempts,
      last_error: message,
    })
    .eq("id", row.id)
    .eq("status", "sending");
}

/** Sends one queued SMS through the centre device. Safe to call repeatedly. */
export async function sendQueuedSms(row: SmsQueueRow) {
  if (!isValidPhone(row.recipient_phone)) {
    await supabase
      .from("sms_queue")
      .update({ status: "failed", last_error: "Invalid recipient phone number" })
      .eq("id", row.id);
    throw new Error("Invalid recipient phone number");
  }

  if (!(await escalationIsActive(row.communication_event_id, "sms"))) {
    await supabase
      .from("sms_queue")
      .update({ status: "cancelled", last_error: "Communication escalation is no longer active" })
      .eq("id", row.id)
      .eq("status", "queued");
    return { skipped: true as const };
  }

  const { data: claimed, error: claimError } = await supabase
    .from("sms_queue")
    .update({ status: "sending" })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) return { skipped: true as const };

  try {
    if (!(await escalationIsActive(row.communication_event_id, "sms"))) {
      await supabase.from("sms_queue").update({ status: "cancelled", last_error: "Communication escalation was cancelled" }).eq("id", row.id).eq("status", "sending");
      return { skipped: true as const };
    }
    if (!isNativeDevice()) throw new Error("SMS can only be sent from the centre's Android device.");
    const result = await SmsBridge.send({ phone: normalizePhone(row.recipient_phone), message: row.message });
    if (!result.queued) throw new Error("The device did not accept the SMS for sending.");

    const sentAt = new Date().toISOString();
    await supabase
      .from("sms_queue")
      .update({ status: "sent", attempts: row.attempts + 1, sent_at: sentAt, last_error: null })
      .eq("id", row.id);

    if (row.message_type === "escalation_fallback" && row.communication_event_id) {
      const { data: escalation, error: escalationError } = await supabase
        .from("communication_escalations")
        .select("id,appointment_id,status")
        .eq("id", row.communication_event_id)
        .maybeSingle();
      if (escalationError) throw escalationError;

      if (escalation?.status === "waiting_whatsapp" || escalation?.status === "waiting_sms") {
        const { data: clinic, error: clinicError } = await supabase
          .from("clinics")
          .select("call_enabled,sms_to_call_wait_minutes")
          .eq("id", (await supabase.from("sms_queue").select("clinic_id").eq("id", row.id).single()).data?.clinic_id ?? "")
          .maybeSingle();
        if (clinicError) throw clinicError;

        if (clinic?.call_enabled ?? true) {
          const callAt = new Date(new Date(sentAt).getTime() + Math.max(Number(clinic?.sms_to_call_wait_minutes ?? 15), 0) * 60000).toISOString();
          const { data: callRow, error: callError } = await supabase
            .from("call_queue")
            .insert({
              clinic_id: row.communication_event_id ? (await supabase.from("sms_queue").select("clinic_id").eq("id", row.id).single()).data?.clinic_id : null,
              appointment_id: escalation.appointment_id,
              communication_event_id: row.communication_event_id,
              recipient_role: "parent",
              recipient_phone: row.recipient_phone,
              call_type: "escalation",
              scheduled_for: callAt,
            } as never)
            .select("id,scheduled_for")
            .single();
          if (callError) throw callError;
          await supabase
            .from("communication_escalations")
            .update({ status: "waiting_call", current_stage: "call", call_queue_id: callRow.id, call_scheduled_for: callRow.scheduled_for })
            .eq("id", row.communication_event_id)
            .in("status", ["waiting_whatsapp", "waiting_sms"]);
        } else {
          await supabase
            .from("communication_escalations")
            .update({ status: "completed", current_stage: "completed", completed_at: sentAt })
            .eq("id", row.communication_event_id)
            .in("status", ["waiting_whatsapp", "waiting_sms"]);
        }
      }
    }

    return { skipped: false as const };
  } catch (err) {
    await failSms(row, errorMessage(err));
    throw err;
  }
}

/** Places one queued cellular call through the centre device. */
export async function placeQueuedCall(row: CallQueueRow) {
  if (!isValidPhone(row.recipient_phone)) {
    await supabase.from("call_queue").update({ status: "failed", last_error: "Invalid recipient phone number" }).eq("id", row.id);
    throw new Error("Invalid recipient phone number");
  }

  if (!(await escalationIsActive(row.communication_event_id, "call"))) {
    await supabase.from("call_queue").update({ status: "cancelled", last_error: "Communication escalation is no longer active" }).eq("id", row.id).eq("status", "queued");
    return { skipped: true as const };
  }

  const { data: claimed, error: claimError } = await supabase
    .from("call_queue")
    .update({ status: "dialing" })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) return { skipped: true as const };

  try {
    if (!(await escalationIsActive(row.communication_event_id, "call"))) {
      await supabase.from("call_queue").update({ status: "cancelled", last_error: "Communication escalation was cancelled" }).eq("id", row.id).eq("status", "dialing");
      return { skipped: true as const };
    }
    const phone = normalizePhone(row.recipient_phone);
    if (isNativeDevice()) {
      const result = await SmsBridge.call({ phone });
      if (!result.placed) throw new Error("The device did not place the call.");
    } else {
      window.location.href = `tel:${phone}`;
    }
    const dialedAt = new Date().toISOString();
    await supabase.from("call_queue").update({ status: "completed", attempts: row.attempts + 1, dialed_at: dialedAt, last_error: null }).eq("id", row.id);
    if (row.communication_event_id && row.call_type === "escalation") {
      await supabase.from("communication_escalations").update({ status: "completed", current_stage: "completed", completed_at: dialedAt }).eq("id", row.communication_event_id).eq("status", "waiting_call");
    }
    return { skipped: false as const };
  } catch (err) {
    const attempts = row.attempts + 1;
    await supabase.from("call_queue").update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "queued", attempts, last_error: errorMessage(err) }).eq("id", row.id).eq("status", "dialing");
    throw err;
  }
}

export type QueueRunResult = { processed: number; sent: number; failed: number; errors: string[] };

export async function processDueSmsQueue(clinicId: string, limit = 20): Promise<QueueRunResult> {
  const { data, error } = await supabase.from("sms_queue").select("*").eq("clinic_id", clinicId).eq("status", "queued").lte("scheduled_for", new Date().toISOString()).order("scheduled_for", { ascending: true }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as SmsQueueRow[];
  const result: QueueRunResult = { processed: 0, sent: 0, failed: 0, errors: [] };
  for (const row of rows) {
    result.processed += 1;
    try {
      const outcome = await sendQueuedSms(row);
      if (!outcome.skipped) result.sent += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(errorMessage(err));
    }
  }
  return result;
}

export async function processDueCallQueue(clinicId: string, limit = 5): Promise<QueueRunResult> {
  const { data, error } = await supabase.from("call_queue").select("*").eq("clinic_id", clinicId).eq("status", "queued").lte("scheduled_for", new Date().toISOString()).order("scheduled_for", { ascending: true }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CallQueueRow[];
  const result: QueueRunResult = { processed: 0, sent: 0, failed: 0, errors: [] };
  for (const row of rows) {
    result.processed += 1;
    try {
      const outcome = await placeQueuedCall(row);
      if (!outcome.skipped) result.sent += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(errorMessage(err));
    }
  }
  return result;
}
