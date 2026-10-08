-- 0019 Text-message (SMS) status updates to the patient.
--
--  * a new consent purpose, 'status_messages': the patient agrees to a text with their queue status. It is separate from the other consents.
--  * sms_log: one row per message the system tried to send. It holds ids, the status that was announced, the language, the template
--    and the provider's message id. It NEVER holds the phone number or the text. Staff at the facility may read it; only the service
--    role writes it.
--  * app.revoke_sms_consents(phone): called when a recipient replies STOP. It ends the 'status_messages' and 'reminders' consents of every
--    patient registered with that number (a number can be shared by a family), and writes an audit entry holding counts only.
alter type public.consent_purpose add value if not exists 'status_messages';

create table if not exists public.sms_log (
  id             uuid primary key default gen_random_uuid(),
  encounter_id   uuid not null references public.encounters(id) on delete restrict,
  patient_id     uuid not null references public.patients(id) on delete restrict,
  facility_id    uuid not null references public.facilities(id) on delete restrict,
  kind           text not null check (kind in ('status', 'moved_down')),
  tier           smallint not null check (tier between 1 and 4),          -- 1 immediate, 2 very urgent, 3 urgent, 4 routine
  language       text not null check (language in ('en', 'hi', 'or')),
  result         text not null check (result in ('sent', 'failed', 'skipped')),
  reason         text check (reason is null or reason in ('no_consent', 'no_phone', 'bad_phone', 'opted_out', 'not_configured', 'provider_error', 'duplicate')),
  provider       text not null,
  provider_id    text,
  segments       smallint,
  created_at     timestamptz not null default now()
);
create index if not exists sms_log_encounter_idx on public.sms_log (encounter_id, created_at desc);

alter table public.sms_log enable row level security;
grant select on public.sms_log to authenticated;
drop policy if exists sms_log_select on public.sms_log;
create policy sms_log_select on public.sms_log for select to authenticated using (app.is_clinician_at(facility_id));

create or replace function app.revoke_sms_consents(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); v_n int;
begin
  if length(v_digits) < 10 then raise exception 'not a phone number' using errcode = '22023'; end if;
  with p as (
    select id from public.patients
     where deleted_at is null and phone is not null
       and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(v_digits, 10)
  ), c as (
    update public.consents set revoked_at = now()
     where revoked_at is null and purpose::text in ('status_messages', 'reminders') and patient_id in (select id from p)
    returning id
  )
  select count(*) into v_n from c;
  perform app.write_audit('update', 'consent', null, null, null, null, 'success', null, null, 'sms-opt-out', null, jsonb_build_object('op', 'sms_stop', 'revoked', v_n));
  return jsonb_build_object('revoked', v_n);
end $$;

revoke all on function app.revoke_sms_consents(text) from public, anon, authenticated;
grant execute on function app.revoke_sms_consents(text) to service_role;
