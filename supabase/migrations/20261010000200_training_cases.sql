create table public.training_cases (
  id               uuid primary key default gen_random_uuid(),
  case_id          text not null unique,
  schema_version   text not null,
  features         jsonb not null check (jsonb_typeof(features) = 'object'),
  engine           jsonb not null check (jsonb_typeof(engine) = 'object'),
  label            jsonb not null check (jsonb_typeof(label) = 'object'),
  fhir             jsonb not null check (jsonb_typeof(fhir) = 'object'),
  withheld_fields  integer not null default 0 check (withheld_fields >= 0),
  created_at       timestamptz not null default now()
);

comment on table public.training_cases is 'Anonymised, consented triage cases for training. By design there is no link to patients, encounters, facilities or users, so a case cannot be traced back or taken back. Written and read only by the server.';

alter table public.training_cases enable row level security;
revoke all on public.training_cases from public, anon, authenticated;
grant select, insert, delete on public.training_cases to service_role;

create trigger trg_training_cases_no_update before update on public.training_cases
  for each row execute function app.forbid_mutation();
