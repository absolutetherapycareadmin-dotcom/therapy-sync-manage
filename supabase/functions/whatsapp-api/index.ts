import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
    if (!accessToken || !phoneNumberId) return Response.json({ error: "Paid WhatsApp provider is not configured" }, { status: 503 });
    const body = await req.json();
    const { to, message, communicationEventId, messageId } = body;
    if (!to || !message) return Response.json({ error: "to and message are required" }, { status: 400 });
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: message } }),
    });
    const providerBody = await response.json().catch(() => ({}));
    if (!response.ok) return Response.json({ error: "WhatsApp provider rejected the message", provider: providerBody }, { status: 502 });
    const providerMessageId = providerBody?.messages?.[0]?.id ?? null;
    if (messageId) await supabase.from("whatsapp_messages").update({ provider_message_id: providerMessageId, provider_status: "sent" }).eq("id", messageId);
    else if (communicationEventId) await supabase.from("whatsapp_messages").update({ provider_message_id: providerMessageId, provider_status: "sent" }).eq("communication_event_id", communicationEventId).eq("recipient_role", "parent");
    return Response.json({ ok: true, providerMessageId });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
});
