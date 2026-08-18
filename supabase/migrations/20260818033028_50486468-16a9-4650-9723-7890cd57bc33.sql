ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS whatsapp_escalation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_to_sms_wait_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS sms_to_call_wait_minutes integer NOT NULL DEFAULT 15;

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_whatsapp_to_sms_wait_minutes_check,
  DROP CONSTRAINT IF EXISTS clinics_sms_to_call_wait_minutes_check;

ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_whatsapp_to_sms_wait_minutes_check
    CHECK (whatsapp_to_sms_wait_minutes >= 0 AND whatsapp_to_sms_wait_minutes <= 10080),
  ADD CONSTRAINT clinics_sms_to_call_wait_minutes_check
    CHECK (sms_to_call_wait_minutes >= 0 AND sms_to_call_wait_minutes <= 10080);

CREATE TABLE IF NOT EXISTS public.communication_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'waiting_whatsapp'
    CHECK (status IN ('waiting_whatsapp','waiting_sms','waiting_call','completed','cancelled','superseded')),
  current_stage text NOT NULL DEFAULT 'whatsapp'
    CHECK (current_stage IN ('whatsapp','sms','call','completed')),
  response_action text,
  whatsapp_message_id uuid,
  sms_queue_id uuid,
  call_queue_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  sms_scheduled_for timestamptz,
  call_scheduled_for timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, event_key)
);

CREATE INDEX IF NOT EXISTS communication_escalations_clinic_status_idx
  ON public.communication_escalations (clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS communication_escalations_appointment_idx
  ON public.communication_escalations (clinic_id, appointment_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_escalations TO authenticated;
GRANT ALL ON public.communication_escalations TO service_role;
ALTER TABLE public.communication_escalations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "communication escalation clinic scoped select" ON public.communication_escalations;
DROP POLICY IF EXISTS "communication escalation clinic scoped insert" ON public.communication_escalations;
DROP POLICY IF EXISTS "communication escalation clinic scoped update" ON public.communication_escalations;
DROP POLICY IF EXISTS "communication escalation clinic scoped delete" ON public.communication_escalations;
CREATE POLICY "communication escalation clinic scoped select" ON public.communication_escalations FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "communication escalation clinic scoped insert" ON public.communication_escalations FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "communication escalation clinic scoped update" ON public.communication_escalations FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "communication escalation clinic scoped delete" ON public.communication_escalations FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP TRIGGER IF EXISTS communication_escalations_updated_at ON public.communication_escalations;
CREATE TRIGGER communication_escalations_updated_at BEFORE UPDATE ON public.communication_escalations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS communication_event_id uuid REFERENCES public.communication_escalations(id) ON DELETE SET NULL;
ALTER TABLE public.sms_queue
  ADD COLUMN IF NOT EXISTS communication_event_id uuid REFERENCES public.communication_escalations(id) ON DELETE SET NULL;
ALTER TABLE public.call_queue
  ADD COLUMN IF NOT EXISTS communication_event_id uuid REFERENCES public.communication_escalations(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS public.uniq_whatsapp_appointment_type_role;
DROP INDEX IF EXISTS public.uniq_sms_appointment_type_role;
DROP INDEX IF EXISTS public.uniq_call_appointment_type_role;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_legacy_appointment_type_role
  ON public.whatsapp_messages (appointment_id, message_type, recipient_role)
  WHERE appointment_id IS NOT NULL AND communication_event_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_communication_event_type_role
  ON public.whatsapp_messages (communication_event_id, message_type, recipient_role)
  WHERE communication_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sms_legacy_appointment_type_role
  ON public.sms_queue (appointment_id, message_type, recipient_role)
  WHERE appointment_id IS NOT NULL AND communication_event_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sms_communication_event_type_role
  ON public.sms_queue (communication_event_id, message_type, recipient_role)
  WHERE communication_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_call_legacy_appointment_type_role
  ON public.call_queue (appointment_id, call_type, recipient_role)
  WHERE appointment_id IS NOT NULL AND communication_event_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_call_communication_event_type_role
  ON public.call_queue (communication_event_id, call_type, recipient_role)
  WHERE communication_event_id IS NOT NULL;

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

  IF NOT COALESCE(cl.whatsapp_escalation_enabled, true) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.communication_escalations (clinic_id, appointment_id, event_key)
  VALUES (a.clinic_id, a.id, p_event_key)
  ON CONFLICT (appointment_id, event_key) DO NOTHING
  RETURNING id INTO escalation_id;

  IF escalation_id IS NULL THEN
    SELECT id INTO escalation_id
      FROM public.communication_escalations
      WHERE appointment_id = a.id AND event_key = p_event_key;
    RETURN escalation_id;
  END IF;

  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id AND clinic_id = a.clinic_id;
  SELECT r.name INTO room_name FROM public.rooms r WHERE r.id = a.room_id AND r.clinic_id = a.clinic_id;

  parent_message := format(
    E'Therapy Care – Appointment Confirmation\n\nHello %s,\n%s''s therapy session is scheduled.\n\nDate: %s\nTime: %s\nTherapist: %s\nTherapy: %s\nRoom: %s\nSession Fee: %s\n\nPlease Approve, Cancel, or request a Schedule Change.',
    COALESCE(c.parent_name, 'Parent'),
    c.full_name,
    to_char(a.appointment_date, 'DD Mon YYYY'),
    to_char(a.start_time, 'HH12:MI AM'),
    COALESCE(t.full_name, 'To be assigned'),
    COALESCE(a.specialty, 'Therapy session'),
    COALESCE(room_name, 'To be assigned'),
    COALESCE(a.session_fee::text, 'To be confirmed')
  );

  INSERT INTO public.whatsapp_messages (
    clinic_id, child_id, appointment_id, communication_event_id,
    recipient_name, phone, message, message_type, recipient_role,
    status, metadata
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
  ON CONFLICT (communication_event_id, message_type, recipient_role) DO NOTHING;

  SELECT id INTO escalation_id FROM public.communication_escalations WHERE id = escalation_id;

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
      a.clinic_id, a.id, escalation_id, 'parent', parent_phone,
      'escalation_fallback',
      format('Therapy Care: please respond regarding %s''s session on %s at %s.',
        c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM')),
      sms_at
    )
    ON CONFLICT (communication_event_id, message_type, recipient_role) DO NOTHING;

    UPDATE public.communication_escalations e
    SET sms_queue_id = s.id,
        sms_scheduled_for = s.scheduled_for
    FROM public.sms_queue s
    WHERE e.id = escalation_id AND s.communication_event_id = e.id
      AND s.message_type = 'escalation_fallback' AND s.recipient_role = 'parent';
  END IF;

  appt_at := (a.appointment_date + a.start_time) AT TIME ZONE COALESCE(cl.timezone, 'Asia/Kolkata');
  reminder_at := appt_at - make_interval(mins => COALESCE(cl.reminder_lead_minutes, 30));
  IF COALESCE(cl.call_enabled, true) AND reminder_at > now() THEN
    INSERT INTO public.call_queue (
      clinic_id, appointment_id, recipient_role, recipient_phone, call_type,
      scheduled_for
    ) VALUES (
      a.clinic_id, a.id, 'parent', parent_phone, 'reminder', reminder_at
    )
    ON CONFLICT (appointment_id, call_type, recipient_role) DO NOTHING;
  END IF;

  RETURN escalation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_appointment_communications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.start_appointment_communication_workflow(
    NEW.id,
    NEW.appointment_date::text || 'T' || NEW.start_time::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_mock_whatsapp ON public.appointments;
DROP TRIGGER IF EXISTS appointments_communications ON public.appointments;
CREATE TRIGGER appointments_communications
AFTER INSERT ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.create_appointment_communications();

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

    UPDATE public.sms_queue
    SET status = 'cancelled', last_error = 'Appointment cancelled'
    WHERE appointment_id = NEW.id AND status IN ('queued','sending');

    UPDATE public.call_queue
    SET status = 'cancelled', last_error = 'Appointment cancelled'
    WHERE appointment_id = NEW.id AND status IN ('queued','dialing');
    RETURN NEW;
  END IF;

  IF OLD.appointment_date IS DISTINCT FROM NEW.appointment_date
     OR OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    UPDATE public.communication_escalations
    SET status = 'superseded', current_stage = 'completed', cancelled_at = now(), cancel_reason = 'appointment_rescheduled'
    WHERE appointment_id = NEW.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

    UPDATE public.sms_queue
    SET status = 'cancelled', last_error = 'Appointment rescheduled'
    WHERE appointment_id = NEW.id AND status IN ('queued','sending');

    UPDATE public.call_queue
    SET status = 'cancelled', last_error = 'Appointment rescheduled'
    WHERE appointment_id = NEW.id AND status IN ('queued','dialing');

    event_key := NEW.appointment_date::text || 'T' || NEW.start_time::text;
    PERFORM public.start_appointment_communication_workflow(NEW.id, event_key);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_cancel_communications ON public.appointments;
DROP TRIGGER IF EXISTS appointments_communication_change ON public.appointments;
CREATE TRIGGER appointments_communication_change
AFTER UPDATE OF status, appointment_date, start_time ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.handle_appointment_communication_change();

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
  SELECT p.clinic_id INTO v_clinic_id FROM public.profiles p WHERE p.id = auth.uid();
  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Not authenticated or no clinic assigned'; END IF;

  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id AND clinic_id = v_clinic_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Appointment not found'; END IF;

  SELECT * INTO c FROM public.children WHERE id = a.child_id AND clinic_id = v_clinic_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id AND clinic_id = v_clinic_id;
  SELECT r.name INTO room_name FROM public.rooms r WHERE r.id = a.room_id AND r.clinic_id = v_clinic_id;

  IF p_action = 'confirm_appointment' THEN
    next_status := 'confirmed'; action_label := 'confirmed';
  ELSIF p_action = 'cancel_appointment' THEN
    next_status := 'cancel_requested'; action_label := 'cancellation requested';
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
      parent_action_note = p_note,
      status = CASE WHEN p_action = 'confirm_appointment' THEN 'confirmed' ELSE status END
  WHERE id = a.id;

  UPDATE public.whatsapp_messages
  SET status = 'mock_action_' || next_status,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'parent_action', next_status,
        'action_at', now(),
        'delivery_claim', false,
        'read_claim', false
      )
  WHERE appointment_id = a.id AND recipient_role = 'parent' AND message_type = 'appointment_confirmation'
    AND communication_event_id IN (
      SELECT id FROM public.communication_escalations
      WHERE appointment_id = a.id
    );

  UPDATE public.communication_escalations
  SET status = 'completed', current_stage = 'completed', response_action = next_status, completed_at = now(),
      cancelled_at = now(), cancel_reason = 'parent_response'
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
    )
    ON CONFLICT DO NOTHING;
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

REVOKE ALL ON FUNCTION public.start_appointment_communication_workflow(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_appointment_communications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_appointment_communication_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_mock_parent_action(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_mock_parent_action(uuid, text, text) TO authenticated;