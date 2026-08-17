-- P1 Android dual-SIM support: persist the centre-selected SMS subscription.
-- NULL preserves the existing Android/default-SIM behaviour.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS device_subscription_id bigint;

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_device_subscription_id_check;

ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_device_subscription_id_check
  CHECK (device_subscription_id IS NULL OR device_subscription_id > 0);
