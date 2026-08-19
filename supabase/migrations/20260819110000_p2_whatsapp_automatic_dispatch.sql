-- WhatsApp-only delivery/preparation hardening.
-- Free mode prepares a due notification for manual wa.me opening.
-- Paid mode is dispatched server-side by the scheduled Edge Function.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS whatsapp_notification_lead_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_whatsapp_notification_lead_minutes_check;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_whatsapp_notification_lead_minutes_check
  CHECK (whatsapp_notification_lead_minutes >= 0 AND whatsapp_notification_lead_minutes <= 10080);

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS whatsapp_messages_due_idx
  ON public.whatsapp_messages (clinic_id, status, scheduled_for)
  WHERE appointment_id IS NOT NULL;

-- WhatsApp has its own country-aware normalization so the existing SMS/call
-- normalize_phone behaviour is not changed.
CREATE OR REPLACE FUNCTION public.normalize_whatsapp_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
BEGIN
  IF digits ~ '^0[6-9][0-9]{9}$' THEN
    digits := '91' || right(digits, 10);
  ELSIF digits ~ '^[6-9][0-9]{9}$' THEN
    digits := '91' || digits;
  ELSIF digits ~ '^91[6-9][0-9]{9}$' THEN
    NULL;
  ELSE
    RETURN NULLIF(digits, '');
  END IF;
  RETURN '+' || digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_whatsapp_phone(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_whatsapp_phone(p_phone) ~ '^\+?[0-9]{8,15}$';
$$;

-- Existing legacy mock rows were never real deliveries. Make that explicit and
-- put appointment confirmations back into the real queued/manual-open model.
UPDATE public.whatsapp_messages
SET status = 'queued',
    sent_at = NULL,
    delivered_at = NULL,
    read_at = NULL,
    error_message = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object('delivery_claim', false, 'read_claim', false, 'legacy_mock_normalized', true)
WHERE appointment_id IS NOT NULL
  AND recipient_role = 'parent'
  AND message_type = 'appointment_confirmation'
  AND status = 'mock_sent';

-- Schedule appointment confirmation messages from the appointment's local
-- clinic time. Existing SMS/call queues remain separate; only the escalation
-- fallback is aligned to the WhatsApp due time.
CREATE OR REPLACE FUNCTION public.set_whatsapp_message_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  appt public.appointments%ROWTYPE;
  clinic public.clinics%ROWTYPE;
  appointment_at timestamptz;
BEGIN
  IF NEW.appointment_id IS NULL OR NEW.message_type <> 'appointment_confirmation' OR NEW.recipient_role <> 'parent' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO appt FROM public.appointments WHERE id = NEW.appointment_id;
  IF appt.id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO clinic FROM public.clinics WHERE id = appt.clinic_id;

  appointment_at := (appt.appointment_date + appt.start_time)
    AT TIME ZONE COALESCE(clinic.timezone, 'Asia/Kolkata');
  NEW.scheduled_for := GREATEST(
    now(),
    appointment_at - make_interval(mins => GREATEST(COALESCE(clinic.whatsapp_notification_lead_minutes, 0), 0))
  );
  NEW.phone := COALESCE(public.normalize_whatsapp_phone(NEW.phone), NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_messages_schedule ON public.whatsapp_messages;
CREATE TRIGGER whatsapp_messages_schedule
BEFORE INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_message_schedule();

CREATE OR REPLACE FUNCTION public.align_whatsapp_escalation_sms_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wa_due timestamptz;
  wait_minutes integer;
BEGIN
  IF NEW.communication_event_id IS NULL OR NEW.message_type <> 'escalation_fallback' THEN
    RETURN NEW;
  END IF;

  SELECT w.scheduled_for, c.whatsapp_to_sms_wait_minutes
    INTO wa_due, wait_minutes
  FROM public.communication_escalations e
  JOIN public.whatsapp_messages w
    ON w.communication_event_id = e.id
   AND w.message_type = 'appointment_confirmation'
   AND w.recipient_role = 'parent'
  JOIN public.clinics c ON c.id = e.clinic_id
  WHERE e.id = NEW.communication_event_id
  LIMIT 1;

  IF wa_due IS NOT NULL THEN
    NEW.scheduled_for := wa_due + make_interval(mins => GREATEST(COALESCE(wait_minutes, 60), 0));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sms_queue_align_whatsapp_schedule ON public.sms_queue;
CREATE TRIGGER sms_queue_align_whatsapp_schedule
BEFORE INSERT ON public.sms_queue
FOR EACH ROW EXECUTE FUNCTION public.align_whatsapp_escalation_sms_schedule();

-- Keep already-created queue rows aligned after the migration.
UPDATE public.whatsapp_messages w
SET scheduled_for = GREATEST(
  now(),
  ((a.appointment_date + a.start_time) AT TIME ZONE COALESCE(c.timezone, 'Asia/Kolkata'))
    - make_interval(mins => GREATEST(COALESCE(c.whatsapp_notification_lead_minutes, 0), 0))
),
phone = COALESCE(public.normalize_whatsapp_phone(w.phone), w.phone)
FROM public.appointments a
JOIN public.clinics c ON c.id = a.clinic_id
WHERE w.appointment_id = a.id
  AND w.recipient_role = 'parent'
  AND w.message_type = 'appointment_confirmation'
  AND w.status IN ('queued','manual_opened');

UPDATE public.sms_queue s
SET scheduled_for = w.scheduled_for + make_interval(mins => GREATEST(COALESCE(c.whatsapp_to_sms_wait_minutes, 60), 0))
FROM public.whatsapp_messages w
JOIN public.clinics c ON c.id = w.clinic_id
WHERE s.communication_event_id = w.communication_event_id
  AND s.message_type = 'escalation_fallback'
  AND w.message_type = 'appointment_confirmation';

CREATE OR REPLACE FUNCTION public.set_whatsapp_notification_lead(
  p_clinic_id uuid,
  p_lead_minutes integer
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
  SELECT p.clinic_id, p.role INTO caller_clinic, caller_role
  FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL OR caller_clinic <> p_clinic_id THEN
    RAISE EXCEPTION 'Centre access denied';
  END IF;
  IF caller_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Centre Admin role required';
  END IF;
  IF p_lead_minutes < 0 OR p_lead_minutes > 10080 THEN
    RAISE EXCEPTION 'WhatsApp notification lead time must be between 0 and 10080 minutes';
  END IF;
  UPDATE public.clinics
  SET whatsapp_notification_lead_minutes = p_lead_minutes
  WHERE id = p_clinic_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_whatsapp_notification_lead(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_notification_lead(uuid, integer) TO authenticated;

-- Backfill only appointments that have no communication event at all. Existing
-- cancellation/admin-stop events are never recreated by this helper.
CREATE OR REPLACE FUNCTION public.prepare_appointment_whatsapp_notifications(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.appointments%ROWTYPE;
  prepared integer := 0;
  event_id uuid;
BEGIN
  FOR a IN
    SELECT a.*
    FROM public.appointments a
    WHERE a.status <> 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM public.communication_escalations e WHERE e.appointment_id = a.id
      )
    ORDER BY a.appointment_date, a.start_time
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
  LOOP
    event_id := public.start_appointment_communication_workflow(a.id, 'backfill:' || a.id::text);
    IF event_id IS NOT NULL THEN prepared := prepared + 1; END IF;
  END LOOP;
  RETURN prepared;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_appointment_whatsapp_notifications(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_appointment_whatsapp_notifications(integer) TO service_role;

-- Parent WhatsApp responses are accepted only from the phone stored on the
-- appointment's parent record and only for an active communication event.
CREATE OR REPLACE FUNCTION public.process_parent_whatsapp_response(
  p_sender_phone text,
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_sender text := public.normalize_whatsapp_phone(p_sender_phone);
  body text := lower(trim(COALESCE(p_message, '')));
  action text;
  e public.communication_escalations%ROWTYPE;
  a public.appointments%ROWTYPE;
  c public.children%ROWTYPE;
  matched_count integer;
BEGIN
  IF normalized_sender IS NULL OR NOT public.is_valid_whatsapp_phone(normalized_sender) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_sender_phone');
  END IF;

  IF body IN ('approve','approved','confirm','confirmed','yes') THEN
    action := 'confirmed';
  ELSIF body IN ('cancel','cancelled','decline','declined','no') THEN
    action := 'declined';
  ELSIF body IN ('change','reschedule','reschedule requested','schedule change','schedule_change') THEN
    action := 'reschedule_requested';
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_response');
  END IF;

  SELECT count(*) INTO matched_count
  FROM public.communication_escalations e0
  JOIN public.appointments a0 ON a0.id = e0.appointment_id
  JOIN public.children c0 ON c0.id = a0.child_id AND c0.clinic_id = a0.clinic_id
  WHERE e0.status IN ('waiting_whatsapp','waiting_sms','waiting_call')
    AND a0.status <> 'cancelled'
    AND public.normalize_whatsapp_phone(c0.parent_phone) = normalized_sender;

  IF matched_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', CASE WHEN matched_count = 0 THEN 'unmatched_response' ELSE 'ambiguous_response' END);
  END IF;

  SELECT e0.* INTO e
  FROM public.communication_escalations e0
  JOIN public.appointments a0 ON a0.id = e0.appointment_id
  JOIN public.children c0 ON c0.id = a0.child_id AND c0.clinic_id = a0.clinic_id
  WHERE e0.status IN ('waiting_whatsapp','waiting_sms','waiting_call')
    AND a0.status <> 'cancelled'
    AND public.normalize_whatsapp_phone(c0.parent_phone) = normalized_sender
  ORDER BY e0.created_at DESC
  LIMIT 1
  FOR UPDATE OF e0;

  SELECT * INTO a FROM public.appointments WHERE id = e.appointment_id FOR UPDATE;
  SELECT * INTO c FROM public.children WHERE id = a.child_id AND clinic_id = a.clinic_id;

  UPDATE public.appointments
  SET parent_confirmation_status = action,
      parent_action_at = now(),
      parent_action_note = 'WhatsApp parent response'
  WHERE id = a.id;

  UPDATE public.whatsapp_messages
  SET status = 'parent_responded_' || action,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('parent_response', action, 'response_at', now(), 'delivery_claim', false, 'read_claim', false)
  WHERE communication_event_id = e.id
    AND recipient_role = 'parent';

  UPDATE public.communication_escalations
  SET status = 'completed', current_stage = 'completed', response_action = action,
      completed_at = now(), cancelled_at = now(), cancel_reason = 'parent_response'
  WHERE id = e.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

  UPDATE public.sms_queue
  SET status = 'cancelled', last_error = 'Parent responded via WhatsApp'
  WHERE appointment_id = a.id AND status IN ('queued','sending')
    AND message_type = 'escalation_fallback';

  UPDATE public.call_queue
  SET status = 'cancelled', last_error = 'Parent responded via WhatsApp'
  WHERE communication_event_id = e.id AND status IN ('queued','dialing');

  INSERT INTO public.notifications (clinic_id, title, body, type)
  VALUES (
    a.clinic_id,
    'Parent responded on WhatsApp',
    format('%s: %s for %s on %s at %s.', c.full_name, action, c.full_name, to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM')),
    'appointment_parent_action'
  );

  RETURN jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', action);
END;
$$;

REVOKE ALL ON FUNCTION public.process_parent_whatsapp_response(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_parent_whatsapp_response(text, text) TO service_role;

-- A private per-project dispatch secret is generated once. It is never exposed
-- through the API and is only used by the scheduled Edge Function invocation.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.whatsapp_dispatch_secrets (
  id boolean PRIMARY KEY DEFAULT true,
  secret text NOT NULL
);
INSERT INTO private.whatsapp_dispatch_secrets (id, secret)
VALUES (true, encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON private.whatsapp_dispatch_secrets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_whatsapp_dispatch_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.whatsapp_dispatch_secrets
    WHERE id = true AND secret = p_secret
  );
$$;
REVOKE ALL ON FUNCTION public.verify_whatsapp_dispatch_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_whatsapp_dispatch_secret(text) TO service_role;

-- Supabase-hosted projects provide pg_cron/pg_net. The conditional blocks keep
-- local database validation portable when those optional extensions are absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    EXECUTE $cron$
      SELECT cron.schedule(
        'therapy-care-whatsapp-dispatch',
        '* * * * *',
        $job$
          SELECT net.http_post(
            url := 'https://yxqbruyeolrrwfolympu.supabase.co/functions/v1/whatsapp-dispatch',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-whatsapp-dispatch-secret', (SELECT secret FROM private.whatsapp_dispatch_secrets WHERE id = true)
            ),
            body := '{}'::jsonb
          );
        $job$
      );
    $cron$;
  END IF;
END $$;
