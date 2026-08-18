ALTER TABLE public.communication_escalations
  ADD COLUMN IF NOT EXISTS sms_response_token text;

UPDATE public.communication_escalations
SET sms_response_token = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
WHERE sms_response_token IS NULL;

ALTER TABLE public.communication_escalations
  ALTER COLUMN sms_response_token SET DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

CREATE UNIQUE INDEX IF NOT EXISTS communication_escalations_sms_response_token_idx
  ON public.communication_escalations (sms_response_token)
  WHERE sms_response_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.communication_sms_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  communication_event_id uuid NOT NULL REFERENCES public.communication_escalations(id) ON DELETE CASCADE,
  sender_phone text NOT NULL,
  message text NOT NULL,
  response_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (communication_event_id, response_hash)
);

CREATE INDEX IF NOT EXISTS communication_sms_responses_clinic_idx
  ON public.communication_sms_responses (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS communication_sms_responses_appointment_idx
  ON public.communication_sms_responses (appointment_id, created_at DESC);

GRANT SELECT ON public.communication_sms_responses TO authenticated;
GRANT ALL ON public.communication_sms_responses TO service_role;
ALTER TABLE public.communication_sms_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "communication sms responses clinic scoped select" ON public.communication_sms_responses;
CREATE POLICY "communication sms responses clinic scoped select"
  ON public.communication_sms_responses FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE OR REPLACE FUNCTION public.decorate_escalation_sms_with_response_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token text;
BEGIN
  IF NEW.communication_event_id IS NULL OR NEW.message_type <> 'escalation_fallback' THEN
    RETURN NEW;
  END IF;

  SELECT sms_response_token INTO token
  FROM public.communication_escalations
  WHERE id = NEW.communication_event_id;

  IF token IS NOT NULL AND position(token IN NEW.message) = 0 THEN
    NEW.message := NEW.message || format(
      E'\n\nReply with APPROVE %s, CANCEL %s, or CHANGE %s.',
      token, token, token
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sms_queue_escalation_response_token ON public.sms_queue;
CREATE TRIGGER sms_queue_escalation_response_token
BEFORE INSERT ON public.sms_queue
FOR EACH ROW EXECUTE FUNCTION public.decorate_escalation_sms_with_response_token();

CREATE OR REPLACE FUNCTION public.process_parent_sms_response(
  p_sender_phone text,
  p_response_token text,
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_sender text := public.normalize_phone(p_sender_phone);
  clean_message text := trim(COALESCE(p_message, ''));
  response_hash text;
  e public.communication_escalations%ROWTYPE;
  parent_phone text;
  inserted_count integer := 0;
BEGIN
  IF auth.uid() IS NULL
     OR clean_message = ''
     OR p_response_token IS NULL
     OR trim(p_response_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_response');
  END IF;

  SELECT * INTO e
  FROM public.communication_escalations
  WHERE sms_response_token = lower(trim(p_response_token));

  IF e.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unmatched_response');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.clinic_id = e.clinic_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unmatched_response');
  END IF;

  SELECT public.normalize_phone(c.parent_phone) INTO parent_phone
  FROM public.appointments a
  JOIN public.children c ON c.id = a.child_id AND c.clinic_id = a.clinic_id
  WHERE a.id = e.appointment_id AND a.clinic_id = e.clinic_id;

  IF parent_phone IS NULL OR normalized_sender <> parent_phone THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_mismatch');
  END IF;

  response_hash := md5(lower(clean_message));

  INSERT INTO public.communication_sms_responses (
    clinic_id, appointment_id, communication_event_id,
    sender_phone, message, response_hash
  ) VALUES (
    e.clinic_id, e.appointment_id, e.id,
    normalized_sender, clean_message, response_hash
  )
  ON CONFLICT (communication_event_id, response_hash) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF e.status <> 'waiting_call' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_stopped', true,
      'recorded', inserted_count > 0
    );
  END IF;

  UPDATE public.communication_escalations
  SET status = 'completed',
      current_stage = 'completed',
      response_action = 'sms_response',
      completed_at = now()
  WHERE id = e.id
    AND status = 'waiting_call';

  UPDATE public.call_queue
  SET status = 'cancelled',
      last_error = 'Parent responded by SMS'
  WHERE communication_event_id = e.id
    AND call_type = 'escalation'
    AND status IN ('queued', 'dialing');

  RETURN jsonb_build_object(
    'ok', true,
    'already_stopped', false,
    'recorded', inserted_count > 0,
    'escalation_id', e.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_parent_sms_response(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_parent_sms_response(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_parent_sms_response(text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.decorate_escalation_sms_with_response_token() FROM PUBLIC;
REVOKE INSERT ON public.communication_sms_responses FROM authenticated;