create table public.referrals (
  id               uuid primary key default gen_random_uuid(),
  encounter_id     uuid not null references public.encounters(id) on delete restrict,
  patient_id       uuid not null references public.patients(id) on delete restrict,
  from_facility_id uuid not null references public.facilities(id) on delete restrict,
  to_facility_id   uuid references public.facilities(id) on delete restrict,
  requested_by     uuid not null references auth.users(id) on delete restrict,
  priority         public.referral_priority not null default 'routine',
  reason_text      text,
  status           public.referral_status not null default 'draft',
  status_reason    text,
  bundle           jsonb check (bundle is null or jsonb_typeof(bundle) = 'object'),
  bundle_sha256    bytea check (bundle_sha256 is null or octet_length(bundle_sha256) = 32),
  sent_at          timestamptz,
  erased_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (to_facility_id is distinct from from_facility_id),
  check (status in ('draft', 'cancelled') or erased_at is not null
         or (to_facility_id is not null and bundle is not null and bundle_sha256 is not null))
);
create index referrals_to_idx on public.referrals (to_facility_id, status);
create index referrals_from_idx on public.referrals (from_facility_id, status);
create index referrals_encounter_idx on public.referrals (encounter_id);
create trigger trg_referrals_touch before update on public.referrals
  for each row execute function app.touch_updated_at();

create table public.referral_events (
  id          uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete restrict,
  status      public.referral_status not null,
  actor_id    uuid,
  note        text,
  at          timestamptz not null default now()
);
create index referral_events_referral_idx on public.referral_events (referral_id, at);
create trigger trg_referral_events_immutable before update or delete on public.referral_events
  for each row execute function app.forbid_mutation();

create table public.referral_documents (
  referral_id uuid not null references public.referrals(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  primary key (referral_id, document_id)
);

create or replace function app.referral_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
  allowed boolean;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status
      when 'draft'       then new.status in ('requested', 'cancelled')
      when 'requested'   then new.status in ('accepted', 'rejected', 'cancelled')
      when 'accepted'    then new.status in ('in_progress', 'cancelled')
      when 'in_progress' then new.status in ('completed', 'cancelled')
      else false end;
    if not allowed then
      raise exception 'illegal referral transition % -> %', old.status, new.status using errcode = '23514';
    end if;

    if uid is not null then
      if new.status in ('requested', 'cancelled')
         and not app.is_reviewer_at(old.from_facility_id) then
        raise exception 'only the referring facility may set status %', new.status using errcode = '42501';
      elsif new.status in ('accepted', 'rejected', 'in_progress', 'completed')
         and not app.is_reviewer_at(old.to_facility_id) then
        raise exception 'only the receiving facility may set status %', new.status using errcode = '42501';
      end if;
    end if;
    if new.status = 'requested' then new.sent_at := now(); end if;
  end if;

  if old.status <> 'draft'
     and coalesce(current_setting('app.erasure_mode', true), '') <> 'on'
     and (new.bundle is distinct from old.bundle or new.bundle_sha256 is distinct from old.bundle_sha256
          or new.reason_text is distinct from old.reason_text or new.to_facility_id is distinct from old.to_facility_id
          or new.from_facility_id is distinct from old.from_facility_id or new.patient_id is distinct from old.patient_id
          or new.encounter_id is distinct from old.encounter_id) then
    raise exception 'referral content is immutable after it has been requested' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_referrals_guard before insert or update on public.referrals
  for each row execute function app.referral_guard();

create or replace function app.referral_log_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.referral_events (referral_id, status, actor_id, note)
    values (new.id, new.status, auth.uid(), new.status_reason);
  end if;
  return null;
end $$;
create trigger trg_referrals_events after insert or update on public.referrals
  for each row execute function app.referral_log_event();

create table public.followup_schedules (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete restrict,
  facility_id  uuid not null references public.facilities(id) on delete restrict,
  kind         text not null check (kind in ('anc_visit', 'chronic_checkin', 'fever_followup', 'vaccination', 'custom')),
  cadence_days integer check (cadence_days > 0),
  next_due_at  timestamptz,
  active       boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index followup_due_idx on public.followup_schedules (facility_id, next_due_at) where active;
create trigger trg_followup_touch before update on public.followup_schedules
  for each row execute function app.touch_updated_at();

create table public.reminders (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.followup_schedules(id) on delete cascade,
  consent_id   uuid not null references public.consents(id) on delete restrict,
  due_at       timestamptz not null,
  channel      text not null check (channel in ('sms', 'whatsapp', 'ivr', 'in_app')),
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'sent', 'delivered', 'failed', 'acknowledged', 'missed')),
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index reminders_due_idx on public.reminders (due_at) where status = 'scheduled';

create table public.erasure_requests (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete restrict,
  requested_at  timestamptz not null default now(),
  requested_via text not null default 'staff' check (requested_via in ('self', 'staff', 'guardian')),
  status        text not null default 'pending' check (status in ('pending', 'legal_hold', 'completed', 'rejected')),
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  note          text
);
create index erasure_requests_patient_idx on public.erasure_requests (patient_id);
