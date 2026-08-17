-- P0 fix: every actual reschedule is a new appointment communication event,
-- even when the appointment returns to a previously used date/time.
--
-- Do not use appointment date/time as the reschedule event identity: the same
-- time can legitimately occur again later in the appointment's history.
-- Each trigger invocation represents one concrete reschedule event, so a UUID
-- is the smallest correct event identity while the existing
-- (appointment_id,event_key) uniqueness still protects duplicate processing of
-- the same explicit event key.
CREATE OR REPLACE FUNCTION public.handle_appointment_communication_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_key text;
BEGIN
  IF NEW.status = 'cancelled' THEN
    UPDATE public.communication_escalations
    SET status = 'cancelled', current_stage = 'completed', cancelled_at = now(), cancel_reason = 'appointment_cancelled'
    WHERE appointment_id = NEW.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

    UPDATE public.whatsapp_messages
    SET status = 'cancelled', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('invalidated_reason', 'appointment_cancelled')
    WHERE appointment_id = NEW.id AND recipient_role = 'parent'
      AND status IN ('queued','manual_opened');

    UPDATE public.sms_queue SET status = 'cancelled', last_error = 'Appointment cancelled'
      WHERE appointment_id = NEW.id AND status IN ('queued','sending');
    UPDATE public.call_queue SET status = 'cancelled', last_error = 'Appointment cancelled'
      WHERE appointment_id = NEW.id AND status IN ('queued','dialing');
    RETURN NEW;
  END IF;

  IF OLD.appointment_date IS DISTINCT FROM NEW.appointment_date
     OR OLD.start_time IS DISTINCT FROM NEW.start_time THEN
    UPDATE public.communication_escalations
    SET status = 'superseded', current_stage = 'completed', cancelled_at = now(), cancel_reason = 'appointment_rescheduled'
    WHERE appointment_id = NEW.id AND status IN ('waiting_whatsapp','waiting_sms','waiting_call');

    UPDATE public.whatsapp_messages
    SET status = 'superseded', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('invalidated_reason', 'appointment_rescheduled')
    WHERE appointment_id = NEW.id AND recipient_role = 'parent'
      AND status IN ('queued','manual_opened');

    UPDATE public.sms_queue SET status = 'cancelled', last_error = 'Appointment rescheduled'
      WHERE appointment_id = NEW.id AND status IN ('queued','sending');
    UPDATE public.call_queue SET status = 'cancelled', last_error = 'Appointment rescheduled'
      WHERE appointment_id = NEW.id AND status IN ('queued','dialing');

    -- A reschedule is an event, not merely a timestamp value. Generate a fresh
    -- identity so 5 PM -> 6 PM -> 5 PM creates a new workflow for the final 5 PM
    -- event while retaining the historical 5 PM workflow as superseded.
    event_key := 'reschedule:' || gen_random_uuid()::text;
    PERFORM public.start_appointment_communication_workflow(NEW.id, event_key);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_appointment_communication_change() FROM PUBLIC;
