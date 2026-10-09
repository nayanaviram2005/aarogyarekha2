create or replace function app.can_access_encounter_staff(p_encounter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.encounters e
    where e.id = p_encounter and e.deleted_at is null and (
      app.is_clinician_at(e.facility_id)
      or exists (select 1 from public.referrals r
                 where r.encounter_id = e.id and r.status in ('requested','accepted','in_progress','completed')
                   and app.is_clinician_at(r.to_facility_id))
      or exists (select 1 from public.access_grants g
                 where g.patient_id = e.patient_id and g.scope = 'read_full' and g.revoked_at is null
                   and g.expires_at > now() and app.is_clinician_at(g.grantee_facility_id))
      or exists (select 1 from public.break_glass_grants b
                 where b.patient_id = e.patient_id and b.user_id = (select auth.uid()) and b.expires_at > now()
                   and app.is_clinician_at(b.facility_id))));
$$;

create or replace function app.document_patient(p_doc uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select patient_id from public.documents where id = p_doc and deleted_at is null;
$$;
create or replace function app.document_facility(p_doc uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select facility_id from public.documents where id = p_doc and deleted_at is null;
$$;
create or replace function app.extraction_document(p_ext uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select document_id from public.extractions where id = p_ext;
$$;
create or replace function app.assessment_encounter(p_assessment uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select encounter_id from public.triage_assessments where id = p_assessment;
$$;
create or replace function app.consent_is_active(p_consent uuid, p_patient uuid, p_purpose public.consent_purpose)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.consents c
                 where c.id = p_consent and c.patient_id = p_patient and c.purpose = p_purpose
                   and c.revoked_at is null and (c.expires_at is null or c.expires_at > now()));
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.write_audit(public.audit_action, text, uuid, uuid, uuid, uuid, public.audit_outcome, text, inet, text, text, jsonb) from authenticated;
revoke execute on function app.verify_audit_chain(bigint) from authenticated;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update on public.facilities to authenticated;
create policy facilities_select on public.facilities for select to authenticated
  using (is_active or app.is_platform_admin());
create policy facilities_insert on public.facilities for insert to authenticated
  with check (app.is_platform_admin());
create policy facilities_update on public.facilities for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

grant select, insert, delete on public.facility_capabilities to authenticated;
create policy fcap_select on public.facility_capabilities for select to authenticated using (true);
create policy fcap_insert on public.facility_capabilities for insert to authenticated
  with check (app.is_platform_admin() or app.is_facility_admin_at(facility_id));
create policy fcap_delete on public.facility_capabilities for delete to authenticated
  using (app.is_platform_admin() or app.is_facility_admin_at(facility_id));

grant select on public.profiles to authenticated;
grant update (display_name, phone, preferred_language) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or app.shares_facility_with(user_id));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.memberships to authenticated;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or app.is_facility_admin_at(facility_id) or app.is_platform_admin());
create policy memberships_insert on public.memberships for insert to authenticated
  with check ((app.is_facility_admin_at(facility_id) and role <> 'facility_admin') or app.is_platform_admin());
create policy memberships_update on public.memberships for update to authenticated
  using (app.is_facility_admin_at(facility_id) or app.is_platform_admin())
  with check ((app.is_facility_admin_at(facility_id) and role <> 'facility_admin') or app.is_platform_admin());
create policy memberships_delete on public.memberships for delete to authenticated
  using ((app.is_facility_admin_at(facility_id) and role <> 'facility_admin') or app.is_platform_admin());

grant select on public.patients to authenticated;
grant insert (registered_facility_id, full_name, preferred_language, sex, birth_date, age_years_reported,
              phone, address_line, village_town, district, state, pincode, guardian_name, guardian_phone,
              created_by) on public.patients to authenticated;
grant update (full_name, preferred_language, sex, birth_date, age_years_reported, phone, address_line,
              village_town, district, state, pincode, guardian_name, guardian_phone) on public.patients to authenticated;
create policy patients_select on public.patients for select to authenticated
  using (deleted_at is null
         and (app.is_clinician_at(registered_facility_id) or user_id = (select auth.uid())
              or app.can_access_patient(id)));
create policy patients_insert on public.patients for insert to authenticated
  with check (app.is_clinician_at(registered_facility_id) and created_by = (select auth.uid()));
create policy patients_update on public.patients for update to authenticated
  using (deleted_at is null and app.is_clinician_at(registered_facility_id))
  with check (app.is_clinician_at(registered_facility_id));

grant select, insert, update, delete on public.patient_identifiers to authenticated;
create policy pid_select on public.patient_identifiers for select to authenticated
  using (app.can_access_patient(patient_id));
create policy pid_write on public.patient_identifiers for insert to authenticated
  with check (app.is_clinician_at(app.patient_registered_facility(patient_id)));
create policy pid_update on public.patient_identifiers for update to authenticated
  using (app.is_clinician_at(app.patient_registered_facility(patient_id)))
  with check (app.is_clinician_at(app.patient_registered_facility(patient_id)));
create policy pid_delete on public.patient_identifiers for delete to authenticated
  using (app.is_clinician_at(app.patient_registered_facility(patient_id)));

grant select, insert on public.reported_history to authenticated;
grant update (confirmed_by, confirmed_at) on public.reported_history to authenticated;
create policy rh_select on public.reported_history for select to authenticated
  using (app.can_access_patient(patient_id));
create policy rh_insert on public.reported_history for insert to authenticated
  with check (recorded_by = (select auth.uid())
              and (app.is_clinician_at(app.patient_registered_facility(patient_id)) or app.is_self_patient(patient_id)));
create policy rh_confirm on public.reported_history for update to authenticated
  using (app.is_reviewer_at(app.patient_registered_facility(patient_id)))
  with check (app.is_reviewer_at(app.patient_registered_facility(patient_id)) and confirmed_by = (select auth.uid()));

grant select, insert, update on public.pregnancy_episodes to authenticated;
create policy preg_select on public.pregnancy_episodes for select to authenticated
  using (app.can_access_patient(patient_id));
create policy preg_insert on public.pregnancy_episodes for insert to authenticated
  with check (app.is_clinician_at(app.patient_registered_facility(patient_id)));
create policy preg_update on public.pregnancy_episodes for update to authenticated
  using (app.is_clinician_at(app.patient_registered_facility(patient_id)))
  with check (app.is_clinician_at(app.patient_registered_facility(patient_id)));

grant select, insert on public.consents to authenticated;
grant update (revoked_at) on public.consents to authenticated;
create policy consents_select on public.consents for select to authenticated
  using (app.can_access_patient(patient_id));
create policy consents_insert on public.consents for insert to authenticated
  with check ((app.is_clinician_at(app.patient_registered_facility(patient_id)) and captured_by = (select auth.uid()))
              or (app.is_self_patient(patient_id) and given_by = 'self'));
create policy consents_revoke on public.consents for update to authenticated
  using (app.is_clinician_at(app.patient_registered_facility(patient_id)) or app.is_self_patient(patient_id))
  with check (app.is_clinician_at(app.patient_registered_facility(patient_id)) or app.is_self_patient(patient_id));

grant select, insert on public.access_grants to authenticated;
grant update (revoked_at) on public.access_grants to authenticated;
create policy grants_select on public.access_grants for select to authenticated
  using (app.can_access_patient(patient_id) or app.is_clinician_at(grantee_facility_id));
create policy grants_insert on public.access_grants for insert to authenticated
  with check ((app.is_clinician_at(app.patient_registered_facility(patient_id)) or app.is_self_patient(patient_id))
              and created_by = (select auth.uid())
              and app.consent_is_active(source_consent_id, patient_id, 'referral_sharing'));
create policy grants_revoke on public.access_grants for update to authenticated
  using (app.is_clinician_at(app.patient_registered_facility(patient_id)) or app.is_self_patient(patient_id))
  with check (app.is_clinician_at(app.patient_registered_facility(patient_id)) or app.is_self_patient(patient_id));

grant select, insert on public.break_glass_grants to authenticated;
grant update (reviewed_by, reviewed_at) on public.break_glass_grants to authenticated;
create policy bg_select on public.break_glass_grants for select to authenticated
  using (user_id = (select auth.uid()) or app.is_facility_admin_at(facility_id));
create policy bg_insert on public.break_glass_grants for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_clinician_at(facility_id));
create policy bg_review on public.break_glass_grants for update to authenticated
  using (app.is_facility_admin_at(facility_id))
  with check (app.is_facility_admin_at(facility_id) and reviewed_by = (select auth.uid()));

grant select on public.encounters to authenticated;
grant insert (patient_id, facility_id, scenario, channel, status, language, chief_complaint_original,
              chief_complaint_translated, translation_confidence, group_ref, context, created_by)
  on public.encounters to authenticated;
grant update (status, language, chief_complaint_original, chief_complaint_translated, translation_confidence,
              group_ref, context, submitted_at, closed_at) on public.encounters to authenticated;
create policy enc_select on public.encounters for select to authenticated
  using (deleted_at is null and (app.is_clinician_at(facility_id) or app.can_access_encounter(id)));
create policy enc_insert on public.encounters for insert to authenticated
  with check (app.is_clinician_at(facility_id) and created_by = (select auth.uid())
              and app.can_access_patient(patient_id));
create policy enc_update on public.encounters for update to authenticated
  using (deleted_at is null and app.is_clinician_at(facility_id))
  with check (app.is_clinician_at(facility_id));

grant select, insert on public.symptom_entries to authenticated;
create policy sym_select on public.symptom_entries for select to authenticated
  using (app.can_access_encounter(encounter_id));
create policy sym_insert on public.symptom_entries for insert to authenticated
  with check (recorded_by = (select auth.uid()) and app.is_clinician_at(app.encounter_facility(encounter_id)));

grant select, insert on public.vitals to authenticated;
create policy vit_select on public.vitals for select to authenticated
  using (app.can_access_encounter(encounter_id));
create policy vit_insert on public.vitals for insert to authenticated
  with check (measured_by = (select auth.uid()) and app.is_clinician_at(app.encounter_facility(encounter_id)));

grant select, insert, update on public.info_requests to authenticated;
create policy info_select on public.info_requests for select to authenticated
  using (app.can_access_encounter(encounter_id));
create policy info_insert on public.info_requests for insert to authenticated
  with check (app.is_clinician_at(app.encounter_facility(encounter_id)));
create policy info_update on public.info_requests for update to authenticated
  using (app.is_clinician_at(app.encounter_facility(encounter_id)))
  with check (app.is_clinician_at(app.encounter_facility(encounter_id)));

grant select on public.documents to authenticated;
grant insert (id, patient_id, encounter_id, facility_id, kind, storage_path, mime_type, size_bytes, sha256,
              original_filename, uploaded_by) on public.documents to authenticated;
create policy docs_select on public.documents for select to authenticated
  using (deleted_at is null and app.can_access_patient(patient_id));
create policy docs_insert on public.documents for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and scan_status = 'pending'
              and ((app.is_clinician_at(facility_id) and app.can_access_patient(patient_id))
                   or (app.is_self_patient(patient_id) and facility_id = app.patient_registered_facility(patient_id))));

grant select on public.extractions to authenticated;
create policy ext_select on public.extractions for select to authenticated
  using (app.can_access_patient(app.document_patient(document_id)));

grant select on public.extracted_fields to authenticated;
grant update (value_text, value_num, unit, verified_by, verified_at) on public.extracted_fields to authenticated;
create policy extf_select on public.extracted_fields for select to authenticated
  using (app.can_access_patient(app.document_patient(app.extraction_document(extraction_id))));
create policy extf_verify on public.extracted_fields for update to authenticated
  using (app.is_clinician_at(app.document_facility(app.extraction_document(extraction_id))))
  with check (app.is_clinician_at(app.document_facility(app.extraction_document(extraction_id)))
              and (verified_by is null or verified_by = (select auth.uid())));

grant select on public.urgency_levels to authenticated;
create policy urgency_select on public.urgency_levels for select to authenticated using (true);

grant select on public.triage_rule_sets to authenticated;
create policy ruleset_select on public.triage_rule_sets for select to authenticated using (status = 'approved');

grant select on public.triage_assessments to authenticated;
create policy ta_select on public.triage_assessments for select to authenticated
  using (app.can_access_encounter_staff(encounter_id));

grant select on public.triage_signals to authenticated;
create policy ts_select on public.triage_signals for select to authenticated
  using (app.can_access_encounter_staff(app.assessment_encounter(assessment_id)));

grant select on public.external_signal_runs to authenticated;
create policy esr_select on public.external_signal_runs for select to authenticated
  using (app.can_access_encounter_staff(encounter_id));

grant select on public.queue_items to authenticated;
grant update (status, assigned_to) on public.queue_items to authenticated;
create policy queue_select on public.queue_items for select to authenticated
  using (app.is_clinician_at(facility_id));
create policy queue_update on public.queue_items for update to authenticated
  using (app.is_reviewer_at(facility_id)) with check (app.is_reviewer_at(facility_id));

grant select, insert on public.review_actions to authenticated;
create policy ra_select on public.review_actions for select to authenticated
  using (app.can_access_encounter_staff(encounter_id));
create policy ra_insert on public.review_actions for insert to authenticated
  with check (reviewer_id = (select auth.uid()) and app.is_reviewer_at(app.encounter_facility(encounter_id)));

grant select, insert on public.referrals to authenticated;
grant update (to_facility_id, priority, reason_text, status, status_reason, bundle, bundle_sha256)
  on public.referrals to authenticated;
create policy ref_select on public.referrals for select to authenticated
  using (app.is_clinician_at(from_facility_id)
         or (status <> 'draft' and (app.is_clinician_at(to_facility_id) or app.is_self_patient(patient_id))));
create policy ref_insert on public.referrals for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'draft' and app.is_reviewer_at(from_facility_id)
              and app.can_access_encounter(encounter_id));
create policy ref_update on public.referrals for update to authenticated
  using (app.is_reviewer_at(from_facility_id) or (status <> 'draft' and app.is_reviewer_at(to_facility_id)))
  with check (app.is_reviewer_at(from_facility_id) or app.is_reviewer_at(to_facility_id));

grant select on public.referral_events to authenticated;
create policy refev_select on public.referral_events for select to authenticated
  using (exists (select 1 from public.referrals r where r.id = referral_id));

grant select, insert, delete on public.referral_documents to authenticated;
create policy refdoc_select on public.referral_documents for select to authenticated
  using (exists (select 1 from public.referrals r where r.id = referral_id));
create policy refdoc_insert on public.referral_documents for insert to authenticated
  with check (exists (select 1 from public.referrals r
                      where r.id = referral_id and r.status = 'draft' and app.is_reviewer_at(r.from_facility_id)));
create policy refdoc_delete on public.referral_documents for delete to authenticated
  using (exists (select 1 from public.referrals r
                 where r.id = referral_id and r.status = 'draft' and app.is_reviewer_at(r.from_facility_id)));

grant select, insert, update on public.followup_schedules to authenticated;
create policy fu_select on public.followup_schedules for select to authenticated
  using (app.is_clinician_at(facility_id));
create policy fu_insert on public.followup_schedules for insert to authenticated
  with check (app.is_clinician_at(facility_id) and created_by = (select auth.uid()));
create policy fu_update on public.followup_schedules for update to authenticated
  using (app.is_clinician_at(facility_id)) with check (app.is_clinician_at(facility_id));

grant select on public.reminders to authenticated;
create policy rem_select on public.reminders for select to authenticated
  using (exists (select 1 from public.followup_schedules s where s.id = schedule_id));

grant select, insert on public.erasure_requests to authenticated;
create policy er_select on public.erasure_requests for select to authenticated
  using (app.can_access_patient(patient_id));
create policy er_insert on public.erasure_requests for insert to authenticated
  with check (status = 'pending' and decided_by is null
              and ((requested_via = 'self' and app.is_self_patient(patient_id))
                   or (requested_via in ('staff', 'guardian')
                       and app.is_clinician_at(app.patient_registered_facility(patient_id)))));

grant select on public.audit_events to authenticated;
create policy audit_select on public.audit_events for select to authenticated
  using ((facility_id is not null and app.is_facility_admin_at(facility_id))
         or app.is_platform_admin()
         or (patient_id is not null and app.is_self_patient(patient_id)));

