import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, '..', 'migrations');
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated, service_role;
  grant select, insert on storage.objects to authenticated;
  grant all on storage.objects, storage.buckets to service_role;
`);

const files = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
for (const f of files) {
  try { await db.exec(readFileSync(join(migDir, f), 'utf8')); console.log('applied', f); }
  catch (e) { console.error('MIGRATION FAILED', f, '\n  ', e.message); process.exit(2); }
}
await db.exec(`grant all on all tables in schema public to service_role;
               grant usage on schema app to service_role;`);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
async function as(user, sql, params = []) {
  const role = user === 'anon' ? 'anon' : user === 'service' ? 'service_role' : 'authenticated';
  await db.exec(`set role ${role}`);
  if (user !== 'anon' && user !== 'service')
    await db.exec(`select set_config('request.jwt.claim.sub','${user}',false), set_config('request.jwt.claim.role','authenticated',false)`);
  else
    await db.exec(`select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','${role}',false)`);
  try { return (await db.query(sql, params)).rows; }
  catch (e) { throw new Error(e.message); }
  finally { await db.exec('reset role'); }
}
const root = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (user, table, where = 'true') => (await as(user, `select count(*)::int n from ${table} where ${where}`))[0].n;
async function fails(promise, re, name) {
  try { await promise; ok(name, false, 'expected an error but statement succeeded'); }
  catch (e) { ok(name, re.test(e.message), `got: ${e.message}`); }
}

const U = Object.fromEntries(['hw1', 'doc1', 'doc2', 'doc3', 'adm1', 'patu', 'outsider', 'nobody', 'plat'].map(k => [k, randomUUID()]));
const F1 = randomUUID(), F2 = randomUUID(), F3 = randomUUID();
const P1 = randomUUID(), E1 = randomUUID(), CONSENT = randomUUID(), RS = randomUUID(), A1 = randomUUID();
for (const [k, id] of Object.entries(U)) await root(`insert into auth.users(id,email) values ($1,$2)`, [id, k + '@t.test']);
for (const [id, n, t] of [[F1, 'PHC One', 'phc'], [F2, 'Camp Two', 'health_camp'], [F3, 'District Hosp', 'district_hospital']])
  await root(`insert into facilities(id,name,type) values ($1,$2,$3)`, [id, n, t]);
await root(`insert into platform_admins(user_id) values ($1)`, [U.plat]);
for (const [u, f, r] of [['hw1', F1, 'health_worker'], ['doc1', F1, 'doctor'], ['adm1', F1, 'facility_admin'],
                         ['doc2', F2, 'doctor'], ['doc3', F3, 'doctor']])
  await root(`insert into memberships(user_id,facility_id,role) values ($1,$2,$3)`, [U[u], f, r]);
await root(`insert into profiles(user_id,display_name) values ($1,'Dr One')`, [U.doc1]);
await root(`insert into patients(id,registered_facility_id,user_id,full_name,created_by) values ($1,$2,$3,'Test Patient',$4)`, [P1, F1, U.patu, U.hw1]);
await root(`insert into encounters(id,patient_id,facility_id,created_by,chief_complaint_original) values ($1,$2,$3,$4,'fever 3 days')`, [E1, P1, F1, U.hw1]);
await root(`insert into symptom_entries(encounter_id,text_original) values ($1,'headache')`, [E1]);
await root(`insert into consents(id,patient_id,purpose,method,notice_version,captured_by) values ($1,$2,'referral_sharing','digital','v1',$3)`, [CONSENT, P1, U.hw1]);
await root(`insert into triage_rule_sets(id,name,version,status,source_citation,definition,approved_at) values ($1,'test-alg','1','approved','TEST ONLY','{}'::jsonb,now())`, [RS]);
await root(`insert into triage_assessments(id,encounter_id,version,rule_set_id,basis,urgency_code,note,input_fingerprint,engine_version)
            values ($1,$2,1,$3,'rules_engine','yellow','{"summary":"x"}'::jsonb,'abc','t1')`, [A1, E1, RS]);
await root(`insert into triage_signals(assessment_id,signal_code,kind,source,display_text) values ($1,'high_temp_reported','abnormal_vital','rule','temperature recorded above range')`, [A1]);
await root(`insert into queue_items(encounter_id,facility_id,urgency_code) values ($1,$2,'yellow')`, [E1, F1]);

console.log('\n-- visibility');
ok('hw1 (F1 worker) sees patient', await count(U.hw1, 'patients') === 1);
ok('doc1 (F1 doctor) sees patient', await count(U.doc1, 'patients') === 1);
ok('doc2 (other facility) sees no patient', await count(U.doc2, 'patients') === 0);
ok('outsider sees no patient', await count(U.outsider, 'patients') === 0);
ok('facility_admin sees NO patient data', await count(U.adm1, 'patients') === 0 && await count(U.adm1, 'encounters') === 0);
ok('platform admin sees NO patient data', await count(U.plat, 'patients') === 0);
ok('patient sees own record + encounter', await count(U.patu, 'patients') === 1 && await count(U.patu, 'encounters') === 1);
ok('patient cannot see triage assessments/signals', await count(U.patu, 'triage_assessments') === 0 && await count(U.patu, 'triage_signals') === 0);
ok('staff see assessment + signal + queue', await count(U.hw1, 'triage_assessments') === 1 && await count(U.hw1, 'triage_signals') === 1 && await count(U.hw1, 'queue_items') === 1);
ok('other facility sees no queue/assessment', await count(U.doc2, 'queue_items') === 0 && await count(U.doc2, 'triage_assessments') === 0);
await fails(as('anon', 'select * from patients'), /permission denied/i, 'anon has no access to patients');
await fails(as('anon', 'select * from facilities'), /permission denied/i, 'anon has no access to facilities');
ok('authenticated can read active facility directory', await count(U.outsider, 'facilities') === 3);

console.log('\n-- writes / column privileges');
await fails(as(U.hw1, `insert into patients(registered_facility_id,full_name,created_by) values ('${F2}','X','${U.hw1}')`), /row-level security/i, 'cannot register patient at a facility you do not belong to');
await fails(as(U.hw1, `insert into patients(registered_facility_id,full_name,created_by,user_id) values ('${F1}','X','${U.hw1}','${U.outsider}')`), /permission denied/i, 'client cannot set patients.user_id (column grant)');
ok('worker can register patient at own facility', (await as(U.hw1, `insert into patients(registered_facility_id,full_name,created_by) values ('${F1}','New Pt','${U.hw1}') returning id`)).length === 1);
await fails(as(U.hw1, `update profiles set credential_reset_required = true where user_id = '${U.doc1}'`), /permission denied|row-level/i, 'cannot touch profiles.credential_reset_required');
await fails(as(U.doc1, `update profiles set credential_reset_required = true where user_id = '${U.doc1}'`), /permission denied/i, 'even own profile: credential flag is not client-writable');
ok('user can update own display_name', (await as(U.doc1, `update profiles set display_name='Dr Uno' where user_id='${U.doc1}' returning 1`)).length === 1);
await fails(as(U.hw1, `insert into triage_assessments(encounter_id,version,basis,urgency_code,note,input_fingerprint,engine_version) values ('${E1}',2,'external_primary','red','{}','x','x')`), /permission denied/i, 'clients cannot write triage assessments');
await fails(as(U.hw1, `insert into queue_items(encounter_id,facility_id,urgency_code) values ('${E1}','${F1}','red')`), /permission denied|row-level|duplicate/i, 'clients cannot create queue items');
await fails(as(U.hw1, `insert into vitals(encounter_id,kind,value,unit,measured_by) values ('${E1}','temperature_c',100,'C','${U.hw1}')`), /check/i, 'vital plausibility CHECK (temp 100C rejected)');
ok('valid vital accepted', (await as(U.hw1, `insert into vitals(encounter_id,kind,value,unit,measured_by) values ('${E1}','temperature_c',38.6,'C','${U.hw1}') returning 1`)).length === 1);
await fails(as(U.doc2, `insert into vitals(encounter_id,kind,value,unit,measured_by) values ('${E1}','pulse_bpm',80,'bpm','${U.doc2}')`), /row-level/i, 'other facility cannot add vitals to my encounter');
await fails(as(U.doc1, `insert into consents(patient_id,purpose,method,notice_version,captured_by) values ('${P1}','referral_sharing','digital','v2','${U.doc1}')`), /unique|duplicate/i, 'only one active consent per patient+purpose');

console.log('\n-- review actions');
await fails(as(U.doc1, `insert into review_actions(encounter_id,reviewer_id,action,to_urgency_code) values ('${E1}','${U.doc1}','override_urgency','red')`), /check/i, 'override without reason rejected');
ok('reviewer can override with reason', (await as(U.doc1, `insert into review_actions(encounter_id,reviewer_id,action,from_urgency_code,to_urgency_code,reason) values ('${E1}','${U.doc1}','override_urgency','yellow','orange','clinical judgement: pallor noted') returning 1`)).length === 1);
await fails(as(U.hw1, `insert into review_actions(encounter_id,reviewer_id,action,reason) values ('${E1}','${U.hw1}','approve','ok')`), /row-level/i, 'health_worker is not a reviewer role');
await fails(as(U.doc1, `insert into review_actions(encounter_id,reviewer_id,action) values ('${E1}','${U.doc2}','approve')`), /row-level/i, 'cannot record an action as someone else');

console.log('\n-- append-only / immutability');
await fails(root(`update triage_assessments set urgency_code='red' where id='${A1}'`), /append-only/i, 'assessments immutable (even for superuser sessions)');
await fails(root(`delete from review_actions`), /append-only/i, 'review actions cannot be deleted');
await fails(root(`delete from audit_events`), /immutable audit/i, 'audit log cannot be deleted');
await fails(root(`update audit_events set outcome='denied'`), /immutable audit/i, 'audit log cannot be updated');

console.log('\n-- external (DXGPT) guard rails');
await fails(root(`insert into external_signal_runs(encounter_id,provider,deidentified,sent_fields,status) values ('${E1}','dxgpt',true,'{}','ok')`), /null value|consent_id/i, 'external run requires a consent_id');
const AI = randomUUID();
await root(`insert into consents(id,patient_id,purpose,method,notice_version,captured_by) values ($1,$2,'external_ai_processing','digital','v1',$3)`, [AI, P1, U.hw1]);
await fails(root(`insert into external_signal_runs(encounter_id,provider,consent_id,deidentified,sent_fields,status) values ('${E1}','dxgpt','${AI}',false,'{}','ok')`), /check/i, 'non-de-identified payload rejected by CHECK');
ok('de-identified run with consent accepted', (await root(`insert into external_signal_runs(encounter_id,provider,consent_id,deidentified,sent_fields,status) values ('${E1}','dxgpt','${AI}',true,'{"age_band":"30-39"}','ok') returning 1`)).length === 1);
ok('assessment with an approved rule set is accepted', (await root(`insert into triage_assessments(encounter_id,version,rule_set_id,basis,urgency_code,note,input_fingerprint,engine_version)
   values ('${E1}',9,'${RS}','rules_engine','green','{}','x','x') returning 1`)).length === 1);
const DRAFT_RS = randomUUID();
await root(`insert into triage_rule_sets(id,name,version,status,definition) values ($1,'draft-alg','0','draft','{}')`, [DRAFT_RS]);
await fails(root(`insert into triage_assessments(encounter_id,version,rule_set_id,basis,urgency_code,note,input_fingerprint,engine_version) values ('${E1}',10,'${DRAFT_RS}','rules_engine','green','{}','x','x')`), /not approved/i, 'assessment cannot use an unapproved rule set');

console.log('\n-- break-glass');
await fails(as(U.doc2, `insert into break_glass_grants(user_id,patient_id,facility_id,reason) values ('${U.doc2}','${P1}','${F2}','short')`), /check/i, 'break-glass requires a real reason');
ok('doc2 cannot see P1 before break-glass', await count(U.doc2, 'patients') === 0);
await as(U.doc2, `insert into break_glass_grants(user_id,patient_id,facility_id,reason) values ('${U.doc2}','${P1}','${F2}','unconscious patient, no ID, emergency')`);
ok('doc2 sees P1 + encounter after break-glass', await count(U.doc2, 'patients') === 1 && await count(U.doc2, 'encounters') === 1);
ok('break-glass automatically audited', (await root(`select count(*)::int n from audit_events where action='break_glass' and actor_user_id='${U.doc2}'`))[0].n === 1);
ok('break-glass scoped to that patient only', await count(U.doc2, 'patients', `id <> '${P1}'`) === 0);

console.log('\n-- referral workflow');
const R1 = randomUUID();
await as(U.doc1, `insert into referrals(id,encounter_id,patient_id,from_facility_id,to_facility_id,requested_by,priority,reason_text) values ('${R1}','${E1}','${P1}','${F1}','${F3}','${U.doc1}','urgent','needs higher-level assessment')`);
ok('draft referral invisible to receiving facility', await count(U.doc3, 'referrals') === 0);
await fails(as(U.doc1, `update referrals set status='requested' where id='${R1}'`), /check|bundle/i, 'cannot send a referral without a bundle snapshot');
await as(U.doc1, `update referrals set status='requested', bundle='{"resourceType":"Bundle"}'::jsonb, bundle_sha256=decode(repeat('ab',32),'hex') where id='${R1}'`);
ok('sent referral visible to receiving doctor', await count(U.doc3, 'referrals') === 1);
ok('receiving doctor can now read the referred encounter', await count(U.doc3, 'encounters') === 1);
ok('receiving doctor can read the patient', await count(U.doc3, 'patients') === 1);
await fails(as(U.doc1, `update referrals set status='accepted' where id='${R1}'`), /only the receiving facility/i, 'sender cannot accept its own referral');
await fails(as(U.doc1, `update referrals set bundle='{"x":1}'::jsonb where id='${R1}'`), /immutable/i, 'bundle frozen after request');
await fails(as(U.doc3, `update referrals set status='completed' where id='${R1}'`), /illegal referral transition/i, 'illegal state jump rejected');
await as(U.doc3, `update referrals set status='accepted' where id='${R1}'`);
ok('receiver accepted', (await root(`select status from referrals where id='${R1}'`))[0].status === 'accepted');
ok('referral events logged automatically', (await root(`select count(*)::int n from referral_events where referral_id='${R1}'`))[0].n === 3);
ok('other facility (F2, no break-glass on referral) cannot see referral', await count(U.doc2, 'referrals') === 0);

console.log('\n-- admin separation');
await fails(as(U.adm1, `insert into memberships(user_id,facility_id,role) values ('${U.outsider}','${F1}','facility_admin')`), /row-level/i, 'facility_admin cannot mint another facility_admin');
ok('facility_admin can add a doctor to own facility', (await as(U.adm1, `insert into memberships(user_id,facility_id,role) values ('${U.outsider}','${F1}','nurse') returning 1`)).length === 1);
await fails(as(U.adm1, `insert into memberships(user_id,facility_id,role) values ('${U.outsider}','${F2}','nurse')`), /row-level/i, 'facility_admin limited to own facility');
ok('facility_admin sees audit rows for own facility (no PHI values)', await count(U.adm1, 'audit_events') > 0);
ok('non-admin clinician sees no audit rows', await count(U.hw1, 'audit_events') === 0);
ok('patient can see audit rows about their own record', await count(U.patu, 'audit_events') > 0);
await fails(as(U.hw1, `select app.write_audit('read','patients')`), /permission denied/i, 'clients cannot forge audit events');
ok('service role can write audit events', (await as('service', `select app.write_audit('read','patients','${P1}','${P1}','${F1}','${U.hw1}') as id`)).length === 1);

console.log('\n-- documents / storage');
const D1 = randomUUID(), path = `${F1}/${P1}/${D1}.pdf`;
await fails(as(U.hw1, `insert into documents(id,patient_id,facility_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('${D1}','${P1}','${F1}','lab_report','../../etc/passwd','application/pdf',100,'${U.hw1}')`), /check/i, 'path traversal impossible: storage_path format CHECK');
await fails(as(U.hw1, `insert into documents(id,patient_id,facility_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('${D1}','${P1}','${F1}','lab_report','${path}','text/html',100,'${U.hw1}')`), /check/i, 'only pdf/jpeg/png accepted');
await fails(as(U.hw1, `insert into documents(id,patient_id,facility_id,kind,storage_path,mime_type,size_bytes,uploaded_by,scan_status) values ('${D1}','${P1}','${F1}','lab_report','${path}','application/pdf',100,'${U.hw1}','clean')`), /permission denied/i, 'client cannot self-declare scan_status');
await as(U.hw1, `insert into documents(id,patient_id,facility_id,kind,storage_path,mime_type,size_bytes,uploaded_by) values ('${D1}','${P1}','${F1}','lab_report','${path}','application/pdf',100,'${U.hw1}')`);
ok('uploader may upload object for the pending document row', (await as(U.hw1, `insert into storage.objects(bucket_id,name) values ('patient-documents','${path}') returning 1`)).length === 1);
await fails(as(U.doc1, `insert into storage.objects(bucket_id,name) values ('patient-documents','${path}')`), /row-level/i, 'someone else cannot upload to that path');
await fails(as(U.hw1, `insert into storage.objects(bucket_id,name) values ('patient-documents','${F1}/${P1}/${randomUUID()}.pdf')`), /row-level/i, 'cannot upload without a pending documents row');
ok('pending (unscanned) file is NOT readable', await count(U.hw1, 'storage.objects', `name='${path}'`) === 0);
await root(`update documents set scan_status='clean' where id='${D1}'`);
ok('clean file readable by authorised clinician', await count(U.hw1, 'storage.objects', `name='${path}'`) === 1);
ok('clean file readable by the patient', await count(U.patu, 'storage.objects', `name='${path}'`) === 1);
ok('clean file NOT readable by unrelated user (no membership)', await count(U.nobody,'storage.objects', `name='${path}'`) === 0);
await root(`update documents set scan_status='infected' where id='${D1}'`);
ok('infected file no longer readable', await count(U.hw1, 'storage.objects', `name='${path}'`) === 0);
await root(`update documents set scan_status='clean' where id='${D1}'`);

console.log('\n-- erasure & audit chain');
ok('audit chain verifies before erasure', (await root(`select * from app.verify_audit_chain()`)).length === 0);
const ER = randomUUID();
await as(U.patu, `insert into erasure_requests(id,patient_id,requested_via) values ('${ER}','${P1}','self')`);
await fails(as(U.hw1, `select app.erase_patient('${ER}','${U.hw1}')`), /permission denied/i, 'clients cannot run erasure');
const paths = (await as('service', `select app.erase_patient('${ER}','${U.doc1}') as p`))[0].p;
ok('erasure returns storage paths to delete', Array.isArray(paths) && paths.includes(path));
const pt = (await root(`select full_name, phone, deleted_at from patients where id='${P1}'`))[0];
ok('patient PII scrubbed + soft-deleted', pt.full_name === '[erased]' && pt.phone === null && pt.deleted_at !== null);
ok('symptom text scrubbed', (await root(`select count(*)::int n from symptom_entries where text_original <> '[erased]'`))[0].n === 0);
ok('assessment note scrubbed, row retained', (await root(`select note from triage_assessments where id='${A1}'`))[0].note.erased === true);
ok('erased referral keeps its row, loses its bundle', (await root(`select bundle is null as nb, erased_at is not null as ea from referrals where id='${R1}'`))[0].nb === true);
ok('request marked completed', (await root(`select status from erasure_requests where id='${ER}'`))[0].status === 'completed');
await fails(as('service', `select app.erase_patient('${ER}','${U.doc1}')`), /not pending/i, 'erasure not repeatable');
ok('erased patient no longer visible to staff', await count(U.hw1, 'patients', `id='${P1}'`) === 0);
ok('audit chain STILL verifies after erasure', (await root(`select * from app.verify_audit_chain()`)).length === 0);

await root(`alter table audit_events disable trigger trg_audit_immutable`);
const victim = (await root(`select id from audit_events order by id limit 1 offset 2`))[0].id;
await root(`update audit_events set outcome='denied' where id=${victim}`);
await root(`alter table audit_events enable trigger trg_audit_immutable`);
const broken = await root(`select broken_id from app.verify_audit_chain()`);
ok('tampering with an audit row is detected', broken.length >= 1 && Number(broken[0].broken_id) === Number(victim));

console.log('\n-- structural');
const colPriv = async (t, c, p) => (await root(`select has_column_privilege('authenticated','public.${t}','${c}','${p}') as v`))[0].v;
ok('authenticated CANNOT insert documents.scan_status', !(await colPriv('documents', 'scan_status', 'INSERT')));
ok('authenticated CANNOT update documents.scan_status', !(await colPriv('documents', 'scan_status', 'UPDATE')));
ok('authenticated CANNOT insert/update patients.user_id', !(await colPriv('patients', 'user_id', 'INSERT')) && !(await colPriv('patients', 'user_id', 'UPDATE')));
ok('authenticated CANNOT update patients.registered_facility_id', !(await colPriv('patients', 'registered_facility_id', 'UPDATE')));
ok('authenticated CANNOT update profiles.credential_reset_required', !(await colPriv('profiles', 'credential_reset_required', 'UPDATE')));
ok('authenticated CANNOT update referrals.requested_by/from_facility_id', !(await colPriv('referrals', 'requested_by', 'UPDATE')) && !(await colPriv('referrals', 'from_facility_id', 'UPDATE')));
ok('authenticated CAN supply documents.id (needed for path)', await colPriv('documents', 'id', 'INSERT'));
const delGrants = await root(`select table_name from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and privilege_type='DELETE' order by 1`);
ok('DELETE granted to authenticated only on memberships, facility_capabilities, patient_identifiers, referral_documents',
   JSON.stringify(delGrants.map(r => r.table_name)) === JSON.stringify(['facility_capabilities', 'memberships', 'patient_identifiers', 'referral_documents']), JSON.stringify(delGrants));
await root(`create table public.zz_future_table (id int)`);
ok('a NEW public table automatically gets RLS enabled', (await root(`select rowsecurity from pg_tables where tablename='zz_future_table'`))[0].rowsecurity === true);
await fails(as(U.hw1, `select * from zz_future_table`), /permission denied/i, 'a NEW public table is not readable by authenticated until granted');
await root(`drop table public.zz_future_table`);
const noRls = await root(`select tablename from pg_tables where schemaname='public' and not rowsecurity`);
ok('every public table has RLS enabled', noRls.length === 0, JSON.stringify(noRls));
const anonGrants = await root(`select count(*)::int n from information_schema.role_table_grants where grantee='anon' and table_schema='public'`);
ok('anon holds no table grants', anonGrants[0].n === 0);
const anonFns = await root(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') and p.prorettype = 'event_trigger'::regtype)`);
ok('no app.* function is executable by anon, and event-trigger functions by nobody but owner', anonFns.length === 0, anonFns.map(r => r.proname).join(','));
const noPolicy = await root(`select t.tablename from pg_tables t where t.schemaname='public'
   and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tablename)`);
console.log('INFO  tables with RLS but no policy (service_role only):', noPolicy.map(r => r.tablename).join(', '));
ok('service-only tables are exactly the intended ones',
   JSON.stringify(noPolicy.map(r => r.tablename).sort()) === JSON.stringify(['health_card_tokens', 'legacy_id_map', 'platform_admins']));
const secdef = await root(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='app' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`);
ok('every SECURITY DEFINER function pins search_path', secdef.length === 0, JSON.stringify(secdef));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
