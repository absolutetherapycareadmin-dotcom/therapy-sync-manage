-- WhatsApp automation foundation.
-- Phase 1 is intentionally mock-only: no external WhatsApp delivery is attempted.
-- Phase 2 can use the same records with a secure Edge Function + Meta Cloud API.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS parent_confirmation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS parent_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_action_note text;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_role text NOT NULL DEFAULT 'parent',
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_appointment
  ON public.whatsapp_messages (clinic_id, appointment_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_therapist_confirmation_once
  ON public.whatsapp_messages (appointment_id, recipient_role, message_type)
  WHERE appointment_id IS NOT NULL AND recipient_role = 'therapist' AND message_type = 'therapist_confirmation';

CREATE OR REPLACE FUNCTION public.queue_mock_appointment_whatsapp(p_appointment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.appointments%ROWTYPE;
  c public.children%ROWTYPE;
  t public.therapists%ROWTYPE;
  r public.rooms%ROWTYPE;
  clinic_name text;
  msg text;
  message_id uuid;
BEGIN
  SELECT * INTO a
  FROM public.appointments
  WHERE id = p_appointment_id
    AND clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found or access denied';
  END IF;

  SELECT * INTO c FROM public.children WHERE id = a.child_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id;
  SELECT * INTO r FROM public.rooms WHERE id = a.room_id;
  SELECT name INTO clinic_name FROM public.clinics WHERE id = a.clinic_id;

  IF c.parent_phone IS NULL OR length(regexp_replace(c.parent_phone, '\\D', '', 'g')) < 8 THEN
    INSERT INTO public.whatsapp_messages (
      clinic_id, child_id, appointment_id, recipient_name, phone, message,
      message_type, recipient_role, status, error_code, error_message, metadata
    ) VALUES (
      a.clinic_id, a.child_id, a.id, c.parent_name, COALESCE(c.parent_phone, ''),
      'Parent phone number is missing or invalid.', 'appointment_confirmation', 'parent',
      'failed', 'INVALID_PARENT_PHONE', 'Parent phone number is missing or invalid.',
      jsonb_build_object('mode', 'mock', 'actions', jsonb_build_array('confirm_appointment', 'cancel_appointment', 'reschedule_appointment'))
    ) RETURNING id INTO message_id;
    RETURN message_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.whatsapp_messages
    WHERE appointment_id = a.id
      AND recipient_role = 'parent'
      AND message_type = 'appointment_confirmation'
  ) THEN
    SELECT id INTO message_id FROM public.whatsapp_messages
    WHERE appointment_id = a.id
      AND recipient_role = 'parent'
      AND message_type = 'appointment_confirmation'
    ORDER BY created_at DESC LIMIT 1;
    RETURN message_id;
  END IF;

  msg := format(
    E'Therapy Care – Appointment Confirmation\\n\\nHello %s,\\n\\n%s''s therapy appointment has been scheduled.\\n\\n📅 Date: %s\\n⏰ Time: %s\\n🧑‍⚕️ Therapist: %s\\n🧩 Therapy: %s\\n🏠 Room: %s\\n💰 Session Fee: %s\\n\\nPlease confirm your appointment.\\n\\nButtons: Confirm | Cancel | Reschedule',
    COALESCE(c.parent_name, 'Parent'),
    c.full_name,
    to_char(a.appointment_date, 'DD Mon YYYY'),
    to_char(a.start_time, 'HH12:MI AM'),
    COALESCE(t.full_name, 'To be assigned'),
    COALESCE(a.specialty, 'Therapy session'),
    COALESCE(r.name, 'To be assigned'),
    CASE WHEN a.session_fee IS NULL THEN 'Not specified' ELSE '₹' || to_char(a.session_fee, 'FM999999990.00') END
  );

  INSERT INTO public.whatsapp_messages (
    clinic_id, child_id, appointment_id, recipient_name, phone, message,
    message_type, recipient_role, status, sent_at, metadata
  ) VALUES (
    a.clinic_id, a.child_id, a.id, c.parent_name,
    regexp_replace(c.parent_phone, '\\D', '', 'g'), msg,
    'appointment_confirmation', 'parent', 'mocked', now(),
    jsonb_build_object(
      'mode', 'mock',
      'clinic_name', clinic_name,
      'actions', jsonb_build_array(
        jsonb_build_object('id', 'confirm_appointment', 'label', 'Confirm'),
        jsonb_build_object('id', 'cancel_appointment', 'label', 'Cancel'),
        jsonb_build_object('id', 'reschedule_appointment', 'label', 'Reschedule')
      )
    )
  ) RETURNING id INTO message_id;

  RETURN message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_mock_parent_action(
  p_appointment_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.appointments%ROWTYPE;
  c public.children%ROWTYPE;
  t public.therapists%ROWTYPE;
  r public.rooms%ROWTYPE;
  clinic_name text;
  therapist_message text;
  new_confirmation_status text;
  notification_title text;
  notification_body text;
BEGIN
  IF p_action NOT IN ('confirm_appointment', 'cancel_appointment', 'reschedule_appointment') THEN
    RAISE EXCEPTION 'Unsupported parent action';
  END IF;

  SELECT * INTO a
  FROM public.appointments
  WHERE id = p_appointment_id
    AND clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found or access denied';
  END IF;

  SELECT * INTO c FROM public.children WHERE id = a.child_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id;
  SELECT * INTO r FROM public.rooms WHERE id = a.room_id;
  SELECT name INTO clinic_name FROM public.clinics WHERE id = a.clinic_id;

  IF p_action = 'confirm_appointment' THEN
    new_confirmation_status := 'confirmed';
    notification_title := 'Parent confirmed appointment';
    notification_body := format('%s confirmed the appointment for %s on %s at %s.', COALESCE(c.parent_name, 'Parent'), c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'));
  ELSIF p_action = 'cancel_appointment' THEN
    new_confirmation_status := 'cancel_requested';
    notification_title := 'Parent requested cancellation';
    notification_body := format('%s requested cancellation for %s on %s at %s.', COALESCE(c.parent_name, 'Parent'), c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'));
  ELSE
    new_confirmation_status := 'reschedule_requested';
    notification_title := 'Parent requested reschedule';
    notification_body := format('%s requested a reschedule for %s on %s at %s.%s', COALESCE(c.parent_name, 'Parent'), c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'), CASE WHEN p_note IS NULL OR p_note = '' THEN '' ELSE ' Note: ' || p_note END);
  END IF;

  UPDATE public.appointments
  SET parent_confirmation_status = new_confirmation_status,
      parent_action_at = now(),
      parent_action_note = NULLIF(p_note, '')
  WHERE id = a.id;

  INSERT INTO public.notifications (clinic_id, title, body, type)
  VALUES (a.clinic_id, notification_title, notification_body, 'whatsapp_parent_action');

  IF p_action = 'confirm_appointment' AND t.phone IS NOT NULL AND length(regexp_replace(t.phone, '\\D', '', 'g')) >= 8 THEN
    therapist_message := format(
      E'Therapy Care – Appointment Confirmed\\n\\nParent has confirmed the session for %s.\\n\\n👶 Child: %s\\n📅 Date: %s\\n⏰ Time: %s\\n🧑‍⚕️ Therapist: %s\\n🧩 Therapy: %s\\n🏠 Room: %s\\n💰 Session Fee: %s',
      c.full_name,
      c.full_name,
      to_char(a.appointment_date, 'DD Mon YYYY'),
      to_char(a.start_time, 'HH12:MI AM'),
      COALESCE(t.full_name, 'You'),
      COALESCE(a.specialty, 'Therapy session'),
      COALESCE(r.name, 'To be assigned'),
      CASE WHEN a.session_fee IS NULL THEN 'Not specified' ELSE '₹' || to_char(a.session_fee, 'FM999999990.00') END
    );

    INSERT INTO public.whatsapp_messages (
      clinic_id, child_id, appointment_id, recipient_name, phone, message,
      message_type, recipient_role, status, sent_at, metadata
    )
    SELECT
      a.clinic_id, a.child_id, a.id, t.full_name,
      regexp_replace(t.phone, '\\D', '', 'g'), therapist_message,
      'therapist_confirmation', 'therapist', 'mocked', now(),
      jsonb_build_object('mode', 'mock', 'trigger', 'parent_confirmed', 'clinic_name', clinic_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.whatsapp_messages
      WHERE appointment_id = a.id
        AND recipient_role = 'therapist'
        AND message_type = 'therapist_confirmation'
    );

    INSERT INTO public.notifications (clinic_id, title, body, type)
    VALUES (
      a.clinic_id,
      'Therapist notified',
      format('%s confirmed the appointment. Therapist %s was queued for WhatsApp notification.', c.full_name, t.full_name),
      'whatsapp_therapist_notification'
    );
  ELSIF p_action = 'confirm_appointment' AND (t.id IS NULL OR t.phone IS NULL OR length(regexp_replace(t.phone, '\\D', '', 'g')) < 8) THEN
    INSERT INTO public.notifications (clinic_id, title, body, type)
    VALUES (
      a.clinic_id,
      'Therapist notification needs attention',
      format('%s confirmed the appointment, but the assigned therapist has no valid phone number.', c.full_name),
      'whatsapp_therapist_notification_error'
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'appointment_id', a.id, 'confirmation_status', new_confirmation_status);
END;
$$;

REVOKE ALL ON FUNCTION public.queue_mock_appointment_whatsapp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_mock_appointment_whatsapp(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.process_mock_parent_action(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_mock_parent_action(uuid, text, text) TO authenticated;
