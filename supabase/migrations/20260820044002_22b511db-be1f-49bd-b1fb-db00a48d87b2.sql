
CREATE TABLE IF NOT EXISTS public.whatsapp_automation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  created_by uuid,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed')),
  total_selected integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.whatsapp_automation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.whatsapp_automation_batches(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  communication_event_id uuid REFERENCES public.communication_escalations(id) ON DELETE SET NULL,
  whatsapp_message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  child_name text,
  parent_name text,
  phone text,
  message text,
  appointment_date date,
  start_time time,
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','skipped')),
  reason text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_automation_items_batch_appointment_idx
  ON public.whatsapp_automation_items (batch_id, appointment_id);
CREATE INDEX IF NOT EXISTS whatsapp_automation_items_batch_idx
  ON public.whatsapp_automation_items (batch_id, position);

DROP TRIGGER IF EXISTS whatsapp_automation_batches_updated_at ON public.whatsapp_automation_batches;
CREATE TRIGGER whatsapp_automation_batches_updated_at
BEFORE UPDATE ON public.whatsapp_automation_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS whatsapp_automation_items_updated_at ON public.whatsapp_automation_items;
CREATE TRIGGER whatsapp_automation_items_updated_at
BEFORE UPDATE ON public.whatsapp_automation_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.whatsapp_automation_batches TO authenticated;
GRANT SELECT ON public.whatsapp_automation_items TO authenticated;
GRANT ALL ON public.whatsapp_automation_batches TO service_role;
GRANT ALL ON public.whatsapp_automation_items TO service_role;

ALTER TABLE public.whatsapp_automation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation batches clinic scoped select" ON public.whatsapp_automation_batches;
CREATE POLICY "automation batches clinic scoped select"
ON public.whatsapp_automation_batches FOR SELECT TO authenticated
USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "automation items clinic scoped select" ON public.whatsapp_automation_items;
CREATE POLICY "automation items clinic scoped select"
ON public.whatsapp_automation_items FOR SELECT TO authenticated
USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE OR REPLACE VIEW public.appointment_whatsapp_status
WITH (security_invoker = on) AS
SELECT
  a.id AS appointment_id,
  a.clinic_id,
  c.parent_name,
  c.parent_phone,
  e.id AS communication_event_id,
  e.status AS event_status,
  w.id AS whatsapp_message_id,
  w.status AS whatsapp_status,
  w.sent_at,
  w.error_message
FROM public.appointments a
JOIN public.children c ON c.id = a.child_id
LEFT JOIN LATERAL (
  SELECT e2.* FROM public.communication_escalations e2
  WHERE e2.appointment_id = a.id
  ORDER BY (e2.status IN ('waiting_whatsapp','waiting_sms','waiting_call')) DESC, e2.created_at DESC
  LIMIT 1
) e ON true
LEFT JOIN public.whatsapp_messages w
  ON w.communication_event_id = e.id
 AND w.message_type = 'appointment_confirmation'
 AND w.recipient_role = 'parent';

GRANT SELECT ON public.appointment_whatsapp_status TO authenticated;

CREATE OR REPLACE FUNCTION public.create_whatsapp_automation_batch(p_appointment_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  caller_clinic uuid;
  caller_role text;
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
  SELECT p.clinic_id, p.role INTO caller_clinic, caller_role
  FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;
  IF caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Centre Admin role required'; END IF;
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
    item_status := 'queued';
    item_reason := NULL;
    phone := NULL;
    body := NULL;
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
          AND e.status IN ('waiting_whatsapp','waiting_sms','waiting_call')
        ORDER BY e.created_at DESC LIMIT 1;
        IF ev.id IS NULL THEN
          item_status := 'skipped'; item_reason := 'No active communication event';
        ELSE
          SELECT * INTO wa FROM public.whatsapp_messages w
          WHERE w.communication_event_id = ev.id
            AND w.message_type = 'appointment_confirmation'
            AND w.recipient_role = 'parent'
          LIMIT 1;
          IF wa.id IS NULL THEN
            item_status := 'skipped'; item_reason := 'No WhatsApp notification prepared';
          ELSIF wa.status = 'sent' THEN
            item_status := 'skipped'; item_reason := 'Already sent';
          ELSE
            phone := public.normalize_phone(COALESCE(wa.phone, ch.parent_phone));
            body := NULLIF(btrim(COALESCE(wa.message, '')), '');
            IF phone IS NULL OR NOT public.is_valid_phone(phone) THEN
              item_status := 'failed'; item_reason := 'Invalid parent phone number';
            ELSIF body IS NULL THEN
              item_status := 'failed'; item_reason := 'Message is empty';
            END IF;
          END IF;
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
    )
    ON CONFLICT (batch_id, appointment_id) DO NOTHING;

    IF item_status = 'failed' AND wa.id IS NOT NULL THEN
      UPDATE public.whatsapp_messages
      SET status = 'failed', error_message = item_reason
      WHERE id = wa.id AND status <> 'sent';
    END IF;
  END LOOP;

  UPDATE public.whatsapp_automation_batches b
  SET status = 'completed', completed_at = now()
  WHERE b.id = batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_automation_items i
      WHERE i.batch_id = batch_id AND i.status IN ('queued','processing')
    );

  RETURN batch_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_whatsapp_automation_batch(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_automation_batch(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_automation_item(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  caller_clinic uuid;
  it public.whatsapp_automation_items%ROWTYPE;
  a public.appointments%ROWTYPE;
  ev public.communication_escalations%ROWTYPE;
  wa public.whatsapp_messages%ROWTYPE;
  block_reason text;
  new_status text;
BEGIN
  SELECT p.clinic_id INTO caller_clinic FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;

  LOOP
    it := NULL;
    SELECT * INTO it FROM public.whatsapp_automation_items
    WHERE batch_id = p_batch_id AND clinic_id = caller_clinic AND status = 'queued'
    ORDER BY position
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF it.id IS NULL THEN
      UPDATE public.whatsapp_automation_batches
      SET status = 'completed', completed_at = COALESCE(completed_at, now())
      WHERE id = p_batch_id AND clinic_id = caller_clinic
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_automation_items i
          WHERE i.batch_id = p_batch_id AND i.status IN ('queued','processing')
        );
      RETURN jsonb_build_object('done', true);
    END IF;

    block_reason := NULL;
    a := NULL; ev := NULL; wa := NULL;
    SELECT * INTO a FROM public.appointments WHERE id = it.appointment_id AND clinic_id = caller_clinic;
    SELECT * INTO ev FROM public.communication_escalations WHERE id = it.communication_event_id;
    SELECT * INTO wa FROM public.whatsapp_messages WHERE id = it.whatsapp_message_id;

    IF a.id IS NULL THEN block_reason := 'Appointment no longer exists';
    ELSIF a.status = 'cancelled' THEN block_reason := 'Appointment is cancelled';
    ELSIF ev.id IS NULL OR ev.status NOT IN ('waiting_whatsapp','waiting_sms','waiting_call') THEN
      block_reason := 'Communication event is no longer active';
    ELSIF wa.id IS NULL THEN block_reason := 'WhatsApp notification no longer exists';
    ELSIF wa.status = 'sent' THEN block_reason := 'Already sent';
    ELSIF it.phone IS NULL OR NOT public.is_valid_phone(it.phone) THEN block_reason := 'Invalid parent phone number';
    ELSIF NULLIF(btrim(COALESCE(it.message, '')), '') IS NULL THEN block_reason := 'Message is empty';
    END IF;

    IF block_reason IS NOT NULL THEN
      new_status := CASE WHEN block_reason IN ('Invalid parent phone number','Message is empty') THEN 'failed' ELSE 'skipped' END;
      UPDATE public.whatsapp_automation_items
      SET status = new_status, reason = block_reason, processed_at = now()
      WHERE id = it.id;
      CONTINUE;
    END IF;

    UPDATE public.whatsapp_automation_items
    SET status = 'processing', reason = NULL
    WHERE id = it.id;

    UPDATE public.whatsapp_messages
    SET status = 'processing', error_message = NULL
    WHERE id = wa.id AND status <> 'sent';

    RETURN jsonb_build_object(
      'done', false,
      'item_id', it.id,
      'appointment_id', it.appointment_id,
      'child_name', it.child_name,
      'parent_name', it.parent_name,
      'phone', it.phone,
      'message', it.message
    );
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_automation_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_automation_item(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_whatsapp_automation_result(
  p_item_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  caller_clinic uuid;
  it public.whatsapp_automation_items%ROWTYPE;
  clean_reason text;
BEGIN
  SELECT p.clinic_id INTO caller_clinic FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;
  IF p_status NOT IN ('sent','failed','skipped') THEN RAISE EXCEPTION 'Invalid automation result status'; END IF;

  SELECT * INTO it FROM public.whatsapp_automation_items
  WHERE id = p_item_id AND clinic_id = caller_clinic FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Automation item not found'; END IF;
  IF it.status <> 'processing' THEN RETURN false; END IF;

  clean_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  UPDATE public.whatsapp_automation_items
  SET status = p_status,
      reason = CASE WHEN p_status = 'sent' THEN NULL
                    ELSE COALESCE(clean_reason, 'Android automation did not confirm the send') END,
      processed_at = now()
  WHERE id = it.id;

  IF it.whatsapp_message_id IS NOT NULL THEN
    IF p_status = 'sent' THEN
      UPDATE public.whatsapp_messages
      SET status = 'sent', sent_at = now(), error_message = NULL
      WHERE id = it.whatsapp_message_id AND status <> 'sent';
    ELSE
      UPDATE public.whatsapp_messages
      SET status = CASE WHEN p_status = 'failed' THEN 'failed' ELSE 'queued' END,
          error_message = clean_reason
      WHERE id = it.whatsapp_message_id AND status <> 'sent';
    END IF;
  END IF;

  UPDATE public.whatsapp_automation_batches
  SET status = 'completed', completed_at = COALESCE(completed_at, now())
  WHERE id = it.batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_automation_items i
      WHERE i.batch_id = it.batch_id AND i.status IN ('queued','processing')
    );

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_whatsapp_automation_result(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_automation_result(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_stale_whatsapp_automation_items(p_batch_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  caller_clinic uuid;
  released integer;
BEGIN
  SELECT p.clinic_id INTO caller_clinic FROM public.profiles p WHERE p.id = auth.uid();
  IF caller_clinic IS NULL THEN RAISE EXCEPTION 'Centre access denied'; END IF;

  UPDATE public.whatsapp_automation_items i
  SET status = 'queued', reason = NULL
  WHERE i.clinic_id = caller_clinic
    AND i.status = 'processing'
    AND (p_batch_id IS NULL OR i.batch_id = p_batch_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_messages w
      WHERE w.id = i.whatsapp_message_id AND w.status = 'sent'
    );
  GET DIAGNOSTICS released = ROW_COUNT;

  UPDATE public.whatsapp_messages w
  SET status = 'queued'
  FROM public.whatsapp_automation_items i
  WHERE i.whatsapp_message_id = w.id
    AND i.clinic_id = caller_clinic
    AND i.status = 'queued'
    AND w.status = 'processing';

  RETURN released;
END;
$fn$;

REVOKE ALL ON FUNCTION public.release_stale_whatsapp_automation_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_stale_whatsapp_automation_items(uuid) TO authenticated;
