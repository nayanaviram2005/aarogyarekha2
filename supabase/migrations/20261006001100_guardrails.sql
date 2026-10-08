-- 0011 guardrails for FUTURE migrations.
-- 1. Any table created in `public` gets RLS enabled automatically (default-deny until a policy is written).
-- 2. New public tables/sequences are not auto-granted to anon/authenticated; functions are not PUBLIC-executable.
-- NOTE: ALTER DEFAULT PRIVILEGES affects objects created by the role running this migration. On Supabase,
-- also review default privileges of `supabase_admin` in the dashboard/SQL editor (cannot be changed from here).

create or replace function app.rls_auto_enable()
returns event_trigger language plpgsql security definer set search_path = '' as $$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', cmd.object_identity);
  end loop;
end $$;

create event trigger rls_auto_enable on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function app.rls_auto_enable();

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
