-- Client users may only mark a free-mode message as opened and attach
-- non-delivery metadata. Recipient/message/provider fields remain server-managed.
REVOKE UPDATE ON public.whatsapp_messages FROM authenticated;
GRANT UPDATE (status, metadata) ON public.whatsapp_messages TO authenticated;
