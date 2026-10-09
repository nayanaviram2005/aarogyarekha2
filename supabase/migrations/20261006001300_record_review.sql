create or replace function app.record_review(
  p_reviewer          uuid,
  p_encounter         uuid,
  p_assessment        uuid,
  p_action            public.review_action_type,
  p_to_urgency        text    default null,
  p_reason            text    default null,
  p_confirm_downgrade boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  enc          record;
  latest       record;
  q            record;
  v_from       text;
  v_rank_to    smallint;
  v_rank_from  smallint;
  v_rank_rules smallint;
  v_downgrade  boolean := false;
  v_below      boolean := false;
  v_id         uuid;
begin
  if p_action not in ('approve', 'override_urgency') then
    raise exception 'unsupported review action' using errcode = '22023';
  end if;

  select * into enc from public.encounters where id = p_encounter and deleted_at is null for update;
  if not found then raise exception 'encounter not found' using errcode = 'P0002'; end if;

  if not exists (select 1 from public.memberships m
                 where m.user_id = p_reviewer and m.facility_id = enc.facility_id and m.is_active
                   and m.role in ('nurse', 'doctor', 'medical_officer')) then
    raise exception 'only a nurse, doctor or medical officer at this facility can review' using errcode = '42501';
  end if;

  if enc.status not in ('submitted', 'in_review') then
    raise exception 'encounter is % and can no longer be reviewed', enc.status using errcode = '55000';
  end if;

  select * into latest from public.triage_assessments where encounter_id = p_encounter order by version desc limit 1;
  if not found then raise exception 'there is no assessment to review yet' using errcode = '55000'; end if;
  if latest.id <> p_assessment then
    raise exception 'the assessment changed while you were reviewing' using errcode = '40001';
  end if;

  select * into q from public.queue_items where encounter_id = p_encounter for update;
  if not found then raise exception 'the encounter is not in the queue' using errcode = '55000'; end if;
  v_from := q.urgency_code;

  if p_action = 'approve' then
    if exists (select 1 from public.review_actions r
               where r.assessment_id = latest.id and r.action in ('approve', 'override_urgency')) then
      raise exception 'this assessment has already been reviewed' using errcode = '23505';
    end if;
    insert into public.review_actions (encounter_id, assessment_id, reviewer_id, action, from_urgency_code, to_urgency_code, reason)
    values (p_encounter, latest.id, p_reviewer, 'approve', v_from, v_from, nullif(btrim(p_reason), ''))
    returning id into v_id;
  else
    select rank into v_rank_to from public.urgency_levels where code = p_to_urgency;
    if v_rank_to is null then raise exception 'unknown urgency level' using errcode = '22023'; end if;
    if p_to_urgency = v_from then raise exception 'the case is already at that priority' using errcode = '22023'; end if;
    if p_reason is null or length(btrim(p_reason)) < 10 then
      raise exception 'an override needs a reason of at least 10 characters' using errcode = '22023';
    end if;
    select rank into v_rank_from  from public.urgency_levels where code = v_from;
    select rank into v_rank_rules from public.urgency_levels where code = latest.urgency_code;
    v_downgrade := v_rank_to > v_rank_rules;
    if v_downgrade and not coalesce(p_confirm_downgrade, false) then
      raise exception 'making the case less urgent than the rules set needs confirmation' using errcode = '22023', hint = 'confirm_downgrade';
    end if;
    v_below := v_downgrade and (latest.note -> 'winning' ->> 'layer') in ('floor', 'pregnancy_bp');
    insert into public.review_actions (encounter_id, assessment_id, reviewer_id, action, from_urgency_code, to_urgency_code, reason)
    values (p_encounter, latest.id, p_reviewer, 'override_urgency', v_from, p_to_urgency, btrim(p_reason))
    returning id into v_id;
    update public.queue_items set urgency_code = p_to_urgency where encounter_id = p_encounter;
  end if;

  update public.encounters set status = 'in_review' where id = p_encounter and status = 'submitted';
  update public.queue_items set status = 'in_review' where encounter_id = p_encounter and status = 'waiting';

  return jsonb_build_object(
    'reviewId', v_id, 'action', p_action, 'fromUrgency', v_from,
    'effectiveUrgency', case when p_action = 'approve' then v_from else p_to_urgency end,
    'rulesUrgency', latest.urgency_code, 'downgrade', v_downgrade, 'belowRuleFloor', v_below,
    'facilityId', enc.facility_id, 'patientId', enc.patient_id);
end $$;

revoke all on function app.record_review(uuid, uuid, uuid, public.review_action_type, text, text, boolean) from public, anon, authenticated;
grant execute on function app.record_review(uuid, uuid, uuid, public.review_action_type, text, text, boolean) to service_role;
