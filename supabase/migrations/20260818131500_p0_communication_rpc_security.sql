-- P0 security hardening for queue transition RPCs.
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
