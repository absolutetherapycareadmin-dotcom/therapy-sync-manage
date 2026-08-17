import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const json = (body: unknown, status = 200) => Response.json(body, { status });

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

async function sendWhatsApp(req: Request) {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
  if (!accessToken || !phoneNumberId) return json({ error: "Paid WhatsApp provider is not configured" }, 503);

  const body = await req.json();
  const { to, message, communicationEventId, messageId } = body;
  if (!to || !message) return json({ error: "to and message are required" }, 400);

  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: message } }),
  });
  const providerBody = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: "WhatsApp provider rejected the message", provider: providerBody }, 502);

  const providerMessageId = providerBody?.messages?.[0]?.id ?? null;
  if (messageId) {
    await supabase.from("whatsapp_messages").update({ provider_message_id: providerMessageId, provider_status: "sent" }).eq("id", messageId);
  } else if (communicationEventId) {
    await supabase.from("whatsapp_messages").update({ provider_message_id: providerMessageId, provider_status: "sent" }).eq("communication_event_id", communicationEventId).eq("recipient_role", "parent");
  }
  return json({ ok: true, providerMessageId });
}

async function verifyAndProcessWebhook(req: Request) {
  const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (!verifyToken || url.searchParams.get("hub.verify_token") !== verifyToken) return new Response("Forbidden", { status: 403 });
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!appSecret) return json({ error: "Webhook verification secret is not configured" }, 503);

  const raw = await req.text();
  const supplied = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${await hmacSha256Hex(appSecret, raw)}`;
  if (!constantTimeEqual(supplied, expected)) return new Response("Forbidden", { status: 403 });

  const payload = JSON.parse(raw);
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const status of statuses) {
        const providerMessageId = status?.id;
        const eventType = status?.status;
        if (!providerMessageId || !eventType) continue;
        const { data: message } = await supabase.from("whatsapp_messages").select("id,clinic_id").eq("provider_message_id", providerMessageId).maybeSingle();
        await supabase.from("whatsapp_provider_events").upsert({ clinic_id: message?.clinic_id ?? null, provider_message_id: providerMessageId, event_type: eventType, payload: status, signature_valid: true }, { onConflict: "provider_message_id,event_type" });
        if (message?.id) {
          const update: Record<string, unknown> = { provider_status: eventType };
          if (eventType === "delivered") update.delivered_at = new Date().toISOString();
          if (eventType === "read") update.read_at = new Date().toISOString();
          await supabase.from("whatsapp_messages").update(update).eq("id", message.id);
        }
      }
    }
  }
  return json({ ok: true });
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/webhook")) return await verifyAndProcessWebhook(req);
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    return await sendWhatsApp(req);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
});
