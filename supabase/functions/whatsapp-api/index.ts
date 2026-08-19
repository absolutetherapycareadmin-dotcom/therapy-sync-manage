import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(-10)}`;
  return digits;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";
    if (!accessToken || !phoneNumberId) return Response.json({ error: "Paid WhatsApp provider is not configured" }, { status: 503 });

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
    if (!to || (!communicationEventId && !messageId)) return Response.json({ error: "A communication event or message is required" }, { status: 400 });

    let clinicId: string | null = null;
    let whatsappMessageId: string | null = messageId ?? null;
    let storedMessage: string | null = null;
    let storedPhone: string | null = null;
    let appointmentMessage = false;

    if (communicationEventId) {
      const { data: event } = await userClient.from("communication_escalations").select("id,clinic_id,appointment_id,status").eq("id", communicationEventId).maybeSingle();
      if (!event) return Response.json({ error: "Communication event not found or not accessible" }, { status: 404 });
      if (!["waiting_whatsapp", "waiting_sms", "waiting_call"].includes(event.status)) return Response.json({ error: "Communication event is no longer active" }, { status: 409 });
      clinicId = event.clinic_id;

      const { data: appointment } = await userClient.from("appointments").select("id,status").eq("id", event.appointment_id).maybeSingle();
      if (!appointment || appointment.status === "cancelled") return Response.json({ error: "Appointment is cancelled or unavailable" }, { status: 409 });

      const { data: messageRow } = await userClient.from("whatsapp_messages").select("id,clinic_id,phone,message,recipient_role,status,scheduled_for,appointment_id").eq("communication_event_id", communicationEventId).eq("recipient_role", "parent").maybeSingle();
      if (!messageRow) return Response.json({ error: "Parent WhatsApp message not found" }, { status: 404 });
      if (messageRow.clinic_id !== clinicId) return Response.json({ error: "Message is outside the authorized centre" }, { status: 403 });
      if (new Date(messageRow.scheduled_for).getTime() > Date.now()) return Response.json({ error: "Appointment WhatsApp notification is not due yet" }, { status: 409 });
      whatsappMessageId = messageRow.id;
      storedMessage = messageRow.message;
      storedPhone = messageRow.phone;
      appointmentMessage = !!messageRow.appointment_id;
    } else {
      const { data: messageRow } = await userClient.from("whatsapp_messages").select("id,clinic_id,appointment_id,phone,message,recipient_role,status,scheduled_for").eq("id", messageId).maybeSingle();
      if (!messageRow) return Response.json({ error: "WhatsApp message not found or not accessible" }, { status: 404 });
      if (messageRow.recipient_role !== "parent") return Response.json({ error: "Only parent WhatsApp messages may use this endpoint" }, { status: 403 });
      clinicId = messageRow.clinic_id;
      whatsappMessageId = messageRow.id;
      storedMessage = messageRow.message;
      storedPhone = messageRow.phone;
      appointmentMessage = !!messageRow.appointment_id;
      if (appointmentMessage && new Date(messageRow.scheduled_for).getTime() > Date.now()) return Response.json({ error: "Appointment WhatsApp notification is not due yet" }, { status: 409 });
    }

    const { data: clinic } = await userClient.from("clinics").select("id,whatsapp_mode").eq("id", clinicId).maybeSingle();
    if (!clinic || clinic.whatsapp_mode !== "paid_api") return Response.json({ error: "Paid WhatsApp mode is not enabled for this centre" }, { status: 409 });

    const normalizedTo = normalizePhone(String(to));
    const normalizedStoredPhone = normalizePhone(String(storedPhone ?? ""));
    if (!/^\d{8,15}$/.test(normalizedTo) || normalizedTo !== normalizedStoredPhone) return Response.json({ error: "Recipient does not match the authorized parent phone" }, { status: 403 });
    const outgoingMessage = String(storedMessage ?? message ?? "").trim();
    if (!outgoingMessage) return Response.json({ error: "Message cannot be empty" }, { status: 400 });

    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: normalizedTo, type: "text", text: { body: outgoingMessage } }),
    });
    const providerBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      await service.from("whatsapp_messages").update({ status: "failed", error_message: `WhatsApp provider rejected the message (HTTP ${response.status})` }).eq("id", whatsappMessageId).eq("clinic_id", clinicId);
      return Response.json({ error: "WhatsApp provider rejected the message", provider: providerBody }, { status: 502 });
    }

    const providerMessageId = providerBody?.messages?.[0]?.id ?? null;
    if (!providerMessageId) {
      await service.from("whatsapp_messages").update({ status: "failed", error_message: "WhatsApp provider returned no message id" }).eq("id", whatsappMessageId).eq("clinic_id", clinicId);
      return Response.json({ error: "WhatsApp provider returned no message id" }, { status: 502 });
    }

    const sentAt = new Date().toISOString();
    const { error: updateError } = await service.from("whatsapp_messages").update({ status: "sent", sent_at: sentAt, provider_message_id: providerMessageId, provider_status: "sent", error_message: null }).eq("id", whatsappMessageId).eq("clinic_id", clinicId).eq("recipient_role", "parent");
    if (updateError) throw updateError;

    return Response.json({ ok: true, providerMessageId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
});
