import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(url, serviceRoleKey);

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(-10)}`;
  return digits;
}

function retryable(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function providerSend(to: string, message: string) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
  if (!accessToken || !phoneNumberId) throw new Error("Paid WhatsApp provider is not configured");

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: message },
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const dispatchSecret = req.headers.get("x-whatsapp-dispatch-secret") ?? "";
    const { data: authorized, error: authError } = await supabase.rpc("verify_whatsapp_dispatch_secret", { p_secret: dispatchSecret });
    if (authError || authorized !== true) return new Response("Forbidden", { status: 403 });

    const { error: prepareError } = await supabase.rpc("prepare_appointment_whatsapp_notifications", { p_limit: 100 });
    if (prepareError) throw prepareError;

    const { data: candidates, error: candidateError } = await supabase
      .from("whatsapp_messages")
      .select("id,clinic_id,appointment_id,communication_event_id,phone,message,scheduled_for,attempts")
      .eq("status", "queued")
      .lte("scheduled_for", new Date().toISOString())
      .not("communication_event_id", "is", null)
      .eq("recipient_role", "parent")
      .eq("message_type", "appointment_confirmation")
      .order("scheduled_for", { ascending: true })
      .limit(50);
    if (candidateError) throw candidateError;

    const result = { prepared: 0, sent: 0, skipped: 0, failed: 0, retried: 0, errors: [] as string[] };

    for (const row of candidates ?? []) {
      const { data: clinic, error: clinicError } = await supabase
        .from("clinics")
        .select("id,whatsapp_mode")
        .eq("id", row.clinic_id)
        .maybeSingle();
      if (clinicError) throw clinicError;
      if (!clinic || clinic.whatsapp_mode !== "paid_api") {
        result.skipped += 1;
        continue;
      }

      const { data: event, error: eventError } = await supabase
        .from("communication_escalations")
        .select("id,status")
        .eq("id", row.communication_event_id)
        .maybeSingle();
      if (eventError) throw eventError;
      if (!event || !["waiting_whatsapp", "waiting_sms", "waiting_call"].includes(event.status)) {
        await supabase.from("whatsapp_messages").update({ status: "superseded", error_message: "Communication event is no longer active" }).eq("id", row.id).eq("status", "queued");
        result.skipped += 1;
        continue;
      }

      const { data: claimed, error: claimError } = await supabase
        .from("whatsapp_messages")
        .update({ status: "sending", attempts: (row.attempts ?? 0) + 1, last_attempt_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id,attempts");
      if (claimError) throw claimError;
      if (!claimed?.length) {
        result.skipped += 1;
        continue;
      }

      const phone = normalizePhone(String(row.phone ?? ""));
      if (!/^\d{8,15}$/.test(phone)) {
        await supabase.from("whatsapp_messages").update({ status: "failed", error_message: "Invalid recipient phone number" }).eq("id", row.id).eq("status", "sending");
        result.failed += 1;
        continue;
      }
      if (!String(row.message ?? "").trim()) {
        await supabase.from("whatsapp_messages").update({ status: "failed", error_message: "Message cannot be empty" }).eq("id", row.id).eq("status", "sending");
        result.failed += 1;
        continue;
      }

      try {
        const { response, body } = await providerSend(phone, String(row.message));
        if (!response.ok) {
          const message = `WhatsApp provider rejected the message (HTTP ${response.status})`;
          const attempts = Number(claimed[0]?.attempts ?? 1);
          if (retryable(response.status) && attempts < 3) {
            await supabase.from("whatsapp_messages").update({ status: "queued", scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString(), error_message: message }).eq("id", row.id).eq("status", "sending");
            result.retried += 1;
          } else {
            await supabase.from("whatsapp_messages").update({ status: "failed", error_message: message, metadata: { provider_error: body } }).eq("id", row.id).eq("status", "sending");
            result.failed += 1;
          }
          result.errors.push(message);
          continue;
        }

        const providerMessageId = body?.messages?.[0]?.id;
        if (!providerMessageId) {
          await supabase.from("whatsapp_messages").update({ status: "failed", error_message: "WhatsApp provider returned no message id" }).eq("id", row.id).eq("status", "sending");
          result.failed += 1;
          continue;
        }

        const sentAt = new Date().toISOString();
        const { error: updateError } = await supabase.from("whatsapp_messages").update({
          status: "sent",
          sent_at: sentAt,
          provider_message_id: providerMessageId,
          provider_status: "sent",
          error_message: null,
        }).eq("id", row.id).eq("status", "sending");
        if (updateError) throw updateError;
        result.sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "WhatsApp provider request failed";
        const attempts = Number(claimed[0]?.attempts ?? 1);
        if (attempts < 3) {
          await supabase.from("whatsapp_messages").update({ status: "queued", scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString(), error_message: message }).eq("id", row.id).eq("status", "sending");
          result.retried += 1;
        } else {
          await supabase.from("whatsapp_messages").update({ status: "failed", error_message: message }).eq("id", row.id).eq("status", "sending");
          result.failed += 1;
        }
        result.errors.push(message);
      }
    }

    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "WhatsApp dispatch failed" }, { status: 500 });
  }
});
