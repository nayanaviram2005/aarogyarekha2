-- 0004 triage. Algorithm-agnostic: the approved algorithms are specified separately [OPEN].
-- The schema stores WHAT was concluded, WHY (signals), and WHICH versioned rule set produced it.
-- It stores no diagnosis. Assessments are immutable; humans act through review_actions.

-- Urgency levels are DATA, not an enum, so the approved algorithm can change them without DDL.
-- Seed values are PLACEHOLDERS (4-level scale) pending the algorithm spec.
create table public.urgency_levels (
  code  text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  rank  smallint not null unique,       -- 1 = most urgent
  label text not null
);
insert into public.urgency_levels (code, rank, label) values
  ('red', 1, 'Immediate attention'),
  ('orange', 2, 'Very urgent'),
  ('yellow', 3, 'Urgent'),
  ('green', 4, 'Routine');

create table public.triage_rule_sets (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  version         text not null,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  source_citation text,                              -- the published/validated algorithm this encodes
  definition      jsonb not null check (jsonb_typeof(definition) = 'object'),
  approved_by     uuid references auth.users(id) on delete set null,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (name, version),
  check (status <> 'approved' or (approved_at is not null and source_citation is not null))
);

create table public.triage_assessments (
  id                uuid primary key default gen_random_uuid(),
  encounter_id      uuid not null references public.encounters(id) on delete restrict,
  version           integer not null check (version >= 1),
  rule_set_id       uuid references public.triage_rule_sets(id) on delete restrict,
  basis             public.assessment_basis not null,
  urgency_code      text not null references public.urgency_levels(code),
  note              jsonb not null check (jsonb_typeof(note) = 'object'),  -- structured, non-diagnostic summary
  input_fingerprint text not null,                   -- sha256 of the evidence snapshot -> reproducibility
  engine_version    text not null,
  created_at        timestamptz not null default now(),
  unique (encounter_id, version),
  check (basis = 'external_primary' or rule_set_id is not null)
);
create index triage_assessments_encounter_idx on public.triage_assessments (encounter_id, version desc);
create trigger trg_assessments_immutable before update or delete on public.triage_assessments
  for each row execute function app.forbid_mutation();

-- Only an APPROVED rule set may back an assessment.
create or replace function app.require_approved_rule_set()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.rule_set_id is not null and not exists
     (select 1 from public.triage_rule_sets r where r.id = new.rule_set_id and r.status = 'approved') then
    raise exception 'rule set % is not approved', new.rule_set_id using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_assessments_ruleset before insert on public.triage_assessments
  for each row execute function app.require_approved_rule_set();

create table public.triage_signals (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references public.triage_assessments(id) on delete restrict,
  signal_code    text not null check (signal_code ~ '^[a-z][a-z0-9_.]{2,63}$'),
  kind           public.signal_kind not null,
  source         public.signal_source not null,
  weight         smallint,
  display_text   text,                               -- non-diagnostic wording; guarded in the API tier
  evidence       jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at     timestamptz not null default now()
);
create index triage_signals_assessment_idx on public.triage_signals (assessment_id);
create trigger trg_signals_immutable before update or delete on public.triage_signals
  for each row execute function app.forbid_mutation();

-- Every call to an external triage input (e.g. DXGPT). Hard guards:
--   * a live `external_ai_processing` consent is REQUIRED (NOT NULL FK),
--   * only de-identified payloads may be sent (CHECK),
--   * raw provider output is NOT stored; only the sanitised, non-diagnostic features.  [OPEN: policy]
create table public.external_signal_runs (
  id                 uuid primary key default gen_random_uuid(),
  encounter_id       uuid not null references public.encounters(id) on delete restrict,
  assessment_id      uuid references public.triage_assessments(id) on delete restrict,
  provider           text not null,
  model              text,
  consent_id         uuid not null references public.consents(id) on delete restrict,
  deidentified       boolean not null check (deidentified),
  sent_fields        jsonb not null check (jsonb_typeof(sent_fields) = 'object'),
  status             text not null check (status in ('ok', 'error', 'timeout', 'rejected')),
  http_status        integer,
  latency_ms         integer check (latency_ms >= 0),
  sanitized_output   jsonb,
  reliability_passed boolean not null default false,  -- may count as PRIMARY only when true
  reliability_detail jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index external_signal_runs_encounter_idx on public.external_signal_runs (encounter_id);
create trigger trg_external_runs_immutable before update or delete on public.external_signal_runs
  for each row execute function app.forbid_mutation();

create table public.queue_items (
  id               uuid primary key default gen_random_uuid(),
  encounter_id     uuid not null unique references public.encounters(id) on delete restrict,
  facility_id      uuid not null references public.facilities(id) on delete restrict,
  urgency_code     text not null references public.urgency_levels(code),
  priority_score   numeric,
  status           public.queue_status not null default 'waiting',
  assigned_to      uuid references auth.users(id) on delete set null,
  entered_at       timestamptz not null default now(),
  sla_due_at       timestamptz,
  updated_at       timestamptz not null default now()
);
create index queue_items_board_idx on public.queue_items (facility_id, status, urgency_code, entered_at);
create trigger trg_queue_touch before update on public.queue_items
  for each row execute function app.touch_updated_at();

-- Human decisions. Append-only; this is the clinical accountability record.
create table public.review_actions (
  id               uuid primary key default gen_random_uuid(),
  encounter_id     uuid not null references public.encounters(id) on delete restrict,
  assessment_id    uuid references public.triage_assessments(id) on delete restrict,
  reviewer_id      uuid not null references auth.users(id) on delete restrict,
  action           public.review_action_type not null,
  from_urgency_code text references public.urgency_levels(code),
  to_urgency_code   text references public.urgency_levels(code),
  reason           text,
  created_at       timestamptz not null default now(),
  check (action <> 'override_urgency'
         or (to_urgency_code is not null and reason is not null and length(btrim(reason)) >= 5))
);
create index review_actions_encounter_idx on public.review_actions (encounter_id, created_at);
create trigger trg_review_actions_immutable before update or delete on public.review_actions
  for each row execute function app.forbid_mutation();
