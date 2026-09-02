import { supabase } from "@/integrations/supabase/client";

type RpcResponse<T> = { data: T; error: { message: string } | null };
// supabase.rpc reads `this.rest` internally, so it must stay bound to the client.
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<RpcResponse<unknown>>;

/** Honest per-appointment states — nothing is "confirmed" until the admin says so. */
export type ItemStatus = "queued" | "processing" | "opened" | "confirmed" | "failed" | "skipped";

export type ClaimedItem = {
  done: boolean;
  item_id?: string;
  appointment_id?: string;
  child_name?: string | null;
  parent_name?: string | null;
  phone?: string;
  message?: string;
};

export type BatchItemResult = {
  itemId: string | null;
  childName: string | null;
  status: ItemStatus;
  reason: string | null;
};

export type BatchRunResult = {
  batchId: string;
  total: number;
  confirmed: number;
  failed: number;
  skipped: number;
  items: BatchItemResult[];
};

export function normalizeWhatsAppPhone(phone: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(-10)}`;
  return digits;
}

export function whatsappDeepLink(phone: string, message: string) {
  return `https://wa.me/${normalizeWhatsAppPhone(phone)}?text=${encodeURIComponent(message)}`;
}

/** Prepares (or refreshes) the parent WhatsApp message + single-use action links. */
export async function prepareAppointmentWhatsApp(appointmentId: string, baseUrl: string) {
  const { data, error } = await callRpc("ensure_appointment_whatsapp", {
    p_appointment_id: appointmentId,
    p_base_url: baseUrl,
  });
  if (error) throw new Error(error.message);
  return (data ?? { ok: false, reason: "No response" }) as {
    ok: boolean;
    reason?: string;
    message?: string;
    phone?: string;
  };
}

export async function createWhatsAppBatch(appointmentIds: string[]) {
  const { data, error } = await callRpc("create_whatsapp_automation_batch", {
    p_appointment_ids: appointmentIds,
  });
  if (error) throw new Error(error.message);
  const batchId = data as string;
  await callRpc("release_stale_whatsapp_automation_items", { p_batch_id: batchId });
  return batchId;
}

export async function claimNextItem(batchId: string): Promise<ClaimedItem> {
  const { data, error } = await callRpc("claim_whatsapp_automation_item", { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  return (data ?? { done: true }) as ClaimedItem;
}

export async function recordItemResult(
  itemId: string,
  status: "opened" | "confirmed" | "failed" | "skipped",
  reason: string | null,
) {
  const { error } = await callRpc("record_whatsapp_automation_result", {
    p_item_id: itemId,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function fetchBatchResult(batchId: string): Promise<BatchRunResult> {
  const { data, error } = await supabase
    .from("whatsapp_automation_items")
    .select("id,child_name,status,reason,position")
    .eq("batch_id", batchId)
    .order("position", { ascending: true });
  if (error) throw error;

  const items: BatchItemResult[] = (data ?? []).map((r) => ({
    itemId: r.id,
    childName: r.child_name,
    status: r.status as ItemStatus,
    reason: r.reason,
  }));

  return {
    batchId,
    total: items.length,
    confirmed: items.filter((i) => i.status === "confirmed").length,
    failed: items.filter((i) => i.status === "failed").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    items,
  };
}
