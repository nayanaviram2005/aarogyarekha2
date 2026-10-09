create or replace function app.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins p where p.user_id = (select auth.uid()));
$$;

create or replace function app.has_role_at(p_facility uuid, p_roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.facility_id = p_facility
      and m.is_active and m.role = any (p_roles));
$$;

create or replace function app.is_clinician_at(p_facility uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role_at(p_facility, array['health_worker','nurse','doctor','medical_officer']::public.app_role[]);
$$;

create or replace function app.is_reviewer_at(p_facility uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role_at(p_facility, array['nurse','doctor','medical_officer']::public.app_role[]);
$$;

create or replace function app.is_facility_admin_at(p_facility uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role_at(p_facility, array['facility_admin']::public.app_role[]);
$$;

create or replace function app.shares_facility_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.facility_id = b.facility_id
    where a.user_id = (select auth.uid()) and a.is_active and b.user_id = p_user and b.is_active);
$$;

create or replace function app.is_self_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.patients p
                 where p.id = p_patient and p.user_id = (select auth.uid()) and p.deleted_at is null);
$$;

create or replace function app.can_access_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    app.is_self_patient(p_patient)
    or exists (select 1 from public.patients p
               where p.id = p_patient and app.is_clinician_at(p.registered_facility_id))
    or exists (select 1 from public.encounters e
               where e.patient_id = p_patient and e.deleted_at is null and app.is_clinician_at(e.facility_id))
    or exists (select 1 from public.referrals r
               where r.patient_id = p_patient and r.status in ('requested','accepted','in_progress','completed')
                 and app.is_clinician_at(r.to_facility_id))
    or exists (select 1 from public.access_grants g
               where g.patient_id = p_patient and g.revoked_at is null and g.expires_at > now()
                 and app.is_clinician_at(g.grantee_facility_id))
    or exists (select 1 from public.break_glass_grants b
               where b.patient_id = p_patient and b.user_id = (select auth.uid()) and b.expires_at > now()
                 and app.is_clinician_at(b.facility_id));
$$;

create or replace function app.can_access_encounter(p_encounter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.encounters e
    where e.id = p_encounter and e.deleted_at is null and (
      app.is_self_patient(e.patient_id)
      or app.is_clinician_at(e.facility_id)
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

create or replace function app.encounter_facility(p_encounter uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select facility_id from public.encounters where id = p_encounter;
$$;

create or replace function app.patient_registered_facility(p_patient uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select registered_facility_id from public.patients where id = p_patient;
$$;

create or replace function app.can_read_document_object(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.storage_path = p_path and d.deleted_at is null and d.scan_status = 'clean'
      and app.can_access_patient(d.patient_id));
$$;

create or replace function app.can_upload_document_object(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
    where d.storage_path = p_path and d.deleted_at is null and d.scan_status = 'pending'
      and d.uploaded_by = (select auth.uid()));
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function app.write_audit(public.audit_action, text, uuid, uuid, uuid, uuid, public.audit_outcome, text, inet, text, text, jsonb) from authenticated;
