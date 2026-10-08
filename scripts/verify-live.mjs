// Read-only verification of the hosted project against the security properties the schema promises.
// Usage: node --env-file=.env scripts/verify-live.mjs
import pg from 'pg';

const url = process.env.DATABASE_URL_POOLER?.replace(':6543/', ':5432/') || process.env.DATABASE_URL_DIRECT;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`);
  if (!ok) failed++;
};
const q = async (sql, params) => (await c.query(sql, params)).rows;

try {
  const tables = await q(`select c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
                          where n.nspname='public' and c.relkind in ('r','p') order by 1`);
  check(tables.length === 37, 'public tables created', `${tables.length} tables`);
  const noRls = tables.filter(t => !t.rls).map(t => t.relname);
  check(noRls.length === 0, 'every public table has RLS enabled', noRls.join(', '));

  const anon = await q(`select table_name, privilege_type from information_schema.role_table_grants
                        where table_schema='public' and grantee='anon'`);
  check(anon.length === 0, 'anon holds no table grants', `${anon.length} grants`);

  const sd = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname in ('public','app') and p.prosecdef
                        and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) s where s like 'search_path=%')`);
  check(sd.length === 0, 'every SECURITY DEFINER function pins search_path', sd.map(r => r.proname).join(', '));

  const pub = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon_x
                       from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app'`);
  const anonFns = pub.filter(r => r.anon_x).map(r => r.proname);
  check(anonFns.length === 0, 'anon cannot execute any app.* function', anonFns.join(', '));

  const rr = await q(`select has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'record_review'`);
  check(rr.length === 1, 'app.record_review exists (migration 0013 applied)');
  check(rr.length === 1 && !rr[0].auth_x && !rr[0].anon_x && rr[0].svc_x, 'only the service role can execute app.record_review');

  const sr = await q(`select has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'send_referral'`);
  check(sr.length === 1, 'app.send_referral exists (migration 0014 applied)');
  check(sr.length === 1 && !sr[0].auth_x && !sr[0].anon_x && sr[0].svc_x, 'only the service role can execute app.send_referral');

  for (const fn of ['set_member_role', 'deactivate_member']) {
    const m = await q(`select has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = '${fn}'`);
    check(m.length === 1, `app.${fn} exists (migration 0016 applied)`);
    check(m.length === 1 && !m[0].auth_x && !m[0].anon_x && m[0].svc_x, `only the service role can execute app.${fn}`);
  }
  for (const fn of ['call_in', 'complete_visit']) {
    const m = await q(`select has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = '${fn}'`);
    check(m.length === 1, `app.${fn} exists (migration 0018 applied)`);
    check(m.length === 1 && !m[0].auth_x && !m[0].anon_x && m[0].svc_x, `only the service role can execute app.${fn}`);
  }
  const sms = await q(`select has_function_privilege('authenticated', p.oid, 'execute') auth_x, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('service_role', p.oid, 'execute') svc_x
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'revoke_sms_consents'`);
  check(sms.length === 1, 'app.revoke_sms_consents exists (migration 0019 applied)');
  check(sms.length === 1 && !sms[0].auth_x && !sms[0].anon_x && sms[0].svc_x, 'only the service role can execute app.revoke_sms_consents');
  const smsCols = await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'sms_log' and column_name in ('phone', 'body', 'text', 'message')`);
  check(smsCols.length === 0, 'sms_log holds no phone number and no message text');
  const sc = await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'extracted_fields' and column_name in ('second_read', 'agreement')`);
  check(sc.length === 2, 'extracted_fields has the second-read columns (migration 0017 applied)');

  const bucket = await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='patient-documents'`);
  check(bucket.length === 1 && bucket[0].public === false, 'storage bucket patient-documents exists and is private');
  check(Number(bucket[0]?.file_size_limit) === 20971520, 'bucket size limit is 20 MB');

  const pol = await q(`select policyname from pg_policies where schemaname='storage' and tablename='objects'
                       and policyname in ('patient_docs_read','patient_docs_upload')`);
  check(pol.length === 2, 'storage policies present', pol.map(p => p.policyname).join(', '));

  const ev = (await q(`select evtname from pg_event_trigger`)).map(r => r.evtname);
  check(ev.includes('rls_auto_enable') && ev.includes('ensure_rls'), 'auto-RLS event triggers present', ev.join(', '));

  const rt = await q(`select tablename from pg_publication_tables where pubname='supabase_realtime'`);
  check(rt.some(r => r.tablename === 'queue_items'), 'realtime publishes queue_items', rt.map(r => r.tablename).join(', '));

  const serviceOnly = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                               where n.nspname='public' and c.relrowsecurity
                                 and not exists (select 1 from pg_policy p where p.polrelid=c.oid) order by 1`);
  const names = serviceOnly.map(r => r.relname).sort().join(',');
  check(names === 'health_card_tokens,legacy_id_map,platform_admins',
        'tables with RLS but no policy are exactly the service-only set', names);

  const appExposed = await q(`select 1 from pg_namespace where nspname='app' and has_schema_privilege('anon','app','usage')`);
  check(appExposed.length === 0, 'app schema not usable by anon');

  const chain = await q(`select count(*)::int n from public.audit_events`);
  console.log(`INFO  audit_events rows: ${chain[0].n}`);
  const seed = await q(`select code from public.urgency_levels order by rank`).catch(() => []);
  console.log(`INFO  urgency levels: ${seed.map(r => r.code).join(', ') || '(none)'}`);
} finally { await c.end(); }
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll live checks passed');
process.exitCode = failed ? 1 : 0;
