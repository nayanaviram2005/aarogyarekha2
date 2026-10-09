create table public.facilities (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null check (length(btrim(name)) > 0),
  type        public.facility_type not null,
  state       text,
  district    text,
  pincode     text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_facilities_touch before update on public.facilities
  for each row execute function app.touch_updated_at();

create table public.facility_capabilities (
  facility_id uuid not null references public.facilities(id) on delete cascade,
  capability  text not null check (capability ~ '^[a-z][a-z0-9_]{1,62}$'),
  primary key (facility_id, capability)
);

create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  display_name              text not null check (length(btrim(display_name)) > 0),
  phone                     text check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  preferred_language        text not null default 'en' check (preferred_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  registration_council      text,
  registration_no           text,
  credential_reset_required boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  role        public.app_role not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, facility_id, role)
);
create index memberships_user_idx on public.memberships (user_id) where is_active;
create index memberships_facility_idx on public.memberships (facility_id) where is_active;

create table public.patients (
  id                     uuid primary key default gen_random_uuid(),
  public_ref             text not null unique default app.gen_public_ref(),
  registered_facility_id uuid not null references public.facilities(id) on delete restrict,
  user_id                uuid unique references auth.users(id) on delete set null,
  full_name              text not null check (length(btrim(full_name)) > 0),
  preferred_language     text not null default 'en' check (preferred_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]+)*$'),
  sex                    public.sex_code not null default 'unknown',
  birth_date             date check (birth_date is null or birth_date <= current_date),
  age_years_reported     smallint check (age_years_reported between 0 and 130),
  phone                  text check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  address_line           text,
  village_town           text,
  district               text,
  state                  text,
  pincode                text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  guardian_name          text,
  guardian_phone         text check (guardian_phone is null or guardian_phone ~ '^\+?[0-9]{10,15}$'),
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);
create index patients_facility_idx on public.patients (registered_facility_id) where deleted_at is null;
create index patients_phone_idx on public.patients (phone) where phone is not null;
create trigger trg_patients_touch before update on public.patients
  for each row execute function app.touch_updated_at();

create table public.patient_identifiers (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  system     text not null check (system in
             ('abha_number', 'abha_address', 'facility_mrn', 'employee_id', 'student_id', 'other')),
  value      text not null check (length(btrim(value)) > 0),
  created_at timestamptz not null default now(),
  unique (system, value)
);
create index patient_identifiers_patient_idx on public.patient_identifiers (patient_id);

create table public.health_card_tokens (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete restrict,
  token_hash   bytea not null unique check (octet_length(token_hash) = 32),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create index health_card_tokens_patient_idx on public.health_card_tokens (patient_id);

create table public.reported_history (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete restrict,
  kind           text not null check (kind in
                 ('reported_condition', 'allergy', 'medication', 'family_history',
                  'occupational_exposure', 'immunisation', 'other')),
  text_original  text not null,
  lang           text,
  source         public.input_source not null default 'patient',
  recorded_by    uuid references auth.users(id) on delete set null,
  confirmed_by   uuid references auth.users(id) on delete set null,
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  check ((confirmed_by is null) = (confirmed_at is null))
);
create index reported_history_patient_idx on public.reported_history (patient_id);

create table public.pregnancy_episodes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete restrict,
  lmp_date    date,
  edd_date    date,
  status      text not null default 'ongoing' check (status in ('ongoing', 'delivered', 'ended_other', 'unknown')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pregnancy_episodes_patient_idx on public.pregnancy_episodes (patient_id);
create trigger trg_pregnancy_touch before update on public.pregnancy_episodes
  for each row execute function app.touch_updated_at();

create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete restrict,
  purpose       public.consent_purpose not null,
  given_by      public.consent_party not null default 'self',
  method        public.consent_method not null,
  notice_version text not null,
  captured_by   uuid references auth.users(id) on delete set null,
  witness_name  text,
  granted_at    timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  check (revoked_at is null or revoked_at >= granted_at),
  check (expires_at is null or expires_at > granted_at)
);
create unique index consents_one_active_per_purpose
  on public.consents (patient_id, purpose) where revoked_at is null;

create table public.access_grants (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patients(id) on delete restrict,
  grantee_facility_id uuid not null references public.facilities(id) on delete cascade,
  scope               text not null default 'read_full' check (scope in ('read_summary', 'read_full')),
  source_consent_id   uuid not null references public.consents(id) on delete restrict,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  check (expires_at > created_at)
);
create index access_grants_patient_idx on public.access_grants (patient_id);
create index access_grants_grantee_idx on public.access_grants (grantee_facility_id) where revoked_at is null;

create table public.break_glass_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete restrict,
  facility_id uuid not null references public.facilities(id) on delete restrict,
  reason      text not null check (length(btrim(reason)) >= 10),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '1 hour'),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create index break_glass_active_idx on public.break_glass_grants (user_id, patient_id, expires_at);
