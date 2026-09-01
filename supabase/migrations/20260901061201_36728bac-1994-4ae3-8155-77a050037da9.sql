-- ============ 1. ROLES ============
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner','admin','therapist','staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

INSERT INTO public.user_roles (user_id, clinic_id, role)
SELECT p.id, p.clinic_id,
       CASE WHEN p.role IN ('owner','admin','therapist','staff') THEN p.role ELSE 'admin' END::public.app_role
FROM public.profiles p
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_centre_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('owner','admin')
  ) OR EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role IN ('owner','admin')
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_centre_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_centre_admin(uuid) TO authenticated, service_role;

-- ============ 2. HISTORY ============
CREATE TABLE IF NOT EXISTS public.appointment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  actor_user_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appointment_history TO authenticated;
GRANT ALL ON public.appointment_history TO service_role;
ALTER TABLE public.appointment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Centre members read appointment history" ON public.appointment_history;
CREATE POLICY "Centre members read appointment history" ON public.appointment_history
FOR SELECT TO authenticated
USING (clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS appointment_history_appointment_idx ON public.appointment_history (appointment_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_appointment_event(
  p_appointment_id uuid, p_event text, p_actor text, p_actor_user_id uuid, p_details jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_clinic FROM public.appointments WHERE id = p_appointment_id;
  IF v_clinic IS NULL THEN RETURN; END IF;
  INSERT INTO public.appointment_history (clinic_id, appointment_id, event, actor, actor_user_id, details)
  VALUES (v_clinic, p_appointment_id, p_event, COALESCE(p_actor,'system'), p_actor_user_id, COALESCE(p_details,'{}'::jsonb));
END; $$;
REVOKE EXECUTE ON FUNCTION public.log_appointment_event(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_appointment_event(uuid, text, text, uuid, jsonb) TO service_role;

-- ============ 3. NOTIFICATION TRACEABILITY ============
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS therapist_id uuid REFERENCES public.therapists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS child_id uuid REFERENCES public.children(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS event text;

-- ============ 4. PARENT ACTION TOKENS ============
CREATE TABLE IF NOT EXISTS public.appointment_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('confirm','cancel','reschedule')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, action)
);
GRANT ALL ON public.appointment_action_tokens TO service_role;
ALTER TABLE public.appointment_action_tokens ENABLE ROW LEVEL SECURITY;
-- no anon/authenticated policies: tokens are validated server-side only

-- ============ 5. APPOINTMENT REQUESTS ============
CREATE TABLE IF NOT EXISTS public.appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.children(id) ON DELETE SET NULL,
  therapist_id uuid REFERENCES public.therapists(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('confirmation','cancellation','schedule_change')),
  requested_by text NOT NULL DEFAULT 'parent',
  requested_date date,
  requested_time time,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appointment_requests TO authenticated;
GRANT ALL ON public.appointment_requests TO service_role;
ALTER TABLE public.appointment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Centre members read appointment requests" ON public.appointment_requests;
CREATE POLICY "Centre members read appointment requests" ON public.appointment_requests
FOR SELECT TO authenticated
USING (clinic_id IN (SELECT clinic_id FROM public.profiles WHERE id = auth.uid()));
DROP TRIGGER IF EXISTS appointment_requests_updated_at ON public.appointment_requests;
CREATE TRIGGER appointment_requests_updated_at BEFORE UPDATE ON public.appointment_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ 6. HONEST BATCH STATES ============
ALTER TABLE public.whatsapp_automation_items DROP CONSTRAINT IF EXISTS whatsapp_automation_items_status_check;
ALTER TABLE public.whatsapp_automation_items ADD CONSTRAINT whatsapp_automation_items_status_check
CHECK (status IN ('queued','processing','opened','confirmed','failed','skipped','sent'));

DROP FUNCTION IF EXISTS public.record_whatsapp_automation_result(uuid, text, text);
CREATE OR REPLACE FUNCTION public.record_whatsapp_automation_result(p_item_id uuid, p_status text, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_clinic uuid;
  it public.whatsapp_automation_items%ROWTYPE;
  clean_reason text;
BEGIN
  SELECT p.clinic_id INTO caller_clinic FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;
  IF p_status NOT IN ('opened','confirmed','failed','skipped') THEN
    RAISE EXCEPTION 'Invalid automation result status';
  END IF;

  SELECT * INTO it FROM public.whatsapp_automation_items
  WHERE id = p_item_id AND clinic_id = caller_clinic FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Automation item not found'; END IF;
  IF it.status NOT IN ('processing','opened') THEN RETURN false; END IF;

  clean_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  UPDATE public.whatsapp_automation_items
  SET status = p_status,
      reason = CASE WHEN p_status = 'confirmed' THEN NULL ELSE clean_reason END,
      processed_at = CASE WHEN p_status = 'opened' THEN NULL ELSE now() END
  WHERE id = it.id;

  IF it.whatsapp_message_id IS NOT NULL THEN
    IF p_status = 'confirmed' THEN
      UPDATE public.whatsapp_messages
      SET status = 'send_confirmed', sent_at = now(), error_message = NULL
      WHERE id = it.whatsapp_message_id;
    ELSIF p_status = 'opened' THEN
      UPDATE public.whatsapp_messages
      SET status = 'manual_opened', sent_at = NULL,
          metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('opened_at', now(), 'delivery_claim', false, 'read_claim', false)
      WHERE id = it.whatsapp_message_id AND status <> 'send_confirmed';
    ELSE
      UPDATE public.whatsapp_messages
      SET status = CASE WHEN p_status = 'failed' THEN 'failed' ELSE 'queued' END,
          error_message = clean_reason
      WHERE id = it.whatsapp_message_id AND status <> 'send_confirmed';
    END IF;
  END IF;

  IF p_status = 'confirmed' AND it.appointment_id IS NOT NULL THEN
    PERFORM public.log_appointment_event(it.appointment_id, 'whatsapp_send_confirmed', 'admin', auth.uid(),
      jsonb_build_object('batch_id', it.batch_id));
  END IF;

  UPDATE public.whatsapp_automation_batches
  SET status = 'completed', completed_at = COALESCE(completed_at, now())
  WHERE id = it.batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_automation_items i
      WHERE i.batch_id = it.batch_id AND i.status IN ('queued','processing','opened')
    );

  RETURN true;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_whatsapp_automation_result(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_automation_result(uuid, text, text) TO authenticated;

-- ============ 7. PREPARE WHATSAPP ON DEMAND (with parent action links) ============
CREATE OR REPLACE FUNCTION public.ensure_appointment_whatsapp(p_appointment_id uuid, p_base_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_clinic uuid;
  a public.appointments%ROWTYPE;
  c public.children%ROWTYPE;
  t public.therapists%ROWTYPE;
  cl public.clinics%ROWTYPE;
  room_name text;
  ev public.communication_escalations%ROWTYPE;
  wa public.whatsapp_messages%ROWTYPE;
  phone text;
  base text;
  tok_confirm text; tok_cancel text; tok_resched text;
  body text;
BEGIN
  SELECT p.clinic_id INTO caller_clinic FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;
  IF NOT public.is_centre_admin(auth.uid()) THEN RAISE EXCEPTION 'Centre Admin role required'; END IF;

  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id AND clinic_id = caller_clinic;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Appointment not found for this centre'; END IF;
  IF a.status = 'cancelled' THEN RETURN jsonb_build_object('ok', false, 'reason', 'Appointment is cancelled'); END IF;

  SELECT * INTO c FROM public.children WHERE id = a.child_id AND clinic_id = a.clinic_id;
  phone := public.normalize_phone(c.parent_phone);
  IF NOT public.is_valid_phone(phone) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Parent phone number is missing or invalid');
  END IF;

  SELECT * INTO ev FROM public.communication_escalations e
  WHERE e.appointment_id = a.id AND e.status IN ('waiting_whatsapp','waiting_sms','waiting_call')
  ORDER BY e.created_at DESC LIMIT 1;

  IF ev.id IS NULL THEN
    PERFORM public.start_appointment_communication_workflow(
      a.id, a.appointment_date::text || 'T' || a.start_time::text || '#' || extract(epoch from now())::bigint::text);
    SELECT * INTO ev FROM public.communication_escalations e
    WHERE e.appointment_id = a.id AND e.status IN ('waiting_whatsapp','waiting_sms','waiting_call')
    ORDER BY e.created_at DESC LIMIT 1;
  END IF;
  IF ev.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Communication workflow is disabled for this centre');
  END IF;

  -- single-use action tokens, valid for 14 days
  base := rtrim(COALESCE(NULLIF(btrim(p_base_url), ''), ''), '/');
  INSERT INTO public.appointment_action_tokens (clinic_id, appointment_id, token, action, expires_at)
  SELECT a.clinic_id, a.id, encode(gen_random_bytes(24), 'hex'), x.action, now() + interval '14 days'
  FROM (VALUES ('confirm'),('cancel'),('reschedule')) AS x(action)
  ON CONFLICT (appointment_id, action) DO UPDATE
    SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, used_at = NULL;

  SELECT token INTO tok_confirm FROM public.appointment_action_tokens WHERE appointment_id = a.id AND action = 'confirm';
  SELECT token INTO tok_cancel FROM public.appointment_action_tokens WHERE appointment_id = a.id AND action = 'cancel';
  SELECT token INTO tok_resched FROM public.appointment_action_tokens WHERE appointment_id = a.id AND action = 'reschedule';

  SELECT * INTO cl FROM public.clinics WHERE id = a.clinic_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id AND clinic_id = a.clinic_id;
  SELECT r.name INTO room_name FROM public.rooms r WHERE r.id = a.room_id AND r.clinic_id = a.clinic_id;

  body := format(
    E'Hello %s,\n\nThis is a reminder from %s.\n\nChild: %s\nDate: %s\nTime: %s\nTherapist: %s\nTherapy: %s\nRoom: %s\nSession Fee: %s\n\nPlease choose an action for this appointment:\n\nConfirm Appointment: %s\nCancel Appointment: %s\nRequest Schedule Change: %s',
    COALESCE(c.parent_name, 'Parent'), COALESCE(cl.name, 'Therapy Care'), c.full_name,
    to_char(a.appointment_date, 'DD Mon YYYY'), to_char(a.start_time, 'HH12:MI AM'),
    COALESCE(t.full_name, 'To be assigned'), COALESCE(a.specialty, 'Therapy session'),
    COALESCE(room_name, 'To be assigned'), COALESCE(a.session_fee::text, 'To be confirmed'),
    base || '/parent-action?t=' || tok_confirm,
    base || '/parent-action?t=' || tok_cancel,
    base || '/parent-action?t=' || tok_resched
  );

  SELECT * INTO wa FROM public.whatsapp_messages w
  WHERE w.communication_event_id = ev.id AND w.message_type = 'appointment_confirmation' AND w.recipient_role = 'parent'
  LIMIT 1;

  IF wa.id IS NULL THEN
    INSERT INTO public.whatsapp_messages (
      clinic_id, child_id, appointment_id, communication_event_id,
      recipient_name, phone, message, message_type, recipient_role, status, metadata
    ) VALUES (
      a.clinic_id, a.child_id, a.id, ev.id, c.parent_name, phone, body,
      'appointment_confirmation', 'parent', 'queued',
      jsonb_build_object('mode','free_deep_link','delivery_claim',false,'read_claim',false)
    ) RETURNING * INTO wa;
    UPDATE public.communication_escalations SET whatsapp_message_id = wa.id WHERE id = ev.id;
  ELSE
    UPDATE public.whatsapp_messages
    SET message = body, phone = phone, recipient_name = COALESCE(c.parent_name, recipient_name)
    WHERE id = wa.id AND status NOT IN ('send_confirmed','sent')
    RETURNING * INTO wa;
  END IF;

  RETURN jsonb_build_object('ok', true, 'whatsapp_message_id', wa.id, 'communication_event_id', ev.id,
    'phone', phone, 'message', body);
END; $$;
REVOKE EXECUTE ON FUNCTION public.ensure_appointment_whatsapp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_appointment_whatsapp(uuid, text) TO authenticated;

-- ============ 8. PARENT ACTION VIA TOKEN (server-side only) ============
CREATE OR REPLACE FUNCTION public.get_parent_action_context(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tk public.appointment_action_tokens%ROWTYPE; a public.appointments%ROWTYPE; c public.children%ROWTYPE; t public.therapists%ROWTYPE; cl public.clinics%ROWTYPE;
BEGIN
  SELECT * INTO tk FROM public.appointment_action_tokens WHERE token = p_token;
  IF tk.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'This link is not valid.'); END IF;
  IF tk.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'This link has already been used.'); END IF;
  IF tk.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'This link has expired.'); END IF;
  SELECT * INTO a FROM public.appointments WHERE id = tk.appointment_id;
  SELECT * INTO c FROM public.children WHERE id = a.child_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id;
  SELECT * INTO cl FROM public.clinics WHERE id = a.clinic_id;
  RETURN jsonb_build_object('ok', true, 'action', tk.action, 'clinic_name', cl.name,
    'child_name', c.full_name, 'parent_name', c.parent_name, 'therapist_name', t.full_name,
    'appointment_date', a.appointment_date, 'start_time', a.start_time, 'appointment_status', a.status,
    'specialty', a.specialty);
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_parent_action_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_parent_action_context(text) TO service_role;

CREATE OR REPLACE FUNCTION public.process_parent_action_token(
  p_token text, p_new_date date, p_new_time time, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tk public.appointment_action_tokens%ROWTYPE;
  a public.appointments%ROWTYPE;
  c public.children%ROWTYPE;
  t public.therapists%ROWTYPE;
  req_type text;
  req_id uuid;
BEGIN
  SELECT * INTO tk FROM public.appointment_action_tokens WHERE token = p_token FOR UPDATE;
  IF tk.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'This link is not valid.'); END IF;
  IF tk.used_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'This link has already been used.'); END IF;
  IF tk.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'This link has expired.'); END IF;

  SELECT * INTO a FROM public.appointments WHERE id = tk.appointment_id;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'Appointment no longer exists.'); END IF;
  SELECT * INTO c FROM public.children WHERE id = a.child_id;
  SELECT * INTO t FROM public.therapists WHERE id = a.therapist_id;

  req_type := CASE tk.action WHEN 'confirm' THEN 'confirmation' WHEN 'cancel' THEN 'cancellation' ELSE 'schedule_change' END;

  IF tk.action = 'reschedule' AND (p_new_date IS NULL OR p_new_time IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Please provide the preferred new date and time.');
  END IF;

  INSERT INTO public.appointment_requests (
    clinic_id, appointment_id, child_id, therapist_id, request_type, requested_by,
    requested_date, requested_time, reason,
    status, decided_at
  ) VALUES (
    a.clinic_id, a.id, a.child_id, a.therapist_id, req_type, 'parent',
    p_new_date, p_new_time, NULLIF(btrim(COALESCE(p_reason,'')),''),
    CASE WHEN tk.action = 'confirm' THEN 'approved' ELSE 'pending' END,
    CASE WHEN tk.action = 'confirm' THEN now() ELSE NULL END
  ) RETURNING id INTO req_id;

  UPDATE public.appointment_action_tokens SET used_at = now() WHERE id = tk.id;

  IF tk.action = 'confirm' THEN
    UPDATE public.appointments
    SET parent_confirmation_status = 'confirmed', parent_action_at = now(),
        parent_action_note = NULLIF(btrim(COALESCE(p_reason,'')),'')
    WHERE id = a.id;
  ELSE
    UPDATE public.appointments
    SET parent_confirmation_status = CASE WHEN tk.action = 'cancel' THEN 'cancellation_requested' ELSE 'reschedule_requested' END,
        parent_action_at = now(),
        parent_action_note = NULLIF(btrim(COALESCE(p_reason,'')),'')
    WHERE id = a.id;
  END IF;

  PERFORM public.log_appointment_event(a.id, 'parent_' || tk.action, 'parent', NULL,
    jsonb_build_object('request_id', req_id, 'requested_date', p_new_date, 'requested_time', p_new_time));

  INSERT INTO public.notifications (clinic_id, title, body, type, appointment_id, therapist_id, child_id, audience, event)
  VALUES (
    a.clinic_id,
    CASE tk.action WHEN 'confirm' THEN 'Parent confirmed an appointment'
                   WHEN 'cancel' THEN 'Parent requested a cancellation'
                   ELSE 'Parent requested a schedule change' END,
    format('%s — %s at %s', COALESCE(c.full_name,'Child'), to_char(a.appointment_date,'DD Mon YYYY'), to_char(a.start_time,'HH12:MI AM')),
    'appointment', a.id, a.therapist_id, a.child_id, 'admin', 'parent_' || tk.action
  );

  IF a.therapist_id IS NOT NULL AND tk.action IN ('confirm','cancel') THEN
    INSERT INTO public.notifications (clinic_id, title, body, type, appointment_id, therapist_id, child_id, audience, event)
    VALUES (
      a.clinic_id,
      CASE WHEN tk.action = 'confirm' THEN 'Session confirmed by parent' ELSE 'Cancellation requested by parent' END,
      format('%s — %s at %s', COALESCE(c.full_name,'Child'), to_char(a.appointment_date,'DD Mon YYYY'), to_char(a.start_time,'HH12:MI AM')),
      'appointment', a.id, a.therapist_id, a.child_id, 'therapist', 'parent_' || tk.action
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'action', tk.action, 'request_id', req_id,
    'needs_admin_review', tk.action <> 'confirm');
END; $$;
REVOKE EXECUTE ON FUNCTION public.process_parent_action_token(text, date, time, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_parent_action_token(text, date, time, text) TO service_role;

-- ============ 9. ADMIN DECISION ============
CREATE OR REPLACE FUNCTION public.decide_appointment_request(
  p_request_id uuid, p_decision text, p_new_date date, p_new_time time, p_note text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_clinic uuid;
  r public.appointment_requests%ROWTYPE;
  a public.appointments%ROWTYPE;
  c public.children%ROWTYPE;
  eff_date date; eff_time time;
BEGIN
  SELECT p.clinic_id INTO caller_clinic FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;
  IF NOT public.is_centre_admin(auth.uid()) THEN RAISE EXCEPTION 'Centre Admin role required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;

  SELECT * INTO r FROM public.appointment_requests
  WHERE id = p_request_id AND clinic_id = caller_clinic FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found for this centre'; END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'Request already decided'); END IF;

  SELECT * INTO a FROM public.appointments WHERE id = r.appointment_id;
  SELECT * INTO c FROM public.children WHERE id = a.child_id;

  UPDATE public.appointment_requests
  SET status = p_decision, admin_note = NULLIF(btrim(COALESCE(p_note,'')),''),
      decided_by = auth.uid(), decided_at = now(),
      requested_date = COALESCE(p_new_date, requested_date),
      requested_time = COALESCE(p_new_time, requested_time)
  WHERE id = r.id;

  IF p_decision = 'approved' THEN
    IF r.request_type = 'cancellation' THEN
      UPDATE public.appointments SET status = 'cancelled', parent_confirmation_status = 'cancelled' WHERE id = a.id;
    ELSIF r.request_type = 'schedule_change' THEN
      eff_date := COALESCE(p_new_date, r.requested_date, a.appointment_date);
      eff_time := COALESCE(p_new_time, r.requested_time, a.start_time);
      UPDATE public.appointments
      SET appointment_date = eff_date, start_time = eff_time, parent_confirmation_status = 'rescheduled'
      WHERE id = a.id;
    END IF;
  ELSE
    UPDATE public.appointments SET parent_confirmation_status = 'pending' WHERE id = a.id;
  END IF;

  PERFORM public.log_appointment_event(a.id, r.request_type || '_' || p_decision, 'admin', auth.uid(),
    jsonb_build_object('request_id', r.id, 'new_date', p_new_date, 'new_time', p_new_time, 'note', p_note));

  IF a.therapist_id IS NOT NULL THEN
    INSERT INTO public.notifications (clinic_id, title, body, type, appointment_id, therapist_id, child_id, audience, event)
    VALUES (
      a.clinic_id,
      format('%s %s', initcap(replace(r.request_type,'_',' ')), p_decision),
      format('%s — %s at %s', COALESCE(c.full_name,'Child'),
        to_char(COALESCE(p_new_date, r.requested_date, a.appointment_date),'DD Mon YYYY'),
        to_char(COALESCE(p_new_time, r.requested_time, a.start_time),'HH12:MI AM')),
      'appointment', a.id, a.therapist_id, a.child_id, 'therapist', r.request_type || '_' || p_decision
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.decide_appointment_request(uuid, text, date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_appointment_request(uuid, text, date, time, text) TO authenticated;

-- ============ 10. BATCH CREATION USES PREPARED MESSAGES ============
DROP FUNCTION IF EXISTS public.create_whatsapp_automation_batch(uuid[]);
CREATE OR REPLACE FUNCTION public.create_whatsapp_automation_batch(p_appointment_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_clinic uuid;
  batch_id uuid;
  appt_id uuid;
  a public.appointments%ROWTYPE;
  ch public.children%ROWTYPE;
  ev public.communication_escalations%ROWTYPE;
  wa public.whatsapp_messages%ROWTYPE;
  phone text;
  body text;
  item_status text;
  item_reason text;
  pos integer := 0;
BEGIN
  SELECT p.clinic_id INTO caller_clinic FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;
  IF NOT public.is_centre_admin(auth.uid()) THEN RAISE EXCEPTION 'Centre Admin role required'; END IF;
  IF p_appointment_ids IS NULL OR array_length(p_appointment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one appointment';
  END IF;
  IF array_length(p_appointment_ids, 1) > 200 THEN
    RAISE EXCEPTION 'Select at most 200 appointments per batch';
  END IF;

  INSERT INTO public.whatsapp_automation_batches (clinic_id, created_by, total_selected)
  VALUES (caller_clinic, auth.uid(), array_length(p_appointment_ids, 1))
  RETURNING id INTO batch_id;

  FOR appt_id IN SELECT DISTINCT unnest(p_appointment_ids) LOOP
    pos := pos + 1;
    item_status := 'queued'; item_reason := NULL; phone := NULL; body := NULL;
    a := NULL; ch := NULL; ev := NULL; wa := NULL;

    SELECT * INTO a FROM public.appointments WHERE id = appt_id AND clinic_id = caller_clinic;
    IF a.id IS NULL THEN
      item_status := 'skipped'; item_reason := 'Appointment not found for this centre';
    ELSE
      SELECT * INTO ch FROM public.children WHERE id = a.child_id;
      IF a.status = 'cancelled' THEN
        item_status := 'skipped'; item_reason := 'Appointment is cancelled';
      ELSE
        SELECT * INTO ev FROM public.communication_escalations e
        WHERE e.appointment_id = a.id
        ORDER BY (e.status IN ('waiting_whatsapp','waiting_sms','waiting_call')) DESC, e.created_at DESC LIMIT 1;

        IF ev.id IS NOT NULL THEN
          SELECT * INTO wa FROM public.whatsapp_messages w
          WHERE w.communication_event_id = ev.id
            AND w.message_type = 'appointment_confirmation' AND w.recipient_role = 'parent'
          LIMIT 1;
        END IF;

        phone := public.normalize_phone(COALESCE(wa.phone, ch.parent_phone));
        body := NULLIF(btrim(COALESCE(wa.message, '')), '');

        IF phone IS NULL OR NOT public.is_valid_phone(phone) THEN
          item_status := 'failed'; item_reason := 'Parent phone number is missing or invalid';
        ELSIF body IS NULL THEN
          item_status := 'failed'; item_reason := 'No WhatsApp message prepared for this appointment';
        END IF;
      END IF;
    END IF;

    INSERT INTO public.whatsapp_automation_items (
      batch_id, clinic_id, appointment_id, communication_event_id, whatsapp_message_id,
      child_name, parent_name, phone, message, appointment_date, start_time,
      position, status, reason, processed_at
    ) VALUES (
      batch_id, caller_clinic, a.id, ev.id, wa.id,
      ch.full_name, ch.parent_name, phone, body, a.appointment_date, a.start_time,
      pos, item_status, item_reason,
      CASE WHEN item_status = 'queued' THEN NULL ELSE now() END
    ) ON CONFLICT (batch_id, appointment_id) DO NOTHING;
  END LOOP;

  UPDATE public.whatsapp_automation_batches b
  SET status = 'completed', completed_at = now()
  WHERE b.id = batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_automation_items i
      WHERE i.batch_id = batch_id AND i.status IN ('queued','processing','opened')
    );

  RETURN batch_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_whatsapp_automation_batch(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_automation_batch(uuid[]) TO authenticated;