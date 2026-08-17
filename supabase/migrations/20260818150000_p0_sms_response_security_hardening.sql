-- P0 security hardening: keep correlated SMS response processing tenant-scoped.
-- The response token alone must never permit a caller from another clinic to
-- mutate an escalation or its pending call. The Android centre app must be an
-- authenticated member of the escalation's clinic.

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

  -- Never allow an authenticated user from another clinic to use a valid
  -- token/parent number pair to stop another centre's escalation.
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

-- The response table is written only by the security-definer RPC. Direct
-- authenticated INSERTs would permit fabricated audit rows and are unnecessary.
REVOKE INSERT ON public.communication_sms_responses FROM authenticated;
