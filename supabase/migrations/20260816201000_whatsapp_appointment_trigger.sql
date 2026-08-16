CREATE OR REPLACE FUNCTION public.trigger_queue_mock_appointment_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.queue_mock_appointment_whatsapp(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_queue_mock_whatsapp ON public.appointments;
CREATE TRIGGER appointments_queue_mock_whatsapp
AFTER INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.trigger_queue_mock_appointment_whatsapp();

REVOKE ALL ON FUNCTION public.trigger_queue_mock_appointment_whatsapp() FROM PUBLIC;
