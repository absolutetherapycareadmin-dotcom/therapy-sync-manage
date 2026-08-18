CREATE OR REPLACE FUNCTION public.get_communication_escalation_state(p_escalation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.communication_escalations ce
    JOIN public.profiles p ON p.clinic_id = ce.clinic_id
    WHERE ce.id = p_escalation_id AND p.id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT jsonb_build_object('status', ce.status, 'current_stage', ce.current_stage)
    FROM public.communication_escalations ce
    WHERE ce.id = p_escalation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_communication_after_sms(
  p_escalation_id uuid,
  p_sent_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.communication_escalations%ROWTYPE;
  c public.clinics%ROWTYPE;
  s public.sms_queue%ROWTYPE;
  call_id uuid;
  call_at timestamptz;
BEGIN
  SELECT ce.* INTO e
  FROM public.communication_escalations ce
  JOIN public.profiles p ON p.clinic_id = ce.clinic_id
  WHERE ce.id = p_escalation_id AND p.id = auth.uid()
  FOR UPDATE;

  IF e.id IS NULL OR e.status NOT IN ('waiting_whatsapp','waiting_sms') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'escalation_not_waiting_for_sms');
  END IF;

  SELECT * INTO c FROM public.clinics WHERE id = e.clinic_id;
  SELECT * INTO s FROM public.sms_queue WHERE id = e.sms_queue_id;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'sms_queue_missing'); END IF;

  IF NOT COALESCE(c.call_enabled, true) THEN
    UPDATE public.communication_escalations
    SET status = 'completed', current_stage = 'completed', completed_at = p_sent_at
    WHERE id = e.id;
    RETURN jsonb_build_object('ok', true, 'status', 'completed');
  END IF;

  call_at := p_sent_at + make_interval(mins => GREATEST(COALESCE(c.sms_to_call_wait_minutes, 15), 0));
  SELECT id INTO call_id FROM public.call_queue
    WHERE communication_event_id = e.id AND call_type = 'escalation' AND recipient_role = 'parent' LIMIT 1;

  IF call_id IS NULL THEN
    INSERT INTO public.call_queue (
      clinic_id, appointment_id, communication_event_id, recipient_role,
      recipient_phone, call_type, scheduled_for
    ) VALUES (
      e.clinic_id, e.appointment_id, e.id, 'parent', s.recipient_phone,
      'escalation', call_at
    ) ON CONFLICT DO NOTHING RETURNING id INTO call_id;

    IF call_id IS NULL THEN
      SELECT id INTO call_id FROM public.call_queue
      WHERE communication_event_id = e.id AND call_type = 'escalation' AND recipient_role = 'parent' LIMIT 1;
    END IF;
  ELSE
    UPDATE public.call_queue
    SET scheduled_for = call_at, status = 'queued', attempts = 0, last_error = NULL, dialed_at = NULL
    WHERE id = call_id AND status IN ('queued','cancelled');
  END IF;

  UPDATE public.communication_escalations
  SET status = 'waiting_call', current_stage = 'call', call_queue_id = call_id, call_scheduled_for = call_at
  WHERE id = e.id AND status IN ('waiting_whatsapp','waiting_sms');

  RETURN jsonb_build_object('ok', true, 'status', 'waiting_call', 'call_queue_id', call_id, 'call_scheduled_for', call_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_communication_after_call(
  p_escalation_id uuid,
  p_dialed_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.communication_escalations ce
  SET status = 'completed', current_stage = 'completed', completed_at = p_dialed_at
  FROM public.profiles p
  WHERE ce.id = p_escalation_id AND p.id = auth.uid() AND p.clinic_id = ce.clinic_id AND ce.status = 'waiting_call';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.get_communication_escalation_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_communication_after_sms(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_communication_after_call(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_communication_escalation_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_communication_after_sms(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_communication_after_call(uuid, timestamptz) TO authenticated;

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
  reminder_at timestamptz;
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id;
  IF a.id IS NULL OR a.status = 'cancelled' THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.children WHERE id = a.child_id AND clinic_id = a.clinic_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cl FROM public.clinics WHERE id = a.clinic_id;
  parent_phone := public.normalize_phone(c.parent_phone);
  IF NOT public.is_valid_phone(parent_phone) THEN RETURN NULL; END IF;

  reminder_at := (a.appointment_date + a.start_time)
    - make_interval(mins => COALESCE(cl.reminder_lead_minutes, 30));
  IF COALESCE(cl.call_enabled, true) AND reminder_at > now() THEN
    UPDATE public.call_queue
    SET scheduled_for = reminder_at, status = 'queued', attempts = 0, last_error = NULL, dialed_at = NULL
    WHERE appointment_id = a.id AND call_type = 'reminder' AND recipient_role = 'parent';

    IF NOT FOUND THEN
      INSERT INTO public.call_queue (
        clinic_id, appointment_id, recipient_role, recipient_phone, call_type, scheduled_for
      ) VALUES (a.clinic_id, a.id, 'parent', parent_phone, 'reminder', reminder_at)
      ON CONFLICT DO NOTHING;
    END IF;
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
    a.clinic_id, a.child_id, a.id, escalation_id, c.parent_name, parent_phone,
    parent_message, 'appointment_confirmation', 'parent', 'queued',
    jsonb_build_object('mode', 'free_deep_link', 'delivery_claim', false, 'read_claim', false,
      'actions', jsonb_build_array('Approve', 'Cancel', 'Schedule Change'))
  ) ON CONFLICT DO NOTHING;

  UPDATE public.communication_escalations e
  SET whatsapp_message_id = w.id
  FROM public.whatsapp_messages w
  WHERE e.id = escalation_id AND w.communication_event_id = e.id
    AND w.message_type = 'appointment_confirmation' AND w.recipient_role = 'parent';

  sms_at := now() + make_interval(mins => GREATEST(COALESCE(cl.whatsapp_to_sms_wait_minutes, 60), 0));
  IF COALESCE(cl.sms_enabled, true) THEN
    INSERT INTO public.sms_queue (
      clinic_id, appointment_id, communication_event_id, recipient_role,
      recipient_phone, message_type, message, scheduled_for
    ) VALUES (
      a.clinic_id, a.id, escalation_id, 'parent', parent_phone, 'escalation_fallback',
      format('Therapy Care: please respond regarding %s''s session on %s at %s.',
        c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM')),
      sms_at
    ) ON CONFLICT DO NOTHING;

    UPDATE public.communication_escalations e
    SET sms_queue_id = s.id, sms_scheduled_for = s.scheduled_for
    FROM public.sms_queue s
    WHERE e.id = escalation_id AND s.communication_event_id = e.id
      AND s.message_type = 'escalation_fallback' AND s.recipient_role = 'parent';
  END IF;

  RETURN escalation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_appointment_communication_workflow(uuid, text) FROM PUBLIC;