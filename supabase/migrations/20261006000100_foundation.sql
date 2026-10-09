create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create type public.app_role as enum
  ('health_worker', 'nurse', 'doctor', 'medical_officer', 'facility_admin');

create type public.facility_type as enum
  ('sub_centre', 'phc', 'chc', 'district_hospital', 'medical_college',
   'company_clinic', 'industrial_unit', 'campus_health_centre', 'health_camp', 'other');

create type public.sex_code as enum ('female', 'male', 'other', 'unknown');

create type public.encounter_scenario as enum
  ('opd_queue', 'occupational', 'campus_fever', 'maternal_followup',
   'chronic_checkin', 'health_camp', 'referral_intake', 'other');

create type public.encounter_status as enum
  ('draft', 'submitted', 'in_review', 'reviewed', 'referred', 'closed', 'cancelled');

create type public.intake_channel as enum
  ('staff_assisted', 'self_service', 'voice', 'camp_batch');

create type public.input_source as enum
  ('patient', 'health_worker', 'document_extraction', 'voice_transcript');

create type public.vital_kind as enum
  ('temperature_c', 'spo2_pct', 'pulse_bpm', 'resp_rate_pm', 'bp_systolic_mmhg',
   'bp_diastolic_mmhg', 'weight_kg', 'height_cm', 'blood_glucose_mgdl', 'muac_cm');

create type public.document_kind as enum
  ('lab_report', 'prescription', 'discharge_summary', 'imaging_report',
   'vaccination_record', 'referral_letter', 'photo', 'other');

create type public.scan_status as enum ('pending', 'clean', 'infected', 'failed');
create type public.job_status as enum ('pending', 'completed', 'failed');

create type public.assessment_basis as enum
  ('rules_engine', 'validated_algorithm', 'external_primary', 'fallback_algorithm');

create type public.signal_kind as enum
  ('red_flag', 'abnormal_vital', 'missing_information', 'duration', 'risk_context', 'external_hint');

create type public.signal_source as enum
  ('rule', 'external_secondary', 'external_primary', 'manual', 'missing_data');

create type public.queue_status as enum
  ('waiting', 'in_review', 'seen', 'referred', 'closed', 'no_show');

create type public.review_action_type as enum
  ('approve', 'override_urgency', 'request_info', 'mark_referral', 'close', 'comment');

create type public.info_audience as enum ('health_worker', 'patient');
create type public.info_status as enum ('open', 'answered', 'dismissed');

create type public.referral_priority as enum ('routine', 'urgent', 'asap', 'stat');
create type public.referral_status as enum
  ('draft', 'requested', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled');

create type public.consent_purpose as enum
  ('care_triage', 'referral_sharing', 'external_ai_processing', 'reminders', 'research_deidentified');
create type public.consent_method as enum ('digital', 'verbal_witnessed', 'paper');
create type public.consent_party as enum ('self', 'guardian', 'representative');

create type public.audit_action as enum
  ('read', 'create', 'update', 'delete', 'export', 'share', 'break_glass',
   'login', 'login_failed', 'logout', 'consent_change', 'erasure');
create type public.audit_outcome as enum ('success', 'denied', 'error');

create or replace function app.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.forbid_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('app.erasure_mode', true), '') = 'on' then
    return new;
  end if;
  raise exception '% on %.% is not allowed (append-only table)', tg_op, tg_table_schema, tg_table_name
    using errcode = '42501';
end $$;

create or replace function app.forbid_mutation_strict()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% on %.% is not allowed (immutable audit log)', tg_op, tg_table_schema, tg_table_name
    using errcode = '42501';
end $$;

create or replace function app.gen_public_ref()
returns text language sql volatile set search_path = '' as $$
  select 'AR' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;
