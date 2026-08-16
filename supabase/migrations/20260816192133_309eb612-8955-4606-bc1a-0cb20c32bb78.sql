
-- ============ clinic communication device config ============
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS device_phone text,
  ADD COLUMN IF NOT EXISTS device_label text,
  ADD COLUMN IF NOT EXISTS sms_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS call_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes integer NOT NULL DEFAULT 30;

-- ============ mock whatsapp workflow ============
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS parent_confirmation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS parent_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_action_note text;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_role text NOT NULL DEFAULT 'parent',
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_appointment
  ON public.whatsapp_messages (clinic_id, appointment_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_appointment_type_role
  ON public.whatsapp_messages (appointment_id, message_type, recipient_role)
  WHERE appointment_id IS NOT NULL;

-- ============ device SMS queue ============
CREATE TABLE IF NOT EXISTS public.sms_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  recipient_role text NOT NULL DEFAULT 'parent',
  recipient_phone text NOT NULL,
  message_type text NOT NULL DEFAULT 'general',
  message text NOT NULL,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_queue_clinic_schedule_idx
  ON public.sms_queue (clinic_id, status, scheduled_for);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sms_appointment_type_role
  ON public.sms_queue (appointment_id, message_type, recipient_role)
  WHERE appointment_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_queue TO authenticated;
GRANT ALL ON public.sms_queue TO service_role;
ALTER TABLE public.sms_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sms clinic scoped select" ON public.sms_queue;
DROP POLICY IF EXISTS "sms clinic scoped insert" ON public.sms_queue;
DROP POLICY IF EXISTS "sms clinic scoped update" ON public.sms_queue;
DROP POLICY IF EXISTS "sms clinic scoped delete" ON public.sms_queue;
CREATE POLICY "sms clinic scoped select" ON public.sms_queue FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "sms clinic scoped insert" ON public.sms_queue FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "sms clinic scoped update" ON public.sms_queue FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "sms clinic scoped delete" ON public.sms_queue FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP TRIGGER IF EXISTS sms_queue_updated_at ON public.sms_queue;
CREATE TRIGGER sms_queue_updated_at BEFORE UPDATE ON public.sms_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ device call queue ============
CREATE TABLE IF NOT EXISTS public.call_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  recipient_role text NOT NULL DEFAULT 'parent',
  recipient_phone text NOT NULL,
  call_type text NOT NULL DEFAULT 'reminder',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dialing','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  dialed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_queue_clinic_schedule_idx
  ON public.call_queue (clinic_id, status, scheduled_for);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_call_appointment_type_role
  ON public.call_queue (appointment_id, call_type, recipient_role)
  WHERE appointment_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_queue TO authenticated;
GRANT ALL ON public.call_queue TO service_role;
ALTER TABLE public.call_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call clinic scoped select" ON public.call_queue;
DROP POLICY IF EXISTS "call clinic scoped insert" ON public.call_queue;
DROP POLICY IF EXISTS "call clinic scoped update" ON public.call_queue;
DROP POLICY IF EXISTS "call clinic scoped delete" ON public.call_queue;
CREATE POLICY "call clinic scoped select" ON public.call_queue FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "call clinic scoped insert" ON public.call_queue FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "call clinic scoped update" ON public.call_queue FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()))
  WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "call clinic scoped delete" ON public.call_queue FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP TRIGGER IF EXISTS call_queue_updated_at ON public.call_queue;
CREATE TRIGGER call_queue_updated_at BEFORE UPDATE ON public.call_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.is_valid_phone(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_phone(p_phone) ~ '^\+?[0-9]{8,15}$';
$$;

-- ============ appointment triggered communications ============
CREATE OR REPLACE FUNCTION public.create_appointment_communications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.children%ROWTYPE;
  t public.therapists%ROWTYPE;
  cl public.clinics%ROWTYPE;
  parent_phone text;
  appt_at timestamptz;
  reminder_at timestamptz;
  parent_message text;
  reminder_message text;
  room_name text;
BEGIN
  SELECT * INTO c FROM public.children WHERE id = NEW.child_id AND clinic_id = NEW.clinic_id;
  IF c.id IS NULL THEN RETURN NEW; END IF;

  parent_phone := public.normalize_phone(c.parent_phone);
  IF NOT public.is_valid_phone(parent_phone) THEN RETURN NEW; END IF;

  SELECT * INTO t FROM public.therapists WHERE id = NEW.therapist_id AND clinic_id = NEW.clinic_id;
  SELECT * INTO cl FROM public.clinics WHERE id = NEW.clinic_id;
  SELECT r.name INTO room_name FROM public.rooms r WHERE r.id = NEW.room_id AND r.clinic_id = NEW.clinic_id;

  appt_at := (NEW.appointment_date + NEW.start_time) AT TIME ZONE COALESCE(cl.timezone, 'Asia/Kolkata');
  reminder_at := appt_at - make_interval(mins => COALESCE(cl.reminder_lead_minutes, 30));

  parent_message := format(
    E'Therapy Care – Appointment Confirmation\n\nHello %s,\n%s''s therapy session is scheduled.\n\nDate: %s\nTime: %s\nTherapist: %s\nTherapy: %s\nRoom: %s\nSession Fee: %s\n\nPlease confirm, cancel or request a reschedule.',
    COALESCE(c.parent_name, 'Parent'),
    c.full_name,
    to_char(NEW.appointment_date, 'DD Mon YYYY'),
    to_char(NEW.start_time, 'HH12:MI AM'),
    COALESCE(t.full_name, 'To be assigned'),
    COALESCE(NEW.specialty, 'Therapy session'),
    COALESCE(room_name, 'To be assigned'),
    COALESCE(NEW.session_fee::text, 'To be confirmed')
  );

  -- Step 1: mock WhatsApp only, never a real provider call
  INSERT INTO public.whatsapp_messages (
    clinic_id, child_id, appointment_id, recipient_name, phone, message,
    message_type, recipient_role, status, metadata, sent_at
  ) VALUES (
    NEW.clinic_id, NEW.child_id, NEW.id, c.parent_name, parent_phone, parent_message,
    'appointment_confirmation', 'parent', 'mock_sent',
    jsonb_build_object('mode', 'mock', 'buttons', jsonb_build_array('Confirm', 'Cancel', 'Reschedule')),
    now()
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.notifications (clinic_id, title, body, type)
  VALUES (
    NEW.clinic_id,
    'Mock WhatsApp confirmation queued',
    format('Appointment confirmation for %s is ready in WhatsApp Centre. No real WhatsApp message was sent.', c.full_name),
    'whatsapp_mock'
  );

  -- Step 2: device SMS – booking confirmation + lead-time reminder
  IF COALESCE(cl.sms_enabled, true) THEN
    INSERT INTO public.sms_queue (clinic_id, appointment_id, recipient_role, recipient_phone, message_type, message, scheduled_for)
    VALUES (
      NEW.clinic_id, NEW.id, 'parent', parent_phone, 'appointment_confirmation',
      format('Therapy Care: session for %s on %s at %s. Reply or call the centre for changes.',
        c.full_name, to_char(NEW.appointment_date, 'DD Mon YYYY'), to_char(NEW.start_time, 'HH12:MI AM')),
      now()
    )
    ON CONFLICT DO NOTHING;

    reminder_message := format('Therapy Care reminder: %s''s session starts at %s today.',
      c.full_name, to_char(NEW.start_time, 'HH12:MI AM'));

    IF reminder_at > now() THEN
      INSERT INTO public.sms_queue (clinic_id, appointment_id, recipient_role, recipient_phone, message_type, message, scheduled_for)
      VALUES (NEW.clinic_id, NEW.id, 'parent', parent_phone, 'reminder', reminder_message, reminder_at)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Step 3: device cellular call reminder
  IF COALESCE(cl.call_enabled, true) AND reminder_at > now() THEN
    INSERT INTO public.call_queue (clinic_id, appointment_id, recipient_role, recipient_phone, call_type, scheduled_for)
    VALUES (NEW.clinic_id, NEW.id, 'parent', parent_phone, 'reminder', reminder_at)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_mock_whatsapp ON public.appointments;
DROP TRIGGER IF EXISTS appointments_communications ON public.appointments;
CREATE TRIGGER appointments_communications
AFTER INSERT ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.create_appointment_communications();

-- cancel pending device communications when the appointment is cancelled
CREATE OR REPLACE FUNCTION public.cancel_appointment_communications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'cancelled' THEN
    UPDATE public.sms_queue SET status = 'cancelled'
      WHERE appointment_id = NEW.id AND status = 'queued';
    UPDATE public.call_queue SET status = 'cancelled'
      WHERE appointment_id = NEW.id AND status = 'queued';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_cancel_communications ON public.appointments;
CREATE TRIGGER appointments_cancel_communications
AFTER UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.cancel_appointment_communications();

-- ============ mock parent action ============
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
  cl public.clinics%ROWTYPE;
  v_clinic_id uuid;
  next_status text;
  action_label text;
  therapist_notified boolean := false;
  room_name text;
BEGIN
  SELECT p.clinic_id INTO v_clinic_id FROM public.profiles p WHERE p.id = auth.uid();
  IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'Not authenticated or no clinic assigned'; END IF;

  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id AND clinic_id = v_clinic_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Appointment not found'; END IF;

  SELECT * INTO c FROM public.children WHERE id = a.child_id AND clinic_id = v_clinic_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id AND clinic_id = v_clinic_id;
  SELECT * INTO cl FROM public.clinics WHERE id = v_clinic_id;
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

  -- idempotent: a parent action is processed once
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
      read_at = COALESCE(read_at, now()),
      delivered_at = COALESCE(delivered_at, now()),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('parent_action', next_status, 'action_at', now())
  WHERE appointment_id = a.id AND recipient_role = 'parent' AND message_type = 'appointment_confirmation';

  IF p_action = 'confirm_appointment' AND t.id IS NOT NULL AND public.is_valid_phone(t.phone) THEN
    INSERT INTO public.whatsapp_messages (
      clinic_id, child_id, appointment_id, recipient_name, phone, message,
      message_type, recipient_role, status, metadata, sent_at
    ) VALUES (
      v_clinic_id, a.child_id, a.id, t.full_name, public.normalize_phone(t.phone),
      format(E'Therapy Care – Appointment Confirmed\n\n%s''s parent has confirmed the session.\n\nDate: %s\nTime: %s\nTherapy: %s\nRoom: %s',
        c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'),
        COALESCE(a.specialty, 'Therapy session'), COALESCE(room_name, 'To be assigned')),
      'appointment_confirmed', 'therapist', 'mock_sent',
      jsonb_build_object('mode', 'mock', 'trigger', 'parent_confirmation'), now()
    )
    ON CONFLICT DO NOTHING;
    therapist_notified := true;
  END IF;

  -- Step 2: status-update SMS from the centre device
  IF COALESCE(cl.sms_enabled, true) AND public.is_valid_phone(c.parent_phone) THEN
    INSERT INTO public.sms_queue (clinic_id, appointment_id, recipient_role, recipient_phone, message_type, message, scheduled_for)
    VALUES (v_clinic_id, a.id, 'parent', public.normalize_phone(c.parent_phone), 'status_update',
      format('Therapy Care: session for %s on %s at %s is now %s.',
        c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'), action_label),
      now())
    ON CONFLICT (appointment_id, message_type, recipient_role) DO UPDATE
      SET message = EXCLUDED.message, status = 'queued', scheduled_for = now(), attempts = 0, last_error = NULL;
  END IF;

  IF p_action <> 'confirm_appointment' THEN
    UPDATE public.sms_queue SET status = 'cancelled'
      WHERE appointment_id = a.id AND status = 'queued' AND message_type = 'reminder';
    UPDATE public.call_queue SET status = 'cancelled'
      WHERE appointment_id = a.id AND status = 'queued';
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
GRANT EXECUTE ON FUNCTION public.process_mock_parent_action(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_appointment_communications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_appointment_communications() FROM PUBLIC;
