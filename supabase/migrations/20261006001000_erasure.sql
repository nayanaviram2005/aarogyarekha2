create or replace function app.erase_patient(p_request uuid, p_decided_by uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid;
  v_status  text;
  v_paths   text[];
begin
  select patient_id, status into v_patient, v_status
  from public.erasure_requests where id = p_request for update;
  if v_patient is null then raise exception 'unknown erasure request %', p_request; end if;
  if v_status <> 'pending' then
    raise exception 'erasure request % is %, not pending', p_request, v_status using errcode = '23514';
  end if;

  perform set_config('app.erasure_mode', 'on', true);

  select coalesce(array_agg(storage_path), '{}') into v_paths
  from public.documents where patient_id = v_patient;

  update public.patients set
    full_name = '[erased]', birth_date = null, age_years_reported = null, phone = null,
    address_line = null, village_town = null, district = null, state = null, pincode = null,
    guardian_name = null, guardian_phone = null, user_id = null, deleted_at = now()
  where id = v_patient;
  delete from public.patient_identifiers where patient_id = v_patient;
  delete from public.health_card_tokens  where patient_id = v_patient;
  delete from public.reported_history    where patient_id = v_patient;
  delete from public.pregnancy_episodes  where patient_id = v_patient;

  update public.encounters set chief_complaint_original = null, chief_complaint_translated = null,
         context = '{}'::jsonb, deleted_at = coalesce(deleted_at, now())
  where patient_id = v_patient;
  update public.symptom_entries set text_original = '[erased]', text_translated = null
  where encounter_id in (select id from public.encounters where patient_id = v_patient);
  delete from public.vitals
  where encounter_id in (select id from public.encounters where patient_id = v_patient);
  update public.info_requests set question_text = '[erased]', answer_text = null
  where encounter_id in (select id from public.encounters where patient_id = v_patient);

  delete from public.extracted_fields
  where extraction_id in (select x.id from public.extractions x join public.documents d on d.id = x.document_id
                          where d.patient_id = v_patient);
  update public.extractions set raw_text = null
  where document_id in (select id from public.documents where patient_id = v_patient);
  update public.documents set original_filename = null, deleted_at = coalesce(deleted_at, now())
  where patient_id = v_patient;

  update public.triage_assessments set note = '{"erased": true}'::jsonb
  where encounter_id in (select id from public.encounters where patient_id = v_patient);
  update public.triage_signals set display_text = null, evidence = '{}'::jsonb
  where assessment_id in (select a.id from public.triage_assessments a
                          join public.encounters e on e.id = a.encounter_id where e.patient_id = v_patient);
  update public.external_signal_runs set sent_fields = '{}'::jsonb, sanitized_output = null
  where encounter_id in (select id from public.encounters where patient_id = v_patient);
  update public.review_actions set reason = case when reason is null then null else '[erased]' end
  where encounter_id in (select id from public.encounters where patient_id = v_patient);
  update public.referrals set bundle = null, bundle_sha256 = null, reason_text = null, erased_at = now()
  where patient_id = v_patient;

  update public.consents set witness_name = null where patient_id = v_patient;
  update public.access_grants set revoked_at = coalesce(revoked_at, now()) where patient_id = v_patient;
  update public.followup_schedules set active = false where patient_id = v_patient;

  update public.erasure_requests set status = 'completed', decided_by = p_decided_by, decided_at = now()
  where id = p_request;

  perform set_config('app.erasure_mode', 'off', true);
  return v_paths;
end $$;

revoke all on function app.erase_patient(uuid, uuid) from public, anon, authenticated;
grant execute on function app.erase_patient(uuid, uuid) to service_role;
