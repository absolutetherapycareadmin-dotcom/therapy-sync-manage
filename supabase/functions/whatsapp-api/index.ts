import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
    if (!accessToken || !phoneNumberId) return Response.json({ error: "Paid WhatsApp provider is not configured" }, { status: 503 });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return Response.json({ error: "Authentication required" }, { status: 401 });
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return Response.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const { to, message, communicationEventId, messageId } = body;
    if (!to || !message || (!communicationEventId && !messageId)) return Response.json({ error: "to, message and a communication event/message are required" }, { status: 400 });

    let clinicId: string | null = null;
    if (communicationEventId) {
      const { data: event } = await userClient.from("communication_escalations").select("id,clinic_id").eq("id", communicationEventId).maybeSingle();
      if (!event) return Response.json({ error: "Communication event not found or not accessible" }, { status: 404 });
      clinicId = event.clinic_id;
    } else {
      const { data: messageRow } = await userClient.from("whatsapp_messages").select("id,clinic_id,communication_event_id").eq("id", messageId).maybeSingle();
      if (!messageRow) return Response.json({ error: "WhatsApp message not found or not accessible" }, { status: 404 });
      clinicId = messageRow.clinic_id;
    }

    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: message } }),
    });
    const providerBody = await response.json().catch(() => ({}));
    if (!response.ok) return Response.json({ error: "WhatsApp provider rejected the message", provider: providerBody }, { status: 502 });
    const providerMessageId = providerBody?.messages?.[0]?.id ?? null;
    if (messageId) await service.from("whatsapp_messages").update({ provider_message_id: providerMessageId, provider_status: "sent" }).eq("id", messageId).eq("clinic_id", clinicId);
    else if (communicationEventId) await service.from("whatsapp_messages").update({ provider_message_id: providerMessageId, provider_status: "sent" }).eq("communication_event_id", communicationEventId).eq("clinic_id", clinicId).eq("recipient_role", "parent");
    return Response.json({ ok: true, providerMessageId });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
});
