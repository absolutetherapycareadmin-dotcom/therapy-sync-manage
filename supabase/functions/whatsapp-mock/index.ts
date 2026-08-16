import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const body = await req.json();
    const { action, appointmentId, parentName, parentPhone, childName, therapistName, therapistPhone, date, time, specialty, room, fee } = body;

    if (!appointmentId || !action) {
      return Response.json({ error: "appointmentId and action are required" }, { status: 400 });
    }

    const allowed = ["appointment_created", "confirm", "cancel", "reschedule"];
    if (!allowed.includes(action)) {
      return Response.json({ error: "Unsupported action" }, { status: 400 });
    }

    const parentMessage = {
      mode: "mock",
      channel: "whatsapp",
      recipient: parentPhone ?? null,
      appointmentId,
      action,
      message: `Therapy Care – Appointment Confirmation\n\nHello ${parentName ?? "Parent"},\n${childName ?? "Your child"}'s therapy appointment has been scheduled.\n\nDate: ${date ?? "-"}\nTime: ${time ?? "-"}\nTherapist: ${therapistName ?? "-"}\nTherapy: ${specialty ?? "-"}\nRoom: ${room ?? "-"}\nSession Fee: ${fee ?? "-"}\n\nPlease confirm, cancel, or request a reschedule.`,
      buttons: ["Confirm", "Cancel", "Reschedule"],
      status: "mock_queued",
    };

    const therapistMessage = action === "confirm" ? {
      mode: "mock",
      channel: "whatsapp",
      recipient: therapistPhone ?? null,
      appointmentId,
      action: "parent_confirmed",
      message: `Therapy Care – Appointment Confirmed\n\n${childName ?? "Child"}'s appointment has been confirmed by the parent.\nDate: ${date ?? "-"}\nTime: ${time ?? "-"}\nTherapy: ${specialty ?? "-"}\nRoom: ${room ?? "-"}`,
      status: "mock_queued",
    } : null;

    return Response.json({ ok: true, parentMessage, therapistMessage });
  } catch {
    return Response.json({ error: "Invalid JSON request" }, { status: 400 });
  }
});
