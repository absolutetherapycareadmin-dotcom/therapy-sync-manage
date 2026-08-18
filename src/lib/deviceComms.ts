import { Capacitor } from "@capacitor/core";

import { SmsBridge } from "@/integrations/smsBridge";
import { supabase } from "@/integrations/supabase/client";

export type SmsQueueRow = {
  id: string; clinic_id: string; appointment_id: string | null; communication_event_id: string | null; recipient_role: string; recipient_phone: string; message_type: string; message: string; scheduled_for: string; status: string; attempts: number; last_error: string | null; sent_at: string | null; created_at: string;
};
export type CallQueueRow = {
  id: string; clinic_id: string; appointment_id: string | null; communication_event_id: string | null; recipient_role: string; recipient_phone: string; call_type: string; scheduled_for: string; status: string; attempts: number; last_error: string | null; dialed_at: string | null; created_at: string;
};
export const MAX_ATTEMPTS = 3;
type RpcResponse<T> = { data: T; error: { message: string } | null };
// supabase.rpc reads `this.rest` internally, so it must stay bound to the client.
const callRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResponse<unknown>>;

export function isNativeDevice() { return Capacitor.isNativePlatform(); }
export function normalizePhone(phone: string) { return phone.replace(/[^\d+]/g, ""); }
export function isValidPhone(phone: string) { return /^\+?\d{8,15}$/.test(normalizePhone(phone)); }
export type DeviceCapabilities = { native: boolean; smsGranted: boolean; callGranted: boolean; telephony: boolean; reason?: string | undefined };

export async function deviceCapabilities(): Promise<DeviceCapabilities> {
  if (!isNativeDevice()) return { native: false, smsGranted: false, callGranted: false, telephony: false, reason: "Open the Therapy Care Android app on the centre device to send SMS and place calls." };
  try {
    const sms = await SmsBridge.checkPermission(); const call = await SmsBridge.checkCallPermission();
    return { native: true, smsGranted: sms.granted, callGranted: call.granted, telephony: sms.telephony, reason: sms.telephony ? undefined : "No SIM/telephony capability detected on this device." };
  } catch (err) { return { native: true, smsGranted: false, callGranted: false, telephony: false, reason: err instanceof Error ? err.message : "Device bridge unavailable" }; }
}
export async function requestSmsPermission() { if (!isNativeDevice()) throw new Error("Available only in the Therapy Care Android app."); await SmsBridge.requestPermission(); }
export async function requestCallPermission() { if (!isNativeDevice()) throw new Error("Available only in the Therapy Care Android app."); await SmsBridge.requestCallPermission(); }
function errorMessage(err: unknown) { return err instanceof Error ? err.message : "Unknown device error"; }

async function withinWorkingHours(clinicId: string) {
  const { data, error } = await callRpc("is_communication_within_working_hours", { p_clinic_id: clinicId, p_at: new Date().toISOString() });
  if (error) throw new Error(error.message); return data === true;
}
async function selectedSubscriptionId(clinicId: string) {
  const { data, error } = await supabase.from("clinics").select("device_subscription_id").eq("id", clinicId).maybeSingle();
  if (error) throw error;
  const value = (data as { device_subscription_id?: number | null } | null)?.device_subscription_id;
  return typeof value === "number" && value > 0 ? value : undefined;
}
async function escalationIsActive(eventId: string | null, stage: "sms" | "call") {
  if (!eventId) return true;
  const { data, error } = await callRpc("get_communication_escalation_state", { p_escalation_id: eventId });
  if (error) throw new Error(error.message);
  const state = data as { status?: string } | null;
  return stage === "sms" ? state?.status === "waiting_whatsapp" || state?.status === "waiting_sms" : state?.status === "waiting_call";
}
async function failSms(row: SmsQueueRow, message: string) {
  const attempts = row.attempts + 1;
  await supabase.from("sms_queue").update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "queued", attempts, last_error: message }).eq("id", row.id).eq("status", "sending");
}

export async function processPendingInboundSmsResponses() {
  if (!isNativeDevice()) return { processed: 0, stopped: 0, ignored: 0, errors: [] as string[] };
  let pending: Awaited<ReturnType<typeof SmsBridge.getPendingInboundSms>>;
  try { pending = await SmsBridge.getPendingInboundSms(); } catch (err) { return { processed: 0, stopped: 0, ignored: 0, errors: [errorMessage(err)] }; }
  const result = { processed: 0, stopped: 0, ignored: 0, errors: [] as string[] };
  for (const sms of pending) {
    try {
      const { data, error } = await callRpc("process_parent_sms_response", { p_sender_phone: normalizePhone(sms.senderPhone), p_response_token: extractResponseToken(sms.message), p_message: sms.message });
      if (error) throw new Error(error.message);
      const outcome = data as { ok?: boolean; already_stopped?: boolean; reason?: string } | null;
      if (outcome?.ok) { result.processed += 1; if (!outcome.already_stopped) result.stopped += 1; await SmsBridge.acknowledgeInboundSms({ id: sms.id }); }
      else if (outcome?.reason === "unmatched_response" || outcome?.reason === "sender_mismatch" || outcome?.reason === "invalid_response") { result.ignored += 1; await SmsBridge.acknowledgeInboundSms({ id: sms.id }); }
      else throw new Error(outcome?.reason ?? "Parent SMS response was not processed");
    } catch (err) { result.errors.push(errorMessage(err)); }
  }
  return result;
}
function extractResponseToken(message: string) { const match = message.match(/(?:APPROVE|CANCEL|CHANGE)\s+([a-f0-9]{10})/i); return match?.[1] ?? ""; }

export async function sendQueuedSms(row: SmsQueueRow, subscriptionId?: number) {
  if (!isValidPhone(row.recipient_phone)) { await supabase.from("sms_queue").update({ status: "failed", last_error: "Invalid recipient phone number" }).eq("id", row.id); throw new Error("Invalid recipient phone number"); }
  if (!(await escalationIsActive(row.communication_event_id, "sms"))) { await supabase.from("sms_queue").update({ status: "cancelled", last_error: "Communication escalation is no longer active" }).eq("id", row.id).eq("status", "queued"); return { skipped: true as const }; }
  const { data: claimed, error: claimError } = await supabase.from("sms_queue").update({ status: "sending" }).eq("id", row.id).eq("status", "queued").select("id");
  if (claimError) throw claimError; if (!claimed || claimed.length === 0) return { skipped: true as const };
  try {
    if (!(await escalationIsActive(row.communication_event_id, "sms"))) { await supabase.from("sms_queue").update({ status: "cancelled", last_error: "Communication escalation was cancelled" }).eq("id", row.id).eq("status", "sending"); return { skipped: true as const }; }
    if (!(await withinWorkingHours(row.clinic_id))) { await supabase.from("sms_queue").update({ status: "queued", last_error: "Centre communication working hours are closed" }).eq("id", row.id).eq("status", "sending"); return { skipped: true as const }; }
    if (!isNativeDevice()) throw new Error("SMS can only be sent from the centre's Android device.");
    const result = await SmsBridge.send({ phone: normalizePhone(row.recipient_phone), message: row.message, ...(subscriptionId === undefined ? {} : { subscriptionId }) });
    if (!result.queued) throw new Error("The device did not accept the SMS for sending.");
    const sentAt = new Date().toISOString();
    await supabase.from("sms_queue").update({ status: "sent", attempts: row.attempts + 1, sent_at: sentAt, last_error: null }).eq("id", row.id);
    if (row.message_type === "escalation_fallback" && row.communication_event_id) {
      const { data, error } = await callRpc("advance_communication_after_sms", { p_escalation_id: row.communication_event_id, p_sent_at: sentAt });
      if (error) throw new Error(error.message); const resultState = data as { ok?: boolean; reason?: string } | null;
      if (resultState?.ok === false) throw new Error(resultState.reason ?? "Unable to advance communication escalation");
    }
    return { skipped: false as const };
  } catch (err) { await failSms(row, errorMessage(err)); throw err; }
}

export async function placeQueuedCall(row: CallQueueRow) {
  if (!isValidPhone(row.recipient_phone)) { await supabase.from("call_queue").update({ status: "failed", last_error: "Invalid recipient phone number" }).eq("id", row.id); throw new Error("Invalid recipient phone number"); }
  if (!(await escalationIsActive(row.communication_event_id, "call"))) { await supabase.from("call_queue").update({ status: "cancelled", last_error: "Communication escalation is no longer active" }).eq("id", row.id).eq("status", "queued"); return { skipped: true as const }; }
  const { data: claimed, error: claimError } = await supabase.from("call_queue").update({ status: "dialing" }).eq("id", row.id).eq("status", "queued").select("id");
  if (claimError) throw claimError; if (!claimed || claimed.length === 0) return { skipped: true as const };
  try {
    if (!(await escalationIsActive(row.communication_event_id, "call"))) { await supabase.from("call_queue").update({ status: "cancelled", last_error: "Communication escalation was cancelled" }).eq("id", row.id).eq("status", "dialing"); return { skipped: true as const }; }
    if (!(await withinWorkingHours(row.clinic_id))) { await supabase.from("call_queue").update({ status: "queued", last_error: "Centre communication working hours are closed" }).eq("id", row.id).eq("status", "dialing"); return { skipped: true as const }; }
    const phone = normalizePhone(row.recipient_phone);
    if (isNativeDevice()) { const result = await SmsBridge.call({ phone }); if (!result.placed) throw new Error("The device did not place the call."); }
    else window.location.href = `tel:${phone}`;
    const dialedAt = new Date().toISOString();
    await supabase.from("call_queue").update({ status: "completed", attempts: row.attempts + 1, dialed_at: dialedAt, last_error: null }).eq("id", row.id);
    if (row.communication_event_id && row.call_type === "escalation") {
      const { data, error } = await callRpc("complete_communication_after_call", { p_escalation_id: row.communication_event_id, p_dialed_at: dialedAt });
      if (error) throw new Error(error.message); if (data !== true) throw new Error("Communication escalation was no longer waiting for the final call");
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
  await processPendingInboundSmsResponses(); if (!(await withinWorkingHours(clinicId))) return { processed: 0, sent: 0, failed: 0, errors: [] };
  const subscriptionId = await selectedSubscriptionId(clinicId);
  const { data, error } = await supabase.from("sms_queue").select("*").eq("clinic_id", clinicId).eq("status", "queued").lte("scheduled_for", new Date().toISOString()).order("scheduled_for", { ascending: true }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as SmsQueueRow[]; const result: QueueRunResult = { processed: 0, sent: 0, failed: 0, errors: [] };
  for (const row of rows) { result.processed += 1; try { const outcome = await sendQueuedSms(row, subscriptionId); if (!outcome.skipped) result.sent += 1; } catch (err) { result.failed += 1; result.errors.push(errorMessage(err)); } }
  return result;
}
export async function processDueCallQueue(clinicId: string, limit = 5): Promise<QueueRunResult> {
  await processPendingInboundSmsResponses(); if (!(await withinWorkingHours(clinicId))) return { processed: 0, sent: 0, failed: 0, errors: [] };
  const { data, error } = await supabase.from("call_queue").select("*").eq("clinic_id", clinicId).eq("status", "queued").lte("scheduled_for", new Date().toISOString()).order("scheduled_for", { ascending: true }).limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CallQueueRow[]; const result: QueueRunResult = { processed: 0, sent: 0, failed: 0, errors: [] };
  for (const row of rows) { result.processed += 1; try { const outcome = await placeQueuedCall(row); if (!outcome.skipped) result.sent += 1; } catch (err) { result.failed += 1; result.errors.push(errorMessage(err)); } }
  return result;
}
