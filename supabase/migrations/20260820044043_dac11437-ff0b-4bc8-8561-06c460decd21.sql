
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS whatsapp_notification_lead_minutes integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.set_whatsapp_notification_lead(p_clinic_id uuid, p_lead_minutes integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  IF p_lead_minutes IS NULL OR p_lead_minutes < 0 OR p_lead_minutes > 10080 THEN
    RAISE EXCEPTION 'WhatsApp notification lead time must be between 0 and 10080 minutes';
  END IF;

  UPDATE public.clinics
  SET whatsapp_notification_lead_minutes = p_lead_minutes
  WHERE id = p_clinic_id;

  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_whatsapp_notification_lead(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_whatsapp_notification_lead(uuid, integer) TO authenticated;
