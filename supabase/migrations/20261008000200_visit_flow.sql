-- 0018 Getting patients off the queue: call in, complete the visit.
--
-- Queue states (queue_items.status) as used by the app:
--   waiting    in the queue, not yet called
--   in_review  called in / being seen (also set when a nurse or doctor signs off the priority)
--   seen       visit completed, treated here          (leaves the queue)
--   closed     visit completed, sent home              (leaves the queue)
--   no_show    did not wait / left before being seen   (leaves the queue)
--   referred   a referral was sent                      (leaves the queue; set by app.send_referral)
--
-- Two atomic functions do the changes, called by the API tier (service_role) with the person's id passed explicitly and re-checked
-- here, so they are safe even if the API is bypassed or buggy:
--   app.call_in(actor, encounter)                    waiting -> in_review, assigned to the actor, time recorded
--   app.complete_visit(actor, encounter, outcome)    in_review/waiting -> a finished state; the encounter is closed with the outcome
-- Rules:
--   * only people with an ACTIVE clinical role at the encounter's facility; completing a visit as treated or sent home needs a nurse,
--     doctor or medical officer, and the CURRENT assessment must already have been reviewed (a human signed it off). Recording that a
--     person did not wait needs no review (there is nothing to sign off).
--   * a patient already called in by someone else cannot be called in by another person (they are being seen),
--   * a referral is NOT completed here: sending the referral already takes the patient off the queue,
--   * every change writes an audit entry holding ids and the outcome code only.
-- SQLSTATEs: P0002 not found · 42501 not allowed · 55000 wrong state or already taken · 22023 bad input
alter table public.encounters
  add column if not exists outcome text,
  add column if not exists closed_by uuid references auth.users(id) on delete set null;
alter table public.encounters drop constraint if exists encounters_outcome_chk;
alter table public.encounters add constraint encounters_outcome_chk
  check (outcome is null or outcome in ('treated_here', 'sent_home', 'did_not_wait', 'referred'));

alter table public.queue_items
  add column if not exists called_at timestamptz,
  add column if not exists completed_at timestamptz;

create or replace function app.call_in(p_actor uuid, p_encounter uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare enc record; q record;
begin
  select * into enc from public.encounters where id = p_encounter and deleted_at is null for update;
  if not found then raise exception 'encounter not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships m where m.user_id = p_actor and m.facility_id = enc.facility_id and m.is_active
                   and m.role in ('health_worker', 'nurse', 'doctor', 'medical_officer')) then
    raise exception 'only clinical staff at this facility can call a patient in' using errcode = '42501';
  end if;
  if enc.status not in ('submitted', 'in_review') then
    raise exception 'encounter is % and is no longer in the queue', enc.status using errcode = '55000';
  end if;
  select * into q from public.queue_items where encounter_id = p_encounter for update;
  if not found then raise exception 'the encounter is not in the queue yet: assess it first' using errcode = '55000'; end if;
  if q.status not in ('waiting', 'in_review') then raise exception 'the patient is no longer in the queue' using errcode = '55000'; end if;
  if q.status = 'in_review' and q.assigned_to is not null and q.assigned_to <> p_actor then
    raise exception 'this patient is already being seen by someone else' using errcode = '55000', hint = 'taken';
  end if;

  update public.queue_items set status = 'in_review', assigned_to = p_actor, called_at = coalesce(called_at, now()) where id = q.id;
  update public.encounters set status = 'in_review' where id = p_encounter and status = 'submitted';
  perform app.write_audit('update', 'queue_item', q.id, enc.patient_id, enc.facility_id, p_actor, 'success', null, null, 'visit-flow', null,
                          jsonb_build_object('op', 'call_in', 'urgency', q.urgency_code, 'waitedSeconds', floor(extract(epoch from (now() - q.entered_at)))));
  return jsonb_build_object('encounterId', p_encounter, 'status', 'in_review', 'facilityId', enc.facility_id, 'patientId', enc.patient_id);
end $$;

create or replace function app.complete_visit(p_actor uuid, p_encounter uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare enc record; q record; latest record; v_queue text; v_reviewer boolean;
begin
  if p_outcome not in ('treated_here', 'sent_home', 'did_not_wait') then
    raise exception 'unknown outcome (a referral is completed by sending it)' using errcode = '22023';
  end if;
  select * into enc from public.encounters where id = p_encounter and deleted_at is null for update;
  if not found then raise exception 'encounter not found' using errcode = 'P0002'; end if;

  v_reviewer := exists (select 1 from public.memberships m where m.user_id = p_actor and m.facility_id = enc.facility_id and m.is_active
                          and m.role in ('nurse', 'doctor', 'medical_officer'));
  if p_outcome = 'did_not_wait' then
    if not (v_reviewer or exists (select 1 from public.memberships m where m.user_id = p_actor and m.facility_id = enc.facility_id and m.is_active and m.role = 'health_worker')) then
      raise exception 'only clinical staff at this facility can do this' using errcode = '42501';
    end if;
  elsif not v_reviewer then
    raise exception 'only a nurse, doctor or medical officer at this facility can complete a visit' using errcode = '42501';
  end if;

  if enc.status not in ('submitted', 'in_review') then
    raise exception 'encounter is % and cannot be completed', enc.status using errcode = '55000';
  end if;
  select * into q from public.queue_items where encounter_id = p_encounter for update;
  if not found then raise exception 'the encounter is not in the queue' using errcode = '55000'; end if;

  if p_outcome <> 'did_not_wait' then
    select * into latest from public.triage_assessments where encounter_id = p_encounter order by version desc limit 1;
    if not found or not exists (select 1 from public.review_actions r where r.assessment_id = latest.id and r.action in ('approve', 'override_urgency')) then
      raise exception 'a nurse or doctor must review the priority before the visit is completed' using errcode = '55000', hint = 'review_first';
    end if;
  end if;

  v_queue := case p_outcome when 'treated_here' then 'seen' when 'sent_home' then 'closed' else 'no_show' end;
  update public.queue_items set status = v_queue::public.queue_status, completed_at = now(), assigned_to = coalesce(assigned_to, p_actor) where id = q.id;
  update public.encounters set status = 'closed', closed_at = now(), outcome = p_outcome, closed_by = p_actor where id = p_encounter;
  perform app.write_audit('update', 'queue_item', q.id, enc.patient_id, enc.facility_id, p_actor, 'success', null, null, 'visit-flow', null,
                          jsonb_build_object('op', 'complete_visit', 'outcome', p_outcome, 'urgency', q.urgency_code, 'totalSeconds', floor(extract(epoch from (now() - q.entered_at)))));
  return jsonb_build_object('encounterId', p_encounter, 'outcome', p_outcome, 'queueStatus', v_queue, 'facilityId', enc.facility_id, 'patientId', enc.patient_id);
end $$;

-- The same lesson as 0012 and 0013: functions are PUBLIC-executable by default. Only the service role may call these.
revoke all on function app.call_in(uuid, uuid) from public, anon, authenticated;
grant execute on function app.call_in(uuid, uuid) to service_role;
revoke all on function app.complete_visit(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.complete_visit(uuid, uuid, text) to service_role;
