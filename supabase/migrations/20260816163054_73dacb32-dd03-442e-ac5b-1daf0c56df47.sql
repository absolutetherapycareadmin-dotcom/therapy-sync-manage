
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['specialties','children','therapists','rooms','packages','appointments','attendance','payments','whatsapp_messages','notifications']
  LOOP
    EXECUTE format('DROP POLICY "clinic scoped select" ON public.%I;', t);
    EXECUTE format('DROP POLICY "clinic scoped insert" ON public.%I;', t);
    EXECUTE format('DROP POLICY "clinic scoped update" ON public.%I;', t);
    EXECUTE format('DROP POLICY "clinic scoped delete" ON public.%I;', t);
    EXECUTE format('CREATE POLICY "clinic scoped select" ON public.%I FOR SELECT TO authenticated USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));', t);
    EXECUTE format('CREATE POLICY "clinic scoped insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));', t);
    EXECUTE format('CREATE POLICY "clinic scoped update" ON public.%I FOR UPDATE TO authenticated USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid())) WITH CHECK (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));', t);
    EXECUTE format('CREATE POLICY "clinic scoped delete" ON public.%I FOR DELETE TO authenticated USING (clinic_id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));', t);
  END LOOP;
END $$;

DROP POLICY "clinic members can view clinic" ON public.clinics;
CREATE POLICY "clinic members can view clinic" ON public.clinics FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR id IN (SELECT p.clinic_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP FUNCTION IF EXISTS public.current_clinic_id();
