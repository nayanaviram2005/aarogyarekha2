create table public.reviewer_notes (
  id            uuid primary key default gen_random_uuid(),
  encounter_id  uuid not null references public.encounters(id) on delete restrict,
  assessment_id uuid references public.triage_assessments(id) on delete restrict,
  author_id     uuid not null references auth.users(id) on delete restrict,
  kind          text not null check (kind in ('comment', 'escalation', 'feedback_up', 'feedback_down')),
  body          text check (body is null or length(btrim(body)) between 1 and 1000),
  created_at    timestamptz not null default now(),
  check (kind not in ('comment', 'escalation') or body is not null)
);
create index reviewer_notes_encounter_idx on public.reviewer_notes (encounter_id, created_at);
create index reviewer_notes_kind_idx on public.reviewer_notes (kind, created_at);

create trigger trg_reviewer_notes_immutable before update or delete on public.reviewer_notes
  for each row execute function app.forbid_mutation();
create trigger trg_audit_reviewer_notes after insert or update on public.reviewer_notes
  for each row execute function app.audit_row_change();

alter table public.reviewer_notes enable row level security;
grant select, insert on public.reviewer_notes to authenticated;
create policy rn_select on public.reviewer_notes for select to authenticated
  using (app.can_access_encounter_staff(encounter_id));
create policy rn_insert on public.reviewer_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and app.is_reviewer_at(app.encounter_facility(encounter_id))
              and (assessment_id is null or app.assessment_encounter(assessment_id) = encounter_id));
