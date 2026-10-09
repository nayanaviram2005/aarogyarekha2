
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.reviewer_notes'::regclass and contype = 'c' loop
    execute format('alter table public.reviewer_notes drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.reviewer_notes
  add constraint reviewer_notes_kind_chk check (kind in ('comment', 'escalation', 'feedback_up', 'feedback_down', 'doctor_note')),
  add constraint reviewer_notes_body_chk check (body is null or length(btrim(body)) between 1 and (case when kind = 'doctor_note' then 2000 else 1000 end)),
  add constraint reviewer_notes_body_required_chk check (kind not in ('comment', 'escalation', 'doctor_note') or body is not null);

drop policy if exists rn_insert on public.reviewer_notes;
create policy rn_insert on public.reviewer_notes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (case when kind = 'doctor_note'
              then app.has_role_at(app.encounter_facility(encounter_id), array['doctor', 'medical_officer']::public.app_role[])
              else app.is_reviewer_at(app.encounter_facility(encounter_id)) end)
    and (assessment_id is null or app.assessment_encounter(assessment_id) = encounter_id));

create or replace function app.doctor_note_after_signoff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'doctor_note' and not exists (
    select 1 from public.encounters e where e.id = new.encounter_id and e.status in ('reviewed', 'referred', 'closed')) then
    raise exception 'A doctor''s note can be added once the priority has been signed off.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.doctor_note_after_signoff() from public, anon, authenticated;

drop trigger if exists trg_reviewer_notes_doctor_note on public.reviewer_notes;
create trigger trg_reviewer_notes_doctor_note before insert on public.reviewer_notes
  for each row execute function app.doctor_note_after_signoff();
