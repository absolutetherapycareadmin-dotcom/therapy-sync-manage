import { registerPlugin } from "@capacitor/core";

export type SmsSubscription = {
  subscriptionId: number;
  slotIndex: number;
  displayName: string;
  carrierName: string;
};

export interface SmsBridgePlugin {
  checkPermission(): Promise<{ granted: boolean; inboundGranted: boolean; telephony: boolean }>;
  requestPermission(): Promise<void>;
  send(options: { phone: string; message: string; subscriptionId?: number }): Promise<{ queued: boolean; phone: string; subscriptionId?: number }>;
  schedule(options: { phone: string; message: string; atEpochMs: number; subscriptionId?: number }): Promise<{ scheduled: boolean; atEpochMs: number; requestCode: number }>;
  checkCallPermission(): Promise<{ granted: boolean; telephony: boolean }>;
  requestCallPermission(): Promise<void>;
  call(options: { phone: string }): Promise<{ placed: boolean; mode: "call" | "dialer" }>;
  getActiveSubscriptions(): Promise<SmsSubscription[]>;
  getPendingInboundSms(): Promise<Array<{ id: string; senderPhone: string; message: string; receivedAt: number }>>;
  acknowledgeInboundSms(options: { id: string }): Promise<void>;
  /** Opens the normal WhatsApp app for this chat and confirms whether the send action executed. */
  sendWhatsApp(options: {
    phone: string;
    message: string;
    timeoutMs?: number;
  }): Promise<{ sent: boolean; reason?: string }>;
}

export const SmsBridge = registerPlugin<SmsBridgePlugin>("SmsBridge");
