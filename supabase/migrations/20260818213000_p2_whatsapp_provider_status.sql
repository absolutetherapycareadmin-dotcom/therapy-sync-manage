-- P2 optional paid WhatsApp provider path. Core ₹0 deep-link mode remains the default.
-- No provider credentials are stored in the database or frontend.

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
