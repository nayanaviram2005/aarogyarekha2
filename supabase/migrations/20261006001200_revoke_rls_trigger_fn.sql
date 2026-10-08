-- 0012 Close a gap found by running the checks against the hosted project.
-- 0011 revoked default EXECUTE for future functions, but app.rls_auto_enable() was created in the same
-- file BEFORE that revoke, so it kept PostgreSQL's default PUBLIC execute. It is an event-trigger function
-- (cannot be called directly), so this was not exploitable, but the stated rule is "no PUBLIC-executable
-- functions". Event triggers fire as the trigger owner; no role needs EXECUTE for them to run.
revoke execute on function app.rls_auto_enable() from public, anon, authenticated, service_role;
