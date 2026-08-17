import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function hmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

serve(async (req) => {
  try {
    const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
    const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
    const configuredPhoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const url = new URL(req.url);

    if (req.method === "GET") {
      if (!verifyToken || url.searchParams.get("hub.verify_token") !== verifyToken) return new Response("Forbidden", { status: 403 });
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (!appSecret) return Response.json({ error: "Webhook verification secret is not configured" }, { status: 503 });

    const raw = await req.text();
    const supplied = req.headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${await hmacSha256Hex(appSecret, raw)}`;
    if (!constantTimeEqual(supplied, expected)) return new Response("Forbidden", { status: 403 });

    const payload = JSON.parse(raw);
    for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value;
        const incomingPhoneNumberId = value?.metadata?.phone_number_id;
        if (configuredPhoneNumberId && incomingPhoneNumberId && incomingPhoneNumberId !== configuredPhoneNumberId) continue;

        for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
          const providerMessageId = status?.id;
          const eventType = status?.status;
          if (!providerMessageId || !eventType) continue;

          const { data: message } = await supabase
            .from("whatsapp_messages")
            .select("id,clinic_id")
            .eq("provider_message_id", providerMessageId)
            .maybeSingle();

          // Never create an audit record for a provider id that the application did not send.
          if (!message?.id || !message.clinic_id) continue;

          await supabase.from("whatsapp_provider_events").upsert(
            {
              clinic_id: message.clinic_id,
              provider_message_id: providerMessageId,
              event_type: eventType,
              payload: status,
              signature_valid: true,
            },
            { onConflict: "provider_message_id,event_type" },
          );

          const update: Record<string, unknown> = { provider_status: eventType };
          if (eventType === "delivered") update.delivered_at = new Date().toISOString();
          if (eventType === "read") update.read_at = new Date().toISOString();
          await supabase
            .from("whatsapp_messages")
            .update(update)
            .eq("id", message.id)
            .eq("clinic_id", message.clinic_id);
        }
      }
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }
});
