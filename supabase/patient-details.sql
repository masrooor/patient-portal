-- Apply to an existing portal database. Existing records and RLS remain unchanged.
begin;
alter table public.patients add column if not exists scheduled_date date;
alter table public.patients add column if not exists notes text not null default '';
alter table public.patients add column if not exists message_attempts integer not null default 0 check (message_attempts between 0 and 2);
alter table public.patients add column if not exists date_of_birth date;
alter table public.patients add column if not exists facility text;
alter table public.patients add column if not exists appointment_time text;
alter table public.patients add column if not exists contact_person_name text;
notify pgrst, 'reload schema';
commit;
