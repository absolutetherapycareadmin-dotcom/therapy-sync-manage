import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type AppointmentAction = "confirm_appointment" | "cancel_appointment" | "reschedule_appointment";

type AppointmentRow = {
  id: string;
  clinic_id: string;
  child_id: string;
  therapist_id: string | null;
  room_id: string | null;
  specialty: string | null;
  appointment_date: string;
  start_time: string;
  duration_minutes: number;
  session_fee: number | null;
  status: string;
  parent_confirmation_status: string;
};

type ChildRow = {
  id: string;
  full_name: string;
  parent_name: string | null;
  parent_phone: string | null;
};

type TherapistRow = {
  id: string;
  full_name: string;
  phone: string | null;
};

type RoomRow = { id: string; name: string };

type ClinicRow = { id: string; name: string; currency: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${value}T00:00:00+05:30`));
}

function formatTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function feeText(fee: number | null, currency: string) {
  return fee == null ? "Not specified" : new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(fee);
}

function secretKey() {
  const named = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (named) return JSON.parse(named).default as string;
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function publishableKey() {
  const named = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (named) return JSON.parse(named).default as string;
  return Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

function userClient(req: Request) {
  return createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Authentication required");
  const client = userClient(req);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid authentication token");
  return data.user;
}

async function assertClinicAccess(admin: SupabaseClient, userId: string, clinicId: string) {
  const { data, error } = await admin.from("profiles").select("clinic_id").eq("id", userId).maybeSingle();
  if (error || data?.clinic_id !== clinicId) throw new Error("Clinic access denied");
}

async function loadAppointment(admin: SupabaseClient, appointmentId: string) {
  const { data: appointment, error } = await admin.from("appointments").select("*").eq("id", appointmentId).maybeSingle<AppointmentRow>();
  if (error || !appointment) throw new Error("Appointment not found");

  const [{ data: child }, { data: therapist }, { data: room }, { data: clinic }] = await Promise.all([
    admin.from("children").select("id,full_name,parent_name,parent_phone").eq("id", appointment.child_id).maybeSingle<ChildRow>(),
    appointment.therapist_id ? admin.from("therapists").select("id,full_name,phone").eq("id", appointment.therapist_id).maybeSingle<TherapistRow>() : Promise.resolve({ data: null }),
    appointment.room_id ? admin.from("rooms").select("id,name").eq("id", appointment.room_id).maybeSingle<RoomRow>() : Promise.resolve({ data: null }),
    admin.from("clinics").select("id,name,currency").eq("id", appointment.clinic_id).maybeSingle<ClinicRow>(),
  ]);

  if (!child) throw new Error("Child record not found");
  if (!clinic) throw new Error("Clinic record not found");
  return { appointment, child, therapist: therapist ?? null, room: room ?? null, clinic };
}

async function sendTemplate(phone: string, templateName: string, languageCode: string, bodyParams: string[], buttonPayloads: string[]) {
  const token = Deno.env.get("META_WA_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("META_WA_PHONE_NUMBER_ID");
  const apiVersion = Deno.env.get("META_WA_API_VERSION") ?? "v23.0";
  if (!token || !phoneNumberId) throw new Error("Meta WhatsApp credentials are not configured");

  const components: Array<Record<string, unknown>> = [];
  if (bodyParams.length) {
    components.push({
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    });
  }
  buttonPayloads.forEach((payload, index) => {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{ type: "payload", payload }],
    });
  });

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message ?? `WhatsApp API failed with ${response.status}`;
    const error = new Error(message);
    (error as Error & { providerPayload?: unknown }).providerPayload = payload;
    throw error;
  }

  return payload?.messages?.[0]?.id as string | undefined;
}

async function recordMessage(admin: SupabaseClient, values: Record<string, unknown>) {
  const { data, error } = await admin.from("whatsapp_messages").insert(values).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function appointmentCreated(admin: SupabaseClient, appointmentId: string, userId?: string) {
  const { appointment, child, therapist, room, clinic } = await loadAppointment(admin, appointmentId);
  if (userId) await assertClinicAccess(admin, userId, appointment.clinic_id);

  const phone = normalizePhone(child.parent_phone);
  if (phone.length < 8) {
    const id = await recordMessage(admin, {
      clinic_id: appointment.clinic_id,
      child_id: appointment.child_id,
      appointment_id: appointment.id,
      recipient_name: child.parent_name,
      phone: child.parent_phone ?? "",
      message: "Parent phone number is missing or invalid.",
      message_type: "appointment_confirmation",
      recipient_role: "parent",
      status: "failed",
      error_code: "INVALID_PARENT_PHONE",
      error_message: "Parent phone number is missing or invalid.",
      metadata: { mode: "live" },
    });
    return { id, status: "failed" };
  }

  const mode = Deno.env.get("WHATSAPP_MODE") ?? "mock";
  const templateName = Deno.env.get("WHATSAPP_APPOINTMENT_TEMPLATE") ?? "therapy_care_appointment_confirmation";
  const languageCode = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en_US";
  const bodyParams = [
    child.parent_name ?? "Parent",
    child.full_name,
    formatDate(appointment.appointment_date),
    formatTime(appointment.start_time),
    therapist?.full_name ?? "To be assigned",
    appointment.specialty ?? "Therapy session",
    room?.name ?? "To be assigned",
    feeText(appointment.session_fee, clinic.currency),
  ];
  const message = `Therapy Care – Appointment Confirmation\n\nHello ${bodyParams[0]},\n\n${bodyParams[1]}'s therapy appointment has been scheduled.\n\n📅 Date: ${bodyParams[2]}\n⏰ Time: ${bodyParams[3]}\n🧑‍⚕️ Therapist: ${bodyParams[4]}\n🧩 Therapy: ${bodyParams[5]}\n🏠 Room: ${bodyParams[6]}\n💰 Session Fee: ${bodyParams[7]}\n\nPlease confirm your appointment.`;

  if (mode !== "live") {
    const id = await recordMessage(admin, {
      clinic_id: appointment.clinic_id,
      child_id: appointment.child_id,
      appointment_id: appointment.id,
      recipient_name: child.parent_name,
      phone,
      message,
      message_type: "appointment_confirmation",
      recipient_role: "parent",
      status: "mocked",
      sent_at: new Date().toISOString(),
      metadata: { mode: "mock", actions: ["confirm_appointment", "cancel_appointment", "reschedule_appointment"] },
    });
    return { id, status: "mocked" };
  }

  try {
    const providerMessageId = await sendTemplate(phone, templateName, languageCode, bodyParams, ["confirm_appointment", "cancel_appointment", "reschedule_appointment"]);
    const id = await recordMessage(admin, {
      clinic_id: appointment.clinic_id,
      child_id: appointment.child_id,
      appointment_id: appointment.id,
      recipient_name: child.parent_name,
      phone,
      message,
      message_type: "appointment_confirmation",
      recipient_role: "parent",
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: providerMessageId ?? null,
      metadata: { mode: "live", template: templateName },
    });
    return { id, status: "sent", providerMessageId };
  } catch (error) {
    const providerPayload = (error as Error & { providerPayload?: unknown }).providerPayload;
    const id = await recordMessage(admin, {
      clinic_id: appointment.clinic_id,
      child_id: appointment.child_id,
      appointment_id: appointment.id,
      recipient_name: child.parent_name,
      phone,
      message,
      message_type: "appointment_confirmation",
      recipient_role: "parent",
      status: "failed",
      error_code: "WHATSAPP_SEND_FAILED",
      error_message: error instanceof Error ? error.message : "WhatsApp send failed",
      metadata: { mode: "live", template: templateName, provider: providerPayload ?? null },
    });
    return { id, status: "failed" };
  }
}

async function processParentAction(admin: SupabaseClient, appointmentId: string, action: AppointmentAction, note?: string) {
  const { appointment, child, therapist, room, clinic } = await loadAppointment(admin, appointmentId);
  const status = action === "confirm_appointment" ? "confirmed" : action === "cancel_appointment" ? "cancel_requested" : "reschedule_requested";
  const title = action === "confirm_appointment" ? "Parent confirmed appointment" : action === "cancel_appointment" ? "Parent requested cancellation" : "Parent requested reschedule";
  const body = `${child.parent_name ?? "Parent"} ${action === "confirm_appointment" ? "confirmed" : action === "cancel_appointment" ? "requested cancellation for" : "requested a reschedule for"} ${child.full_name} on ${formatDate(appointment.appointment_date)} at ${formatTime(appointment.start_time)}.${note ? ` Note: ${note}` : ""}`;

  await admin.from("appointments").update({ parent_confirmation_status: status, parent_action_at: new Date().toISOString(), parent_action_note: note?.trim() || null }).eq("id", appointment.id);
  await admin.from("notifications").insert({ clinic_id: appointment.clinic_id, title, body, type: "whatsapp_parent_action" });

  if (action !== "confirm_appointment") return { ok: true, confirmationStatus: status, therapistNotified: false };
  if (!therapist?.phone || normalizePhone(therapist.phone).length < 8) {
    await admin.from("notifications").insert({ clinic_id: appointment.clinic_id, title: "Therapist notification needs attention", body: `${child.full_name} was confirmed, but the assigned therapist has no valid phone number.`, type: "whatsapp_therapist_notification_error" });
    return { ok: true, confirmationStatus: status, therapistNotified: false };
  }

  const therapistPhone = normalizePhone(therapist.phone);
  const therapistMessage = `Therapy Care – Appointment Confirmed\n\nParent has confirmed the session for ${child.full_name}.\n\n👶 Child: ${child.full_name}\n📅 Date: ${formatDate(appointment.appointment_date)}\n⏰ Time: ${formatTime(appointment.start_time)}\n🧑‍⚕️ Therapist: ${therapist.full_name}\n🧩 Therapy: ${appointment.specialty ?? "Therapy session"}\n🏠 Room: ${room?.name ?? "To be assigned"}\n💰 Session Fee: ${feeText(appointment.session_fee, clinic.currency)}`;
  const mode = Deno.env.get("WHATSAPP_MODE") ?? "mock";
  const existing = await admin.from("whatsapp_messages").select("id").eq("appointment_id", appointment.id).eq("recipient_role", "therapist").eq("message_type", "therapist_confirmation").maybeSingle();
  if (existing.data) return { ok: true, confirmationStatus: status, therapistNotified: true };

  if (mode !== "live") {
    await recordMessage(admin, { clinic_id: appointment.clinic_id, child_id: appointment.child_id, appointment_id: appointment.id, recipient_name: therapist.full_name, phone: therapistPhone, message: therapistMessage, message_type: "therapist_confirmation", recipient_role: "therapist", status: "mocked", sent_at: new Date().toISOString(), metadata: { mode: "mock", trigger: "parent_confirmed" } });
    await admin.from("notifications").insert({ clinic_id: appointment.clinic_id, title: "Therapist notified", body: `Parent confirmed ${child.full_name}. Therapist ${therapist.full_name} was queued for WhatsApp notification.`, type: "whatsapp_therapist_notification" });
    return { ok: true, confirmationStatus: status, therapistNotified: true };
  }

  try {
    const providerMessageId = await sendTemplate(therapistPhone, Deno.env.get("WHATSAPP_THERAPIST_TEMPLATE") ?? "therapy_care_therapist_confirmation", Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en_US", [child.full_name, formatDate(appointment.appointment_date), formatTime(appointment.start_time), therapist.full_name, appointment.specialty ?? "Therapy session", room?.name ?? "To be assigned", feeText(appointment.session_fee, clinic.currency)], []);
    await recordMessage(admin, { clinic_id: appointment.clinic_id, child_id: appointment.child_id, appointment_id: appointment.id, recipient_name: therapist.full_name, phone: therapistPhone, message: therapistMessage, message_type: "therapist_confirmation", recipient_role: "therapist", status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerMessageId ?? null, metadata: { mode: "live", trigger: "parent_confirmed" } });
    await admin.from("notifications").insert({ clinic_id: appointment.clinic_id, title: "Therapist notified", body: `Parent confirmed ${child.full_name}. Therapist ${therapist.full_name} was notified on WhatsApp.`, type: "whatsapp_therapist_notification" });
    return { ok: true, confirmationStatus: status, therapistNotified: true };
  } catch (error) {
    await recordMessage(admin, { clinic_id: appointment.clinic_id, child_id: appointment.child_id, appointment_id: appointment.id, recipient_name: therapist.full_name, phone: therapistPhone, message: therapistMessage, message_type: "therapist_confirmation", recipient_role: "therapist", status: "failed", error_code: "WHATSAPP_SEND_FAILED", error_message: error instanceof Error ? error.message : "WhatsApp send failed", metadata: { mode: "live", trigger: "parent_confirmed" } });
    await admin.from("notifications").insert({ clinic_id: appointment.clinic_id, title: "Therapist WhatsApp failed", body: `Parent confirmed ${child.full_name}, but WhatsApp notification to ${therapist.full_name} failed.`, type: "whatsapp_therapist_notification_error" });
    return { ok: true, confirmationStatus: status, therapistNotified: false };
  }
}

async function verifyMetaSignature(req: Request, rawBody: string) {
  const secret = Deno.env.get("META_WA_APP_SECRET");
  const signature = req.headers.get("x-hub-signature-256");
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (expected.length !== signature.length) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function handleWebhook(req: Request, admin: SupabaseClient) {
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === Deno.env.get("META_WA_VERIFY_TOKEN")) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: corsHeaders });
    }
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const raw = await req.text();
  if (!(await verifyMetaSignature(req, raw))) return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  const payload = JSON.parse(raw);

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "interactive") continue;
        const actionId = message.interactive?.button_reply?.id as AppointmentAction | undefined;
        const appointmentId = message.interactive?.button_reply?.title ? undefined : undefined;
        if (!actionId) continue;

        const from = normalizePhone(message.from);
        const { data: matching } = await admin.from("whatsapp_messages").select("appointment_id,clinic_id,child_id").eq("phone", from).eq("recipient_role", "parent").not("appointment_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!matching?.appointment_id) continue;
        await processParentAction(admin, matching.appointment_id, actionId);
        await admin.from("whatsapp_messages").update({ status: "read", read_at: new Date().toISOString(), metadata: { webhook: "parent_action", action: actionId, provider_message_id: message.id } }).eq("appointment_id", matching.appointment_id).eq("recipient_role", "parent").eq("phone", from).eq("message_type", "appointment_confirmation");
      }
    }
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("webhook") === "1") return await handleWebhook(req, admin);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string | undefined;
    if (action === "appointment_created") {
      const user = await requireUser(req);
      return json(await appointmentCreated(admin, body.appointmentId, user.id));
    }
    if (action === "parent_action") {
      const user = await requireUser(req);
      const { appointment } = await loadAppointment(admin, body.appointmentId);
      await assertClinicAccess(admin, user.id, appointment.clinic_id);
      return json(await processParentAction(admin, body.appointmentId, body.parentAction as AppointmentAction, body.note));
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 400);
  }
});
