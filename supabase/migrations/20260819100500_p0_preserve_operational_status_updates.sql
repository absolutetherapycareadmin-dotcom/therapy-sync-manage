-- Preserve legitimate Centre operational status actions after the parent-response
-- column privilege boundary. Parent-response fields remain non-writable by
-- authenticated users; execution status is still an operational field.
GRANT UPDATE (status) ON public.appointments TO authenticated;
