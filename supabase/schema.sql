begin;

create table if not exists public.doctor_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  specialty text not null,
  registration text not null default '',
  clinic text not null,
  address text not null,
  email text not null
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'called')),
  called_at timestamptz,
  created_at timestamptz not null default now(),
  constraint call_timestamp check (
    (status = 'called' and called_at is not null) or
    (status = 'pending' and called_at is null)
  )
);
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references auth.users(id),
  patient_id uuid not null references public.patients(id),
  called_at timestamptz not null,
  patient_snapshot jsonb not null,
  doctor_snapshot jsonb not null,
  unique (patient_id, called_at)
);

alter table public.patients add column if not exists scheduled_date date;
alter table public.patients add column if not exists notes text not null default '';
alter table public.patients add column if not exists message_attempts integer not null default 0 check (message_attempts between 0 and 2);
alter table public.patients add column if not exists date_of_birth date;
alter table public.patients add column if not exists facility text;
alter table public.patients add column if not exists appointment_time text;
alter table public.patients add column if not exists contact_person_name text;

create table if not exists public.call_receipts (
  id uuid primary key references public.calls(id),
  doctor_id uuid not null references auth.users(id),
  receipt_number text not null unique,
  storage_path text,
  created_at timestamptz not null default now()
);

alter table public.doctor_profiles enable row level security;
alter table public.patients enable row level security;
alter table public.calls enable row level security;
alter table public.call_receipts enable row level security;
grant usage on schema public to authenticated;
revoke all on public.doctor_profiles, public.calls, public.call_receipts from anon, authenticated;
grant select, insert, update on public.doctor_profiles to authenticated;
grant select, insert, update, delete on public.patients to authenticated;
revoke all on public.patients from anon;
grant select on public.calls, public.call_receipts to authenticated;
grant update(storage_path) on public.call_receipts to authenticated;
drop policy if exists "Doctors manage their own profile" on public.doctor_profiles;
create policy "Doctors manage their own profile" on public.doctor_profiles
  for all to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
drop policy if exists "Doctors manage their own patients" on public.patients;
create policy "Doctors manage their own patients" on public.patients
  for all to authenticated
  using ((select auth.uid()) = doctor_id)
  with check ((select auth.uid()) = doctor_id);
create index if not exists patients_doctor_id_idx on public.patients(doctor_id);
create index if not exists calls_doctor_id_idx on public.calls(doctor_id);
create index if not exists receipts_doctor_id_idx on public.call_receipts(doctor_id);
drop policy if exists "Doctors read their calls" on public.calls;
create policy "Doctors read their calls" on public.calls for select to authenticated
  using ((select auth.uid()) = doctor_id);
drop policy if exists "Doctors read their receipts" on public.call_receipts;
create policy "Doctors read their receipts" on public.call_receipts for select to authenticated
  using ((select auth.uid()) = doctor_id);
drop policy if exists "Doctors save their receipt path" on public.call_receipts;
create policy "Doctors save their receipt path" on public.call_receipts for update to authenticated
  using ((select auth.uid()) = doctor_id)
  with check ((select auth.uid()) = doctor_id and storage_path = doctor_id::text || '/' || id::text || '.pdf');

-- The status update, call snapshot, and receipt record commit together.
create or replace function public.record_patient_call()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  call_id uuid;
  provider jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.doctor_id <> old.doctor_id then
      raise exception 'Patient ownership cannot be changed';
    end if;
    if new.status = 'called' and old.status = 'called' and new.called_at is distinct from old.called_at then
      raise exception 'A completed call timestamp cannot be changed';
    end if;
    if new.status <> 'called' or old.status = 'called' then return new; end if;
  elsif new.status <> 'called' then return new;
  end if;
  select to_jsonb(p) into provider from public.doctor_profiles p where p.id = new.doctor_id;
  if provider is null then raise exception 'Save your doctor profile before completing a call'; end if;
  insert into public.calls (doctor_id, patient_id, called_at, patient_snapshot, doctor_snapshot)
    values (new.doctor_id, new.id, new.called_at, to_jsonb(new), provider)
    returning id into call_id;
  insert into public.call_receipts (id, doctor_id, receipt_number)
    values (call_id, new.doctor_id, 'BS-' || to_char(new.called_at at time zone 'UTC', 'YYYYMMDD') || '-' || upper(replace(call_id::text, '-', '')));
  return new;
end;
$$;
revoke all on function public.record_patient_call() from public, anon, authenticated;
drop trigger if exists patient_call_record on public.patients;
create trigger patient_call_record after insert or update on public.patients
  for each row execute function public.record_patient_call();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('call-receipts', 'call-receipts', false, 10485760, array['application/pdf'])
  on conflict (id) do nothing;
drop policy if exists "Doctors read their receipt files" on storage.objects;
create policy "Doctors read their receipt files" on storage.objects for select to authenticated
  using (bucket_id = 'call-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Doctors upload their receipt files" on storage.objects;
create policy "Doctors upload their receipt files" on storage.objects for insert to authenticated
  with check (bucket_id = 'call-receipts' and exists (
    select 1 from public.call_receipts r where r.doctor_id = (select auth.uid())
      and name = r.doctor_id::text || '/' || r.id::text || '.pdf'
  ));

notify pgrst, 'reload schema';
commit;
