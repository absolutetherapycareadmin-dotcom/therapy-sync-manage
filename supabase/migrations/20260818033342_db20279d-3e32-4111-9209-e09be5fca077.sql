ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS communication_working_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS communication_working_hours_start time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS communication_working_hours_end time NOT NULL DEFAULT '20:00';

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_communication_working_hours_check;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_communication_working_hours_check
  CHECK (communication_working_hours_start < communication_working_hours_end);

CREATE OR REPLACE FUNCTION public.is_communication_within_working_hours(
  p_clinic_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cl public.clinics%ROWTYPE;
  local_time time;
BEGIN
  SELECT * INTO cl FROM public.clinics WHERE id = p_clinic_id;
  IF cl.id IS NULL THEN RETURN false; END IF;
  IF NOT COALESCE(cl.communication_working_hours_enabled, false) THEN RETURN true; END IF;
  local_time := (p_at AT TIME ZONE COALESCE(cl.timezone, 'Asia/Kolkata'))::time;
  RETURN local_time >= cl.communication_working_hours_start
     AND local_time < cl.communication_working_hours_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_communication_escalation(
  p_escalation_id uuid,
  p_reason text DEFAULT 'admin_cancelled'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.communication_escalations%ROWTYPE;
  caller_clinic uuid;
  caller_role text;
BEGIN
  SELECT p.clinic_id, p.role INTO caller_clinic, caller_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF caller_clinic IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no clinic assigned';
  END IF;
  IF caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Centre Admin role required';
  END IF;

  SELECT * INTO e
  FROM public.communication_escalations
  WHERE id = p_escalation_id
    AND clinic_id = caller_clinic
  FOR UPDATE;

  IF e.id IS NULL THEN RETURN false; END IF;
  IF e.status NOT IN ('waiting_whatsapp','waiting_sms','waiting_call') THEN RETURN true; END IF;

  UPDATE public.communication_escalations
  SET status = 'cancelled', current_stage = 'completed', cancelled_at = now(), cancel_reason = left(COALESCE(p_reason, 'admin_cancelled'), 200)
  WHERE id = e.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

  UPDATE public.whatsapp_messages
  SET status = 'cancelled', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('invalidated_reason', COALESCE(p_reason, 'admin_cancelled'))
  WHERE communication_event_id = e.id AND status IN ('queued','manual_opened');

  UPDATE public.sms_queue
  SET status = 'cancelled', last_error = 'Communication escalation cancelled by admin'
  WHERE communication_event_id = e.id AND status IN ('queued','sending');

  UPDATE public.call_queue
  SET status = 'cancelled', last_error = 'Communication escalation cancelled by admin'
  WHERE communication_event_id = e.id AND status IN ('queued','dialing');

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_communication_escalation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_communication_escalation(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.is_communication_within_working_hours(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_communication_within_working_hours(uuid,timestamptz) TO authenticated;

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS device_subscription_id bigint;
ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_device_subscription_id_check;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_device_subscription_id_check
  CHECK (device_subscription_id IS NULL OR device_subscription_id > 0);

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS whatsapp_mode text NOT NULL DEFAULT 'free_deep_link';
ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_whatsapp_mode_check;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_whatsapp_mode_check
  CHECK (whatsapp_mode IN ('free_deep_link','paid_api'));

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS whatsapp_messages_provider_message_id_idx
  ON public.whatsapp_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider_message_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_valid boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_message_id, event_type)
);

CREATE INDEX IF NOT EXISTS whatsapp_provider_events_clinic_received_idx
  ON public.whatsapp_provider_events(clinic_id, received_at DESC);

ALTER TABLE public.whatsapp_provider_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp provider events clinic scoped select" ON public.whatsapp_provider_events;
CREATE POLICY "whatsapp provider events clinic scoped select"
  ON public.whatsapp_provider_events FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

GRANT SELECT ON public.whatsapp_provider_events TO authenticated;
GRANT ALL ON public.whatsapp_provider_events TO service_role;

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_provider_message_id_unique;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_provider_message_id_unique
  UNIQUE (provider_message_id);

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_provider_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_provider_status_check
  CHECK (
    provider_status IS NULL OR
    provider_status IN ('accepted','sent','delivered','read','failed','rejected')
  );

ALTER TABLE public.whatsapp_provider_events
  DROP CONSTRAINT IF EXISTS whatsapp_provider_events_provider_message_id_check;
ALTER TABLE public.whatsapp_provider_events
  ADD CONSTRAINT whatsapp_provider_events_provider_message_id_check
  CHECK (provider_message_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.set_whatsapp_mode(
  p_clinic_id uuid,
  p_mode text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_clinic uuid;
  caller_role text;
BEGIN
  SELECT p.clinic_id, p.role
    INTO caller_clinic, caller_role
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF caller_clinic IS NULL OR caller_clinic <> p_clinic_id THEN
    RAISE EXCEPTION 'Centre access denied';
  END IF;
  IF caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Centre Admin role required';
  END IF;
  IF p_mode NOT IN ('free_deep_link', 'paid_api') THEN
    RAISE EXCEPTION 'Unsupported WhatsApp mode';
  END IF;

  UPDATE public.clinics
  SET whatsapp_mode = p_mode
  WHERE id = p_clinic_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_whatsapp_mode(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_mode(uuid,text) TO authenticated;

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

    event_key := 'reschedule:' || gen_random_uuid()::text;
    PERFORM public.start_appointment_communication_workflow(NEW.id, event_key);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_appointment_communication_change() FROM PUBLIC;