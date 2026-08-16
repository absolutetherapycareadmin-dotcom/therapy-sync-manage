create table if not exists public.sms_queue (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  appointment_id uuid,
  recipient_phone text not null,
  message text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sms_queue_clinic_schedule_idx
  on public.sms_queue (clinic_id, scheduled_for, status);

alter table public.sms_queue enable row level security;

create policy "sms_queue_select_own_clinic"
  on public.sms_queue for select
  using (clinic_id = public.current_user_clinic_id());

create policy "sms_queue_insert_own_clinic"
  on public.sms_queue for insert
  with check (clinic_id = public.current_user_clinic_id());

create policy "sms_queue_update_own_clinic"
  on public.sms_queue for update
  using (clinic_id = public.current_user_clinic_id())
  with check (clinic_id = public.current_user_clinic_id());

create policy "sms_queue_delete_own_clinic"
  on public.sms_queue for delete
  using (clinic_id = public.current_user_clinic_id());

create or replace function public.queue_appointment_sms(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_recipient_phone text,
  p_message text,
  p_scheduled_for timestamptz
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if p_clinic_id <> public.current_user_clinic_id() then
    raise exception 'clinic access denied';
  end if;

  if p_recipient_phone is null or length(trim(p_recipient_phone)) < 8 then
    raise exception 'invalid recipient phone';
  end if;

  insert into public.sms_queue (clinic_id, appointment_id, recipient_phone, message, scheduled_for)
  values (p_clinic_id, p_appointment_id, trim(p_recipient_phone), p_message, p_scheduled_for)
  returning id into v_id;

  return v_id;
end;
$$;
