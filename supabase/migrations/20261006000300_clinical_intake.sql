create table public.encounters (
  id                          uuid primary key default gen_random_uuid(),
  patient_id                  uuid not null references public.patients(id) on delete restrict,
  facility_id                 uuid not null references public.facilities(id) on delete restrict,
  scenario                    public.encounter_scenario not null default 'opd_queue',
  channel                     public.intake_channel not null default 'staff_assisted',
  status                      public.encounter_status not null default 'draft',
  language                    text not null default 'en',
  chief_complaint_original    text,
  chief_complaint_translated  text,
  translation_confidence      numeric(3,2) check (translation_confidence between 0 and 1),
  group_ref                   text,
  context                     jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  submitted_at                timestamptz,
  closed_at                   timestamptz,
  retention_until             date,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);
create index encounters_patient_idx on public.encounters (patient_id);
create index encounters_facility_status_idx on public.encounters (facility_id, status) where deleted_at is null;
create index encounters_group_idx on public.encounters (facility_id, group_ref) where group_ref is not null;
create trigger trg_encounters_touch before update on public.encounters
  for each row execute function app.touch_updated_at();

create table public.symptom_entries (
  id                uuid primary key default gen_random_uuid(),
  encounter_id      uuid not null references public.encounters(id) on delete restrict,
  text_original     text not null,
  lang              text,
  text_translated   text,
  source            public.input_source not null default 'patient',
  asr_confidence    numeric(3,2) check (asr_confidence between 0 and 1),
  code_system       text,
  code              text,
  onset_at          timestamptz,
  duration_value    numeric check (duration_value >= 0),
  duration_unit     text check (duration_unit in ('minutes', 'hours', 'days', 'weeks', 'months', 'years')),
  severity          smallint check (severity between 0 and 10),
  recorded_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  check ((duration_value is null) = (duration_unit is null)),
  check ((code is null) = (code_system is null))
);
create index symptom_entries_encounter_idx on public.symptom_entries (encounter_id);

create table public.vitals (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id) on delete restrict,
  kind         public.vital_kind not null,
  value        numeric not null,
  unit         text not null,
  measured_at  timestamptz not null default now(),
  measured_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (case kind
    when 'temperature_c'       then value between 25 and 46
    when 'spo2_pct'            then value between 0 and 100
    when 'pulse_bpm'           then value between 0 and 300
    when 'resp_rate_pm'        then value between 0 and 120
    when 'bp_systolic_mmhg'    then value between 0 and 350
    when 'bp_diastolic_mmhg'   then value between 0 and 250
    when 'weight_kg'           then value between 0.3 and 500
    when 'height_cm'           then value between 20 and 260
    when 'blood_glucose_mgdl'  then value between 0 and 2000
    when 'muac_cm'             then value between 0 and 60
    else true end)
);
create index vitals_encounter_idx on public.vitals (encounter_id);

create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete restrict,
  encounter_id      uuid references public.encounters(id) on delete restrict,
  facility_id       uuid not null references public.facilities(id) on delete restrict,
  kind              public.document_kind not null default 'other',
  storage_path      text not null unique check (storage_path ~
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$'),
  mime_type         text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256            bytea check (sha256 is null or octet_length(sha256) = 32),
  original_filename text,
  scan_status       public.scan_status not null default 'pending',
  uploaded_by       uuid references auth.users(id) on delete set null,
  retention_until   date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index documents_patient_idx on public.documents (patient_id) where deleted_at is null;
create index documents_encounter_idx on public.documents (encounter_id);
create trigger trg_documents_touch before update on public.documents
  for each row execute function app.touch_updated_at();

create table public.extractions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents(id) on delete restrict,
  engine          text not null,
  engine_version  text,
  status          public.job_status not null default 'pending',
  language        text,
  raw_text        text,
  avg_confidence  numeric(4,3) check (avg_confidence between 0 and 1),
  error           text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index extractions_document_idx on public.extractions (document_id);

create table public.extracted_fields (
  id                    uuid primary key default gen_random_uuid(),
  extraction_id         uuid not null references public.extractions(id) on delete restrict,
  field_name            text not null,
  extracted_value_text  text,
  value_text            text,
  value_num             numeric,
  unit                  text,
  reference_range_text  text,
  printed_flag          text check (printed_flag in ('low', 'high', 'abnormal', 'normal')),
  confidence            numeric(4,3) check (confidence between 0 and 1),
  verified_by           uuid references auth.users(id) on delete set null,
  verified_at           timestamptz,
  created_at            timestamptz not null default now(),
  check ((verified_by is null) = (verified_at is null))
);
create index extracted_fields_extraction_idx on public.extracted_fields (extraction_id);

create table public.info_requests (
  id            uuid primary key default gen_random_uuid(),
  encounter_id  uuid not null references public.encounters(id) on delete restrict,
  audience      public.info_audience not null,
  field_code    text check (field_code is null or field_code ~ '^[a-z][a-z0-9_.]{1,62}$'),
  question_text text not null,
  lang          text not null default 'en',
  status        public.info_status not null default 'open',
  answer_text   text,
  answered_by   uuid references auth.users(id) on delete set null,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index info_requests_encounter_idx on public.info_requests (encounter_id, status);
