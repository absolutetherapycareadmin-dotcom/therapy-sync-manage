import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const service = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

function normalizePhone(phone: string) {
  return phone.replace(/[^0-9+]/g, "");
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
    if (!accessToken || !phoneNumberId) {
      return Response.json({ error: "Paid WhatsApp provider is not configured" }, { status: 503 });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return Response.json({ error: "Authentication required" }, { status: 401 });

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return Response.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const { to, message, communicationEventId, messageId } = body;
    if (!to || !message || (!communicationEventId && !messageId)) {
      return Response.json({ error: "to, message and a communication event/message are required" }, { status: 400 });
    }

    const normalizedTo = normalizePhone(String(to));
    if (!/^\+?[0-9]{8,15}$/.test(normalizedTo)) {
      return Response.json({ error: "Invalid recipient phone number" }, { status: 400 });
    }

    let clinicId: string | null = null;
    let whatsappMessageId: string | null = messageId ?? null;

    if (communicationEventId) {
      const { data: event } = await userClient
        .from("communication_escalations")
        .select("id,clinic_id,appointment_id,status")
        .eq("id", communicationEventId)
        .maybeSingle();
      if (!event) return Response.json({ error: "Communication event not found or not accessible" }, { status: 404 });
      if (!["waiting_whatsapp", "waiting_sms", "waiting_call"].includes(event.status)) {
        return Response.json({ error: "Communication event is no longer active" }, { status: 409 });
      }
      clinicId = event.clinic_id;

      const { data: messageRow } = await userClient
        .from("whatsapp_messages")
        .select("id,clinic_id,phone,recipient_role")
        .eq("communication_event_id", communicationEventId)
        .eq("recipient_role", "parent")
        .maybeSingle();
      if (!messageRow) return Response.json({ error: "Parent WhatsApp message not found" }, { status: 404 });
      if (messageRow.clinic_id !== clinicId || normalizePhone(messageRow.phone) !== normalizedTo) {
        return Response.json({ error: "Recipient does not match the communication event" }, { status: 403 });
      }
      whatsappMessageId = messageRow.id;
    } else {
      const { data: messageRow } = await userClient
        .from("whatsapp_messages")
        .select("id,clinic_id,appointment_id,phone,recipient_role")
        .eq("id", messageId)
        .maybeSingle();
      if (!messageRow) return Response.json({ error: "WhatsApp message not found or not accessible" }, { status: 404 });
      if (messageRow.recipient_role !== "parent" || normalizePhone(messageRow.phone) !== normalizedTo) {
        return Response.json({ error: "Recipient does not match the parent message" }, { status: 403 });
      }
      clinicId = messageRow.clinic_id;
      whatsappMessageId = messageRow.id;
    }

    const { data: clinic } = await userClient
      .from("clinics")
      .select("id,whatsapp_mode")
      .eq("id", clinicId)
      .maybeSingle();
    if (!clinic || clinic.whatsapp_mode !== "paid_api") {
      return Response.json({ error: "Paid WhatsApp mode is not enabled for this centre" }, { status: 409 });
    }

    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedTo,
        type: "text",
        text: { body: String(message) },
      }),
    });
    const providerBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json({ error: "WhatsApp provider rejected the message", provider: providerBody }, { status: 502 });
    }

    const providerMessageId = providerBody?.messages?.[0]?.id ?? null;
    if (!providerMessageId) {
      return Response.json({ error: "WhatsApp provider returned no message id" }, { status: 502 });
    }

    const { error: updateError } = await service
      .from("whatsapp_messages")
      .update({ provider_message_id: providerMessageId, provider_status: "sent" })
      .eq("id", whatsappMessageId)
      .eq("clinic_id", clinicId)
      .eq("recipient_role", "parent");
    if (updateError) throw updateError;

    return Response.json({ ok: true, providerMessageId });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
});
