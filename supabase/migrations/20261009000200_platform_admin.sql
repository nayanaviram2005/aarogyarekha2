create or replace function app.platform_create_facility(p_actor uuid, p_name text, p_type text, p_state text, p_district text, p_pincode text, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor) then raise exception 'only a platform administrator can create a facility' using errcode = '42501'; end if;
  if p_name is null or length(btrim(p_name)) = 0 then raise exception 'the facility needs a name' using errcode = '22023'; end if;
  insert into public.facilities (name, type, state, district, pincode, code)
  values (btrim(p_name), p_type::public.facility_type, nullif(btrim(coalesce(p_state, '')), ''), nullif(btrim(coalesce(p_district, '')), ''), nullif(btrim(coalesce(p_pincode, '')), ''), nullif(btrim(coalesce(p_code, '')), ''))
  returning id into v_id;
  perform app.write_audit('create', 'facility', v_id, null, v_id, p_actor, 'success', null, null, 'platform-admin', null, jsonb_build_object('op', 'create_facility', 'type', p_type));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function app.platform_set_facility_active(p_actor uuid, p_facility uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor) then raise exception 'only a platform administrator can do this' using errcode = '42501'; end if;
  update public.facilities set is_active = p_active where id = p_facility;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no such facility' using errcode = 'P0002'; end if;
  perform app.write_audit('update', 'facility', p_facility, null, p_facility, p_actor, 'success', null, null, 'platform-admin', null, jsonb_build_object('op', case when p_active then 'activate_facility' else 'deactivate_facility' end));
  return jsonb_build_object('id', p_facility, 'active', p_active);
end $$;

revoke all on function app.platform_create_facility(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function app.platform_create_facility(uuid, text, text, text, text, text, text) to service_role;
revoke all on function app.platform_set_facility_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function app.platform_set_facility_active(uuid, uuid, boolean) to service_role;
