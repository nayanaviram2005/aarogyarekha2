create or replace function app.set_member_role(p_actor uuid, p_facility uuid, p_user uuid, p_role public.app_role)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plat   boolean := exists (select 1 from public.platform_admins where user_id = p_actor);
  v_fadmin boolean := exists (select 1 from public.memberships where user_id = p_actor and facility_id = p_facility and role = 'facility_admin' and is_active);
  v_target_admin boolean := exists (select 1 from public.memberships where user_id = p_user and facility_id = p_facility and role = 'facility_admin' and is_active);
  v_id uuid; v_prev text;
begin
  if not (v_plat or v_fadmin) then raise exception 'not an administrator of this facility' using errcode = '42501'; end if;
  if not exists (select 1 from public.facilities where id = p_facility) then raise exception 'no such facility' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then raise exception 'that person has no account yet' using errcode = 'P0002'; end if;
  if p_user = p_actor and not v_plat then raise exception 'you cannot change your own role' using errcode = '42501'; end if;
  if not v_plat and (p_role = 'facility_admin' or v_target_admin) then raise exception 'only a platform administrator can create or change facility administrators' using errcode = '42501'; end if;

  select string_agg(role::text, ',') into v_prev from public.memberships where user_id = p_user and facility_id = p_facility and is_active;
  if p_role <> 'facility_admin' then
    update public.memberships set is_active = false where user_id = p_user and facility_id = p_facility and role <> p_role and role <> 'facility_admin' and is_active;
  end if;
  insert into public.memberships (user_id, facility_id, role, is_active) values (p_user, p_facility, p_role, true)
    on conflict (user_id, facility_id, role) do update set is_active = true
    returning id into v_id;
  perform app.write_audit('update', 'membership', v_id, null, p_facility, p_actor, 'success', null, null, 'member-roles', null,
                          jsonb_build_object('op', 'set_role', 'role', p_role, 'target', p_user, 'previous', coalesce(v_prev, 'none')));
  return jsonb_build_object('membershipId', v_id, 'role', p_role, 'previous', coalesce(v_prev, 'none'));
end $$;

create or replace function app.deactivate_member(p_actor uuid, p_facility uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plat   boolean := exists (select 1 from public.platform_admins where user_id = p_actor);
  v_fadmin boolean := exists (select 1 from public.memberships where user_id = p_actor and facility_id = p_facility and role = 'facility_admin' and is_active);
  v_target_admin boolean := exists (select 1 from public.memberships where user_id = p_user and facility_id = p_facility and role = 'facility_admin' and is_active);
  v_n int; v_prev text;
begin
  if not (v_plat or v_fadmin) then raise exception 'not an administrator of this facility' using errcode = '42501'; end if;
  if p_user = p_actor and not v_plat then raise exception 'you cannot remove yourself' using errcode = '42501'; end if;
  if v_target_admin and not v_plat then raise exception 'only a platform administrator can remove a facility administrator' using errcode = '42501'; end if;
  select string_agg(role::text, ',') into v_prev from public.memberships where user_id = p_user and facility_id = p_facility and is_active;
  update public.memberships set is_active = false where user_id = p_user and facility_id = p_facility and is_active;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'that person has no active role here' using errcode = 'P0002'; end if;
  perform app.write_audit('update', 'membership', null, null, p_facility, p_actor, 'success', null, null, 'member-roles', null,
                          jsonb_build_object('op', 'deactivate', 'target', p_user, 'previous', v_prev));
  return jsonb_build_object('deactivated', v_n, 'previous', v_prev);
end $$;

revoke all on function app.set_member_role(uuid, uuid, uuid, public.app_role) from public, anon, authenticated;
grant execute on function app.set_member_role(uuid, uuid, uuid, public.app_role) to service_role;
revoke all on function app.deactivate_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.deactivate_member(uuid, uuid, uuid) to service_role;
