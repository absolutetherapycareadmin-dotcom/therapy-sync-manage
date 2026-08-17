-- P0 follow-up correction: keep the separate appointment reminder independent
-- of WhatsApp escalation, and make reschedule reminder rows reusable.

CREATE OR REPLACE FUNCTION public.start_appointment_communication_workflow(
  p_appointment_id uuid,
  p_event_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.appointments%ROWTYPE;
  c public.children%ROWTYPE;
  t public.therapists%ROWTYPE;
  cl public.clinics%ROWTYPE;
  parent_phone text;
  parent_message text;
  room_name text;
  escalation_id uuid;
  sms_at timestamptz;
  appt_at timestamptz;
  reminder_at timestamptz;
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id;
  IF a.id IS NULL OR a.status = 'cancelled' THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.children WHERE id = a.child_id AND clinic_id = a.clinic_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cl FROM public.clinics WHERE id = a.clinic_id;
  parent_phone := public.normalize_phone(c.parent_phone);
  IF NOT public.is_valid_phone(parent_phone) THEN RETURN NULL; END IF;

  -- The appointment call reminder is independent from WhatsApp escalation.
  appt_at := (a.appointment_date + a.start_time) AT TIME ZONE COALESCE(cl.timezone, 'Asia/Kolkata');
  reminder_at := appt_at - make_interval(mins => COALESCE(cl.reminder_lead_minutes, 30));
  IF COALESCE(cl.call_enabled, true) AND reminder_at > now() THEN
    INSERT INTO public.call_queue (
      clinic_id, appointment_id, recipient_role, recipient_phone, call_type, scheduled_for
    ) VALUES (
      a.clinic_id, a.id, 'parent', parent_phone, 'reminder', reminder_at
    )
    ON CONFLICT (appointment_id, call_type, recipient_role) DO UPDATE
      SET scheduled_for = EXCLUDED.scheduled_for,
          status = 'queued',
          attempts = 0,
          last_error = NULL,
          dialed_at = NULL;
  END IF;

  IF NOT COALESCE(cl.whatsapp_escalation_enabled, true) THEN RETURN NULL; END IF;

  INSERT INTO public.communication_escalations (clinic_id, appointment_id, event_key)
  VALUES (a.clinic_id, a.id, p_event_key)
  ON CONFLICT (appointment_id, event_key) DO NOTHING
  RETURNING id INTO escalation_id;

  IF escalation_id IS NULL THEN
    SELECT ce.id INTO escalation_id
    FROM public.communication_escalations ce
    WHERE ce.appointment_id = a.id AND ce.event_key = p_event_key;
    RETURN escalation_id;
  END IF;

  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id AND clinic_id = a.clinic_id;
  SELECT r.name INTO room_name FROM public.rooms r WHERE r.id = a.room_id AND r.clinic_id = a.clinic_id;

  parent_message := format(
    E'Therapy Care – Appointment Confirmation\n\nHello %s,\n%s''s therapy session is scheduled.\n\nDate: %s\nTime: %s\nTherapist: %s\nTherapy: %s\nRoom: %s\nSession Fee: %s\n\nPlease Approve, Cancel, or request a Schedule Change.',
    COALESCE(c.parent_name, 'Parent'), c.full_name,
    to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'),
    COALESCE(t.full_name, 'To be assigned'), COALESCE(a.specialty, 'Therapy session'),
    COALESCE(room_name, 'To be assigned'), COALESCE(a.session_fee::text, 'To be confirmed')
  );

  INSERT INTO public.whatsapp_messages (
    clinic_id, child_id, appointment_id, communication_event_id,
    recipient_name, phone, message, message_type, recipient_role, status, metadata
  ) VALUES (
    a.clinic_id, a.child_id, a.id, escalation_id,
    c.parent_name, parent_phone, parent_message,
    'appointment_confirmation', 'parent', 'queued',
    jsonb_build_object(
      'mode', 'free_deep_link',
      'delivery_claim', false,
      'read_claim', false,
      'actions', jsonb_build_array('Approve', 'Cancel', 'Schedule Change')
    )
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.communication_escalations e
  SET whatsapp_message_id = w.id
  FROM public.whatsapp_messages w
  WHERE e.id = escalation_id
    AND w.communication_event_id = e.id
    AND w.message_type = 'appointment_confirmation'
    AND w.recipient_role = 'parent';

  sms_at := now() + make_interval(mins => GREATEST(COALESCE(cl.whatsapp_to_sms_wait_minutes, 60), 0));
  IF COALESCE(cl.sms_enabled, true) THEN
    INSERT INTO public.sms_queue (
      clinic_id, appointment_id, communication_event_id, recipient_role,
      recipient_phone, message_type, message, scheduled_for
    ) VALUES (
      a.clinic_id, a.id, escalation_id, 'parent', parent_phone,
      'escalation_fallback',
      format('Therapy Care: please respond regarding %s''s session on %s at %s.',
        c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM')),
      sms_at
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.communication_escalations e
    SET sms_queue_id = s.id, sms_scheduled_for = s.scheduled_for
    FROM public.sms_queue s
    WHERE e.id = escalation_id
      AND s.communication_event_id = e.id
      AND s.message_type = 'escalation_fallback'
      AND s.recipient_role = 'parent';
  END IF;

  RETURN escalation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_appointment_communication_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_key text;
BEGIN
  IF NEW.status = 'cancelled' THEN
    UPDATE public.communication_escalations
    SET status = 'cancelled', current_stage = 'completed', cancelled_at = now(), cancel_reason = 'appointment_cancelled'
    WHERE appointment_id = NEW.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

    UPDATE public.whatsapp_messages
    SET status = 'cancelled', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('invalidated_reason', 'appointment_cancelled')
    WHERE appointment_id = NEW.id AND recipient_role = 'parent'
      AND status IN ('queued','manual_opened');

    UPDATE public.sms_queue SET status = 'cancelled', last_error = 'Appointment cancelled'
      WHERE appointment_id = NEW.id AND status IN ('queued','sending');
    UPDATE public.call_queue SET status = 'cancelled', last_error = 'Appointment cancelled'
      WHERE appointment_id = NEW.id AND status IN ('queued','dialing');
    RETURN NEW;
  END IF;

  IF OLD.appointment_date IS DISTINCT FROM NEW.appointment_date
     OR OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    UPDATE public.communication_escalations
    SET status = 'superseded', current_stage = 'completed', cancelled_at = now(), cancel_reason = 'appointment_rescheduled'
    WHERE appointment_id = NEW.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

    UPDATE public.whatsapp_messages
    SET status = 'superseded', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('invalidated_reason', 'appointment_rescheduled')
    WHERE appointment_id = NEW.id AND recipient_role = 'parent'
      AND status IN ('queued','manual_opened');

    UPDATE public.sms_queue SET status = 'cancelled', last_error = 'Appointment rescheduled'
      WHERE appointment_id = NEW.id AND status IN ('queued','sending');
    UPDATE public.call_queue SET status = 'cancelled', last_error = 'Appointment rescheduled'
      WHERE appointment_id = NEW.id AND status IN ('queued','dialing');

    event_key := NEW.appointment_date::text || 'T' || NEW.start_time::text;
    PERFORM public.start_appointment_communication_workflow(NEW.id, event_key);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.start_appointment_communication_workflow(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_appointment_communication_change() FROM PUBLIC;
