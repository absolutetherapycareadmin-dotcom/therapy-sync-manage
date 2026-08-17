-- P2 security hardening: paid WhatsApp is explicitly opt-in per centre,
-- provider identifiers are authoritative, and webhook audit rows never become
-- unscoped cross-tenant records.

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
