-- P0 parent-response security boundary.
-- Parent responses are distinct from appointment execution status. Centre users
-- may operate appointment execution state, but may never write parent-response
-- fields or invoke a parent-response simulation path.

UPDATE public.appointments
SET parent_confirmation_status = CASE lower(COALESCE(parent_confirmation_status, 'no_response'))
  WHEN 'pending' THEN 'no_response'
  WHEN 'cancel_requested' THEN 'declined'
  WHEN 'confirmed' THEN 'confirmed'
  WHEN 'reschedule_requested' THEN 'reschedule_requested'
  WHEN 'declined' THEN 'declined'
  WHEN 'no_response' THEN 'no_response'
  ELSE 'no_response'
END;

UPDATE public.appointments
SET status = 'scheduled'
WHERE status NOT IN ('scheduled','in_progress','completed','cancelled','no_show');

ALTER TABLE public.appointments
  ALTER COLUMN parent_confirmation_status SET DEFAULT 'no_response';

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_parent_confirmation_status_check,
  DROP CONSTRAINT IF EXISTS appointments_execution_status_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_parent_confirmation_status_check
    CHECK (parent_confirmation_status IN ('no_response','confirmed','declined','reschedule_requested')),
  ADD CONSTRAINT appointments_execution_status_check
    CHECK (status IN ('scheduled','in_progress','completed','cancelled','no_show'));

REVOKE INSERT, UPDATE ON public.appointments FROM authenticated;
GRANT INSERT (
  clinic_id,
  child_id,
  therapist_id,
  room_id,
  specialty,
  appointment_date,
  start_time,
  duration_minutes,
  session_fee,
  status,
  notes,
  recurrence_group_id
) ON public.appointments TO authenticated;
GRANT UPDATE (
  child_id,
  therapist_id,
  room_id,
  specialty,
  appointment_date,
  start_time,
  duration_minutes,
  session_fee,
  notes,
  recurrence_group_id
) ON public.appointments TO authenticated;

CREATE OR REPLACE FUNCTION public.set_appointment_execution_status(
  p_appointment_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id uuid;
  v_role text;
BEGIN
  SELECT clinic_id, role INTO v_clinic_id, v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_clinic_id IS NULL OR v_role NOT IN ('owner','admin','staff') THEN
    RAISE EXCEPTION 'Not authorized to change appointment execution status';
  END IF;

  IF p_status NOT IN ('scheduled','in_progress','completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Invalid appointment execution status';
  END IF;

  UPDATE public.appointments
  SET status = p_status
  WHERE id = p_appointment_id
    AND clinic_id = v_clinic_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_appointment_execution_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_appointment_execution_status(uuid, text) TO authenticated;

-- Keep the mock parent mutation as a trusted backend/test helper only. It is
-- never callable by Centre/Admin/Staff users and never changes execution status.
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
  v_clinic_id uuid;
  next_status text;
  action_label text;
  therapist_notified boolean := false;
  room_name text;
  active_escalation_id uuid;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.appointments WHERE id = p_appointment_id;
  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Appointment not found'; END IF;

  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id AND clinic_id = v_clinic_id;
  SELECT * INTO c FROM public.children WHERE id = a.child_id AND clinic_id = v_clinic_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id AND clinic_id = v_clinic_id;
  SELECT r.name INTO room_name FROM public.rooms r WHERE r.id = a.room_id AND r.clinic_id = v_clinic_id;

  IF p_action = 'confirm_appointment' THEN
    next_status := 'confirmed'; action_label := 'confirmed';
  ELSIF p_action = 'cancel_appointment' THEN
    next_status := 'declined'; action_label := 'declined';
  ELSIF p_action = 'reschedule_appointment' THEN
    next_status := 'reschedule_requested'; action_label := 'reschedule requested';
  ELSE
    RAISE EXCEPTION 'Unsupported parent action';
  END IF;

  IF a.parent_confirmation_status = next_status THEN
    RETURN jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', next_status, 'duplicate', true);
  END IF;

  UPDATE public.appointments
  SET parent_confirmation_status = next_status,
      parent_action_at = now(),
      parent_action_note = p_note
  WHERE id = a.id;

  UPDATE public.whatsapp_messages
  SET status = 'mock_action_' || next_status,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'parent_action', next_status,
        'action_at', now(),
        'delivery_claim', false,
        'read_claim', false
      )
  WHERE appointment_id = a.id
    AND recipient_role = 'parent'
    AND message_type = 'appointment_confirmation'
    AND communication_event_id IN (SELECT id FROM public.communication_escalations WHERE appointment_id = a.id);

  UPDATE public.communication_escalations
  SET status = 'completed', current_stage = 'completed', response_action = next_status,
      completed_at = now(), cancelled_at = now(), cancel_reason = 'parent_response'
  WHERE appointment_id = a.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call')
  RETURNING id INTO active_escalation_id;

  UPDATE public.sms_queue
  SET status = 'cancelled', last_error = 'Parent responded'
  WHERE appointment_id = a.id AND status IN ('queued','sending')
    AND message_type = 'escalation_fallback';

  UPDATE public.call_queue
  SET status = 'cancelled', last_error = 'Parent responded'
  WHERE appointment_id = a.id AND status IN ('queued','dialing')
    AND communication_event_id = active_escalation_id;

  IF p_action = 'confirm_appointment' AND t.id IS NOT NULL AND public.is_valid_phone(t.phone) THEN
    INSERT INTO public.whatsapp_messages (
      clinic_id, child_id, appointment_id, recipient_name, phone, message,
      message_type, recipient_role, status, metadata
    ) VALUES (
      v_clinic_id, a.child_id, a.id, t.full_name, public.normalize_phone(t.phone),
      format(E'Therapy Care – Appointment Confirmed\n\n%s''s parent has confirmed the session.\n\nDate: %s\nTime: %s\nTherapy: %s\nRoom: %s',
        c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'),
        COALESCE(a.specialty, 'Therapy session'), COALESCE(room_name, 'To be assigned')),
      'appointment_confirmed', 'therapist', 'mock_sent',
      jsonb_build_object('mode', 'mock', 'trigger', 'parent_confirmation')
    ) ON CONFLICT DO NOTHING;
    therapist_notified := true;
  END IF;

  INSERT INTO public.notifications (clinic_id, title, body, type)
  VALUES (
    v_clinic_id,
    CASE WHEN p_action = 'confirm_appointment' THEN 'Parent confirmed appointment' ELSE 'Parent ' || action_label END,
    format('%s: %s on %s at %s.', c.full_name, action_label, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM')),
    'appointment_parent_action'
  );

  RETURN jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', next_status, 'therapist_notified', therapist_notified);
END;
$$;

REVOKE ALL ON FUNCTION public.process_mock_parent_action(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_mock_parent_action(uuid, text, text) TO service_role;
