-- 0014 Sending a referral, atomically.
--
-- Sending discloses a patient's information to ANOTHER facility, so the rules that guard it live in the database, not only in
-- the API. In one transaction this function: checks the sender is a reviewer at the referring facility, checks the referral is
-- still a draft with a receiver and a written reason, checks the assessment being referred is still the latest AND has been
-- signed off by a reviewer, checks the patient has an active `referral_sharing` consent, then freezes the FHIR Bundle
-- (referrals.bundle + sha256), moves the referral to `requested`, the encounter to `referred` and the queue entry to `referred`.
-- The Bundle is built by the API (it needs every table); this function only accepts it, it does not inspect its contents.
--
-- It sets the transaction-local JWT subject to the sender so the existing triggers (event log, audit, lifecycle guard) record
-- WHO sent it, as they would for a direct user update.
--
-- Errors: P0002 not found · 42501 not allowed (hint 'referral_consent' when consent is missing) · 55000 wrong state
--         (hint 'needs_review' when not signed off) · 40001 assessment changed · 22023 incomplete draft / bad input
create or replace function app.send_referral(
  p_user uuid, p_referral uuid, p_assessment uuid, p_bundle jsonb, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r      record;
  enc    record;
  latest record;
  v_sent timestamptz;
begin
  select * into r from public.referrals where id = p_referral for update;
  if not found then raise exception 'referral not found' using errcode = 'P0002'; end if;

  if not exists (select 1 from public.memberships m
                 where m.user_id = p_user and m.facility_id = r.from_facility_id and m.is_active
                   and m.role in ('nurse', 'doctor', 'medical_officer')) then
    raise exception 'only a nurse, doctor or medical officer at the referring facility can send a referral' using errcode = '42501';
  end if;

  if r.status <> 'draft' then raise exception 'referral is % and can no longer be sent', r.status using errcode = '55000'; end if;
  if r.to_facility_id is null then raise exception 'choose the receiving facility first' using errcode = '22023'; end if;
  if r.reason_text is null or length(btrim(r.reason_text)) < 10 then raise exception 'the referral needs a written reason' using errcode = '22023'; end if;
  if p_bundle is null or jsonb_typeof(p_bundle) <> 'object' or p_bundle ->> 'resourceType' <> 'Bundle' then
    raise exception 'the referral document is missing' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad checksum' using errcode = '22023'; end if;

  select * into enc from public.encounters where id = r.encounter_id and deleted_at is null for update;
  if not found then raise exception 'encounter not found' using errcode = 'P0002'; end if;
  if enc.status not in ('submitted', 'in_review') then
    raise exception 'encounter is % and can no longer be referred', enc.status using errcode = '55000';
  end if;

  select * into latest from public.triage_assessments where encounter_id = r.encounter_id order by version desc limit 1;
  if not found then raise exception 'there is no assessment to refer' using errcode = '55000', hint = 'needs_review'; end if;
  if latest.id <> p_assessment then raise exception 'the assessment changed while the referral was being prepared' using errcode = '40001'; end if;
  if not exists (select 1 from public.review_actions a where a.assessment_id = latest.id and a.action in ('approve', 'override_urgency')) then
    raise exception 'a reviewer must sign off the triage priority before it is referred' using errcode = '55000', hint = 'needs_review';
  end if;

  if not exists (select 1 from public.consents c
                 where c.patient_id = r.patient_id and c.purpose = 'referral_sharing' and c.revoked_at is null
                   and c.granted_at <= now() and (c.expires_at is null or c.expires_at > now())) then
    raise exception 'the patient has not consented to sharing this referral' using errcode = '42501', hint = 'referral_consent';
  end if;

  perform set_config('request.jwt.claim.sub', p_user::text, true);   -- attribute the triggers' records to the sender

  update public.referrals
     set status = 'requested', bundle = p_bundle, bundle_sha256 = decode(p_sha256, 'hex')
   where id = p_referral
  returning sent_at into v_sent;

  update public.encounters set status = 'referred' where id = r.encounter_id;
  update public.queue_items set status = 'referred' where encounter_id = r.encounter_id;

  return jsonb_build_object('referralId', p_referral, 'status', 'requested', 'sentAt', v_sent, 'sha256', p_sha256,
                            'facilityId', r.from_facility_id, 'toFacilityId', r.to_facility_id, 'patientId', r.patient_id, 'encounterId', r.encounter_id);
end $$;

revoke all on function app.send_referral(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app.send_referral(uuid, uuid, uuid, jsonb, text) to service_role;
