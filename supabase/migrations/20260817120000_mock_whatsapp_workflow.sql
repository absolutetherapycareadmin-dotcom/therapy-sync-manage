-- Mock WhatsApp workflow: no external provider and no paid API calls.

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
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_appointment
  ON public.whatsapp_messages (clinic_id, appointment_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.create_mock_appointment_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.children%ROWTYPE;
  t public.therapists%ROWTYPE;
  clinic_name text;
  parent_message text;
BEGIN
  SELECT * INTO c FROM public.children WHERE id = NEW.child_id AND clinic_id = NEW.clinic_id;
  IF c.id IS NULL OR c.parent_phone IS NULL OR length(trim(c.parent_phone)) < 8 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO t FROM public.therapists WHERE id = NEW.therapist_id AND clinic_id = NEW.clinic_id;
  SELECT name INTO clinic_name FROM public.clinics WHERE id = NEW.clinic_id;

  parent_message := format(
    'Therapy Care – Appointment Confirmation\n\nHello %s,\n%s''s therapy appointment has been scheduled.\n\nDate: %s\nTime: %s\nTherapist: %s\nTherapy: %s\nRoom: %s\nSession Fee: %s\n\nPlease confirm, cancel, or request a reschedule.',
    COALESCE(c.parent_name, 'Parent'),
    c.full_name,
    NEW.appointment_date,
    to_char(NEW.start_time, 'HH12:MI AM'),
    COALESCE(t.full_name, 'Not assigned'),
    COALESCE(NEW.specialty, 'Therapy session'),
    COALESCE((SELECT name FROM public.rooms WHERE id = NEW.room_id AND clinic_id = NEW.clinic_id), 'Not assigned'),
    COALESCE(NEW.session_fee::text, 'To be confirmed')
  );

  INSERT INTO public.whatsapp_messages (
    clinic_id, child_id, appointment_id, recipient_name, phone, message,
    message_type, recipient_role, status, metadata, sent_at
  ) VALUES (
    NEW.clinic_id, NEW.child_id, NEW.id, c.parent_name, trim(c.parent_phone), parent_message,
    'appointment_confirmation', 'parent', 'mocked',
    jsonb_build_object('mode', 'mock', 'buttons', jsonb_build_array('Confirm', 'Cancel', 'Reschedule'), 'clinic_name', clinic_name),
    now()
  );

  INSERT INTO public.notifications (clinic_id, title, body, type)
  VALUES (
    NEW.clinic_id,
    'Mock WhatsApp confirmation queued',
    format('Appointment confirmation for %s is ready in WhatsApp Centre. No real WhatsApp message was sent.', c.full_name),
    'whatsapp_mock'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_mock_whatsapp ON public.appointments;
CREATE TRIGGER appointments_mock_whatsapp
AFTER INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.create_mock_appointment_whatsapp();

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
  clinic_id uuid;
  next_status text;
  action_label text;
BEGIN
  SELECT public.current_clinic_id() INTO clinic_id;
  IF clinic_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id AND public.appointments.clinic_id = clinic_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Appointment not found'; END IF;

  SELECT * INTO c FROM public.children WHERE id = a.child_id AND public.children.clinic_id = clinic_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id AND public.therapists.clinic_id = clinic_id;

  IF p_action = 'confirm_appointment' THEN
    next_status := 'confirmed';
    action_label := 'confirmed';
  ELSIF p_action = 'cancel_appointment' THEN
    next_status := 'cancel_requested';
    action_label := 'cancellation requested';
  ELSIF p_action = 'reschedule_appointment' THEN
    next_status := 'reschedule_requested';
    action_label := 'reschedule requested';
  ELSE
    RAISE EXCEPTION 'Unsupported parent action';
  END IF;

  UPDATE public.appointments
  SET parent_confirmation_status = next_status,
      parent_action_at = now(),
      parent_action_note = p_note
  WHERE id = a.id;

  UPDATE public.whatsapp_messages
  SET status = 'mock_action_' || next_status,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('parent_action', next_status, 'action_at', now())
  WHERE appointment_id = a.id
    AND recipient_role = 'parent'
    AND message_type = 'appointment_confirmation';

  IF p_action = 'confirm_appointment' AND t.id IS NOT NULL AND t.phone IS NOT NULL AND length(trim(t.phone)) >= 8 THEN
    INSERT INTO public.whatsapp_messages (
      clinic_id, child_id, appointment_id, recipient_name, phone, message,
      message_type, recipient_role, status, metadata, sent_at
    ) VALUES (
      clinic_id, a.child_id, a.id, t.full_name, trim(t.phone),
      format('Therapy Care – Appointment Confirmed\n\n%s''s parent has confirmed the appointment.\n\nDate: %s\nTime: %s\nTherapy: %s\nRoom: %s',
        c.full_name, a.appointment_date, to_char(a.start_time, 'HH12:MI AM'),
        COALESCE(a.specialty, 'Therapy session'),
        COALESCE((SELECT name FROM public.rooms WHERE id = a.room_id AND clinic_id = clinic_id), 'Not assigned')),
      'appointment_confirmed', 'therapist', 'mocked',
      jsonb_build_object('mode', 'mock', 'trigger', 'parent_confirmation'), now()
    );
  END IF;

  INSERT INTO public.notifications (clinic_id, title, body, type)
  VALUES (
    clinic_id,
    CASE WHEN p_action = 'confirm_appointment' THEN 'Parent confirmed appointment' ELSE 'Parent ' || action_label END,
    format('%s: %s on %s at %s.', c.full_name, action_label, a.appointment_date, to_char(a.start_time, 'HH12:MI AM')),
    'appointment_parent_action'
  );

  RETURN jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', next_status, 'therapist_notified', p_action = 'confirm_appointment' AND t.id IS NOT NULL AND t.phone IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.process_mock_parent_action(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_mock_parent_action(uuid, text, text) TO authenticated;
