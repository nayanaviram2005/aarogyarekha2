-- 0006 audit log (append-only, hash-chained) + legacy id map.
--
-- IMPORTANT LIMITATION: Postgres cannot audit SELECTs. DB triggers below capture writes and
-- security-relevant events (grants, break-glass, referral transitions, reviews). PHI *reads* must be
-- recorded by the API tier through app.write_audit(), which only service_role may call.
-- `details` must never contain PHI: store field NAMES and ids, not values.

create table public.audit_events (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid,
  actor_role    text,
  facility_id   uuid,
  action        public.audit_action not null,
  entity_type   text not null,
  entity_id     uuid,
  patient_id    uuid,              -- no FK on purpose: must survive erasure
  outcome       public.audit_outcome not null default 'success',
  request_id    text,
  ip            inet,
  user_agent    text,
  reason        text,
  details       jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  prev_hash     bytea,
  row_hash      bytea not null
);
create index audit_events_patient_idx on public.audit_events (patient_id, occurred_at desc) where patient_id is not null;
create index audit_events_facility_idx on public.audit_events (facility_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_user_id, occurred_at desc);

-- Chain: row_hash = sha256(prev_hash || canonical(row)). One global chain, serialised by an advisory
-- lock. [Trade-off: single writer. If audit volume demands it, chain per day/facility instead.]
create or replace function app.audit_chain()
returns trigger language plpgsql security definer set search_path = '' as $$
declare prev bytea;
begin
  perform pg_advisory_xact_lock(727001);
  select e.row_hash into prev from public.audit_events e order by e.id desc limit 1;
  new.prev_hash := prev;
  new.row_hash := sha256(coalesce(prev, '\x'::bytea) || convert_to(concat_ws('|',
      new.id, extract(epoch from new.occurred_at)::text, new.actor_user_id, new.actor_role, new.facility_id,
      new.action, new.entity_type, new.entity_id, new.patient_id, new.outcome, new.request_id,
      host(new.ip), new.user_agent, new.reason, new.details::text), 'UTF8'));
  return new;
end $$;
create trigger trg_audit_chain before insert on public.audit_events
  for each row execute function app.audit_chain();
create trigger trg_audit_immutable before update or delete on public.audit_events
  for each row execute function app.forbid_mutation_strict();

-- Returns the ids of rows whose hash or linkage does not verify (empty set = chain intact).
create or replace function app.verify_audit_chain(p_from bigint default 0)
returns table (broken_id bigint) language plpgsql stable security definer set search_path = '' as $$
declare r record; prev bytea := null; first_row boolean := true; expect bytea;
begin
  for r in select * from public.audit_events where id >= p_from order by id loop
    if first_row and p_from > 0 then
      prev := r.prev_hash;            -- trust the anchor row's link when starting mid-chain
    end if;
    first_row := false;
    expect := sha256(coalesce(prev, '\x'::bytea) || convert_to(concat_ws('|',
      r.id, extract(epoch from r.occurred_at)::text, r.actor_user_id, r.actor_role, r.facility_id,
      r.action, r.entity_type, r.entity_id, r.patient_id, r.outcome, r.request_id,
      host(r.ip), r.user_agent, r.reason, r.details::text), 'UTF8'));
    if r.prev_hash is distinct from prev or r.row_hash <> expect then
      broken_id := r.id; return next;
    end if;
    prev := r.row_hash;
  end loop;
end $$;

-- API-tier entry point (e.g. PHI reads, login events). service_role only.
create or replace function app.write_audit(
  p_action public.audit_action, p_entity_type text, p_entity_id uuid default null,
  p_patient_id uuid default null, p_facility_id uuid default null, p_actor uuid default null,
  p_outcome public.audit_outcome default 'success', p_request_id text default null,
  p_ip inet default null, p_user_agent text default null, p_reason text default null,
  p_details jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_id bigint;
begin
  insert into public.audit_events (actor_user_id, actor_role, facility_id, action, entity_type, entity_id,
                                   patient_id, outcome, request_id, ip, user_agent, reason, details)
  values (coalesce(p_actor, auth.uid()), auth.role(), p_facility_id, p_action, p_entity_type, p_entity_id,
          p_patient_id, p_outcome, p_request_id, p_ip, p_user_agent, p_reason, coalesce(p_details, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function app.write_audit(public.audit_action, text, uuid, uuid, uuid, uuid, public.audit_outcome, text, inet, text, text, jsonb) from public, authenticated, anon;
grant execute on function app.write_audit(public.audit_action, text, uuid, uuid, uuid, uuid, public.audit_outcome, text, inet, text, text, jsonb) to service_role;

-- Generic DB-side change audit: records WHICH columns changed, never their values.
create or replace function app.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  j_new jsonb := to_jsonb(new);
  j_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  changed text[];
  v_patient uuid;
  v_action public.audit_action;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into changed
    from jsonb_each(j_new) n join jsonb_each(j_old) o using (key)
    where n.value is distinct from o.value;
    if changed = '{}' then return null; end if;
  end if;

  v_patient := coalesce((j_new ->> 'patient_id'),
                        case when tg_table_name = 'patients' then j_new ->> 'id' end)::uuid;
  v_action := case
    when tg_table_name = 'break_glass_grants' then 'break_glass'
    when tg_table_name in ('consents', 'access_grants') then 'consent_change'
    when tg_table_name = 'erasure_requests' then 'erasure'
    when tg_op = 'INSERT' then 'create' else 'update' end;

  insert into public.audit_events (actor_user_id, actor_role, facility_id, action, entity_type, entity_id,
                                   patient_id, reason, details)
  values (auth.uid(), auth.role(),
          coalesce((j_new ->> 'facility_id'), (j_new ->> 'registered_facility_id'), (j_new ->> 'from_facility_id'))::uuid,
          v_action, tg_table_name, (j_new ->> 'id')::uuid, v_patient, j_new ->> 'reason',
          jsonb_build_object('op', tg_op, 'changed_columns', to_jsonb(changed)));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients', 'documents', 'encounters', 'consents', 'access_grants',
                           'break_glass_grants', 'memberships', 'review_actions', 'referrals', 'erasure_requests']
  loop
    execute format('create trigger trg_audit_%1$s after insert or update on public.%1$I
                    for each row execute function app.audit_row_change()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- legacy MongoDB -> Supabase id map
-- Temporary migration aid: lets the loader be idempotent and lets us verify patient<->record
-- associations. Drop (or archive) after cutover verification.
create table public.legacy_id_map (
  legacy_collection text not null,                   -- 'users' | 'records' | 'healthrecords' | 'gridfs'
  legacy_id         text not null,                   -- Mongo ObjectId hex
  new_table         text not null,
  new_id            uuid not null,
  migrated_at       timestamptz not null default now(),
  primary key (legacy_collection, legacy_id)
);
create index legacy_id_map_new_idx on public.legacy_id_map (new_table, new_id);
