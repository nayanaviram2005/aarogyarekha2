create or replace function app.doctor_note_after_signoff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'doctor_note' and not exists (
    select 1 from public.encounters e
     where e.id = new.encounter_id
       and (e.status in ('referred', 'closed')
            or exists (select 1 from public.review_actions r where r.encounter_id = e.id and r.action in ('approve', 'override_urgency')))) then
    raise exception 'A doctor''s note can be added once the priority has been signed off.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.doctor_note_after_signoff() from public, anon, authenticated;
