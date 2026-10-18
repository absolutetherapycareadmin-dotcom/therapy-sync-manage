CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER FUNCTION public.ensure_appointment_whatsapp(uuid, text) SET search_path TO 'public', 'extensions';