import { SmsBridge } from "@/integrations/smsBridge";
import { supabase } from "@/integrations/supabase/client";
import { isNativeDevice, normalizePhone } from "@/lib/deviceComms";

type RpcResponse<T> = { data: T; error: { message: string } | null };
// supabase.rpc reads `this.rest` internally, so it must stay bound to the client.
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<RpcResponse<unknown>>;

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
  status: "sent" | "failed" | "skipped";
  reason: string | null;
};

export type BatchRunResult = {
  batchId: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  items: BatchItemResult[];
};

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "WhatsApp automation error";
}

async function recordResult(itemId: string, status: BatchItemResult["status"], reason: string | null) {
  const { error } = await callRpc("record_whatsapp_automation_result", {
    p_item_id: itemId,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/**
 * Creates the batch server-side, then drains it one appointment at a time.
 * Each item is only marked "sent" after the Android automation confirms the
 * WhatsApp send action actually executed.
 */
export async function runWhatsAppBatch(
  appointmentIds: string[],
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<BatchRunResult> {
  const { data, error } = await callRpc("create_whatsapp_automation_batch", {
    p_appointment_ids: appointmentIds,
  });
  if (error) throw new Error(error.message);
  const batchId = data as string;

  // Recover anything left mid-flight by a previous interrupted run.
  await callRpc("release_stale_whatsapp_automation_items", { p_batch_id: batchId });

  const total = appointmentIds.length;
  let processed = 0;

  for (let guard = 0; guard < total + 5; guard += 1) {
    const claim = await callRpc("claim_whatsapp_automation_item", { p_batch_id: batchId });
    if (claim.error) throw new Error(claim.error.message);
    const item = (claim.data ?? { done: true }) as ClaimedItem;
    if (item.done || !item.item_id) break;

    processed += 1;
    onProgress?.(processed, total, item.child_name ?? "Parent");

    try {
      if (!isNativeDevice()) {
        throw new Error("Open the Therapy Care Android app to run WhatsApp automation.");
      }
      const outcome = await SmsBridge.sendWhatsApp({
        phone: normalizePhone(item.phone ?? ""),
        message: item.message ?? "",
      });
      if (outcome.sent) await recordResult(item.item_id, "sent", null);
      else await recordResult(item.item_id, "failed", outcome.reason ?? "WhatsApp send was not confirmed");
    } catch (err) {
      await recordResult(item.item_id, "failed", errorMessage(err)).catch(() => undefined);
    }
  }

  const { data: rows, error: rowsError } = await supabase
    .from("whatsapp_automation_items")
    .select("id,child_name,status,reason,position")
    .eq("batch_id", batchId)
    .order("position", { ascending: true });
  if (rowsError) throw rowsError;

  const items: BatchItemResult[] = (rows ?? []).map((r) => ({
    itemId: r.id,
    childName: r.child_name,
    status: (r.status === "sent" ? "sent" : r.status === "skipped" ? "skipped" : "failed") as
      | "sent"
      | "failed"
      | "skipped",
    reason: r.reason,
  }));

  return {
    batchId,
    total: items.length,
    sent: items.filter((i) => i.status === "sent").length,
    failed: items.filter((i) => i.status === "failed").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    items,
  };
}
