-- P1 communication controls: centre working hours, explicit escalation cancellation,
-- and an authoritative RPC for queue workers. Defaults preserve existing behaviour.

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
BEGIN
  SELECT p.clinic_id INTO caller_clinic
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF caller_clinic IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or no clinic assigned';
  END IF;

  SELECT * INTO e
  FROM public.communication_escalations
  WHERE id = p_escalation_id
    AND clinic_id = caller_clinic
  FOR UPDATE;

  IF e.id IS NULL THEN RETURN false; END IF;
  IF e.status NOT IN ('waiting_whatsapp','waiting_sms','waiting_call') THEN RETURN true; END IF;

  UPDATE public.communication_escalations
  SET status = 'cancelled',
      current_stage = 'completed',
      cancelled_at = now(),
      cancel_reason = left(COALESCE(p_reason, 'admin_cancelled'), 200)
  WHERE id = e.id
    AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

  UPDATE public.whatsapp_messages
  SET status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('invalidated_reason', COALESCE(p_reason, 'admin_cancelled'))
  WHERE communication_event_id = e.id
    AND status IN ('queued','manual_opened');

  UPDATE public.sms_queue
  SET status = 'cancelled', last_error = 'Communication escalation cancelled by admin'
  WHERE communication_event_id = e.id
    AND status IN ('queued','sending');

  UPDATE public.call_queue
  SET status = 'cancelled', last_error = 'Communication escalation cancelled by admin'
  WHERE communication_event_id = e.id
    AND status IN ('queued','dialing');

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_communication_escalation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_communication_escalation(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.is_communication_within_working_hours(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_communication_within_working_hours(uuid,timestamptz) TO authenticated;
