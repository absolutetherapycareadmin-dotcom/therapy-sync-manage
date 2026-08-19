-- Prevent authenticated clinic users from fabricating provider delivery/read state.
-- Server-side Edge Functions remain the only path that writes provider status.

CREATE OR REPLACE FUNCTION public.guard_whatsapp_client_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NEW.provider_message_id IS NOT NULL
       OR NEW.provider_status IS NOT NULL
       OR NEW.delivered_at IS NOT NULL
       OR NEW.read_at IS NOT NULL
       OR NEW.sent_at IS NOT NULL THEN
      RAISE EXCEPTION 'Provider WhatsApp delivery state is server-managed';
    END IF;
    IF NEW.status NOT IN ('queued','manual_opened') THEN
      RAISE EXCEPTION 'Invalid client WhatsApp status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_messages_client_status_guard ON public.whatsapp_messages;
CREATE TRIGGER whatsapp_messages_client_status_guard
BEFORE INSERT OR UPDATE ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_client_status();

REVOKE UPDATE ON public.whatsapp_messages FROM authenticated;
GRANT UPDATE (
  recipient_name,
  phone,
  message,
  message_type,
  status,
  metadata
) ON public.whatsapp_messages TO authenticated;
