import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const apply = process.argv.includes('--apply');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const dbUrl = process.env.DATABASE_URL_POOLER?.replace(':6543/', ':5432/') || process.env.DATABASE_URL_DIRECT;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !dbUrl) { console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or a database URL in .env'); process.exit(1); }

const DOMAIN = 'seed.aarogyarekha.test';
const FACILITIES = [
  { key: 'A', code: 'SEED-PHC-01', name: 'Seed PHC Khordha', type: 'phc', state: 'Odisha', district: 'Khordha', pincode: '752001', caps: [] },
  { key: 'B', code: 'SEED-DH-01', name: 'Seed District Hospital Bhubaneswar', type: 'district_hospital', state: 'Odisha', district: 'Khordha', pincode: '751001', caps: ['general_medicine', 'paediatrics', 'obstetrics', 'emergency'] },
];
const USERS = [
  { key: 'hw_a',     name: 'Health Worker A',         facility: 'A', role: 'health_worker' },
  { key: 'nurse_a',  name: 'Nurse A',                 facility: 'A', role: 'nurse' },
  { key: 'doctor_a', name: 'Doctor A',                facility: 'A', role: 'doctor' },
  { key: 'doctor_b', name: 'Doctor B',                facility: 'B', role: 'doctor' },
  { key: 'admin_a',  name: 'Facility Admin A',        facility: 'A', role: 'facility_admin' },
  { key: 'platform', name: 'Platform Admin',          platform: true },
  { key: 'outsider', name: 'Outsider (no membership)' },
];
const PATIENTS = [
  { mrn: 'SEED-MRN-A-001', name: 'Seed Patient 01', facility: 'A', sex: 'female', age: 34, lang: 'or', scenario: 'opd_queue',
    complaint: 'ଜ୍ୱର ତିନି ଦିନ ଧରି, କାଶ ମଧ୍ୟ ଅଛି', translated: 'Fever for three days, also has cough',
    symptoms: [['Fever', 3, 'days', 6], ['Cough', 2, 'days', 4]], vitals: [['temperature_c', 38.6, 'Cel'], ['pulse_bpm', 104, '/min'], ['spo2_pct', 96, '%']] },
  { mrn: 'SEED-MRN-A-002', name: 'Seed Patient 02', facility: 'A', sex: 'male', age: 8, lang: 'hi', scenario: 'campus_fever',
    complaint: 'तीन दिन से बुखार और सिरदर्द', translated: 'Fever and headache for three days',
    symptoms: [['Fever', 3, 'days', 7], ['Headache', 3, 'days', 5]], vitals: [['temperature_c', 39.2, 'Cel'], ['weight_kg', 24, 'kg']] },
  { mrn: 'SEED-MRN-A-003', name: 'Seed Patient 03', facility: 'A', sex: 'female', age: 27, lang: 'en', scenario: 'maternal_followup',
    complaint: 'Headache and swelling of feet, 34 weeks pregnant', translated: null,
    symptoms: [['Headache', 2, 'days', 5], ['Swelling of both feet', 4, 'days', 4]], vitals: [['bp_systolic_mmhg', 148, 'mm[Hg]'], ['bp_diastolic_mmhg', 96, 'mm[Hg]']] },
  { mrn: 'SEED-MRN-A-004', name: 'Seed Patient 04', facility: 'A', sex: 'male', age: 58, lang: 'en', scenario: 'chronic_checkin',
    complaint: 'Routine check-in, feeling tired for two weeks', translated: null,
    symptoms: [['Tiredness', 2, 'weeks', 3]], vitals: [['blood_glucose_mgdl', 212, 'mg/dL'], ['bp_systolic_mmhg', 136, 'mm[Hg]'], ['bp_diastolic_mmhg', 86, 'mm[Hg]']] },
  { mrn: 'SEED-MRN-B-001', name: 'Seed Patient 05', facility: 'B', sex: 'female', age: 45, lang: 'en', scenario: 'opd_queue',
    complaint: 'Abdominal pain since yesterday', translated: null,
    symptoms: [['Abdominal pain', 1, 'days', 6]], vitals: [['pulse_bpm', 92, '/min']] },
];

const rand = () => randomBytes(15).toString('base64url') + 'aA1!';
const adminFetch = async (path, init = {}) => {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init, headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...init.headers },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
};

console.log(apply ? 'APPLYING seed data' : 'DRY RUN (no changes). Re-run with --apply to create the data below.');
console.log(`  facilities : ${FACILITIES.map(f => f.code).join(', ')}`);
console.log(`  users      : ${USERS.map(u => `${u.key}@${DOMAIN}`).join(', ')}`);
console.log(`  patients   : ${PATIENTS.length} (synthetic) with encounters, symptoms, vitals and care_triage consent`);
if (!apply) process.exit(0);

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
const creds = {};
try {
  const ids = {};
  const existing = (await adminFetch('/users?page=1&per_page=1000')).body.users ?? [];
  for (const u of USERS) {
    const email = `${u.key}@${DOMAIN}`; const password = rand();
    const found = existing.find(x => x.email === email);
    if (found) {
      const r = await adminFetch(`/users/${found.id}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) });
      if (r.status >= 300) throw new Error(`could not reset password for ${email}: ${r.status}`);
      ids[u.key] = found.id;
    } else {
      const r = await adminFetch('/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { seed: true } }) });
      if (r.status >= 300 || !r.body.id) throw new Error(`could not create ${email}: ${r.status} ${r.body.msg ?? r.body.error_code ?? ''}`);
      ids[u.key] = r.body.id;
    }
    creds[email] = { password, role: u.role ?? (u.platform ? 'platform_admin' : 'none'), facility: u.facility ?? null };
  }

  await c.query('begin');
  const fac = {};
  for (const f of FACILITIES) {
    const r = await c.query(
      `insert into public.facilities (code, name, type, state, district, pincode) values ($1,$2,$3,$4,$5,$6)
       on conflict (code) do update set name = excluded.name returning id`, [f.code, f.name, f.type, f.state, f.district, f.pincode]);
    fac[f.key] = r.rows[0].id;
    for (const cap of f.caps) await c.query('insert into public.facility_capabilities (facility_id, capability) values ($1,$2) on conflict do nothing', [fac[f.key], cap]);
  }
  for (const u of USERS) {
    await c.query(`insert into public.profiles (user_id, display_name) values ($1,$2) on conflict (user_id) do update set display_name = excluded.display_name`, [ids[u.key], u.name]);
    if (u.role) await c.query('insert into public.memberships (user_id, facility_id, role) values ($1,$2,$3) on conflict (user_id, facility_id, role) do update set is_active = true', [ids[u.key], fac[u.facility], u.role]);
    if (u.platform) await c.query('insert into public.platform_admins (user_id) values ($1) on conflict do nothing', [ids[u.key]]);
  }
  let created = 0;
  for (const p of PATIENTS) {
    const had = await c.query(`select patient_id from public.patient_identifiers where system = 'facility_mrn' and value = $1`, [p.mrn]);
    if (had.rowCount) continue;
    created++;
    const phone = `+9190000${String(10000 + created).slice(-5)}`;
    const pr = await c.query(
      `insert into public.patients (registered_facility_id, full_name, preferred_language, sex, age_years_reported, phone, district, state, created_by)
       values ($1,$2,$3,$4,$5,$6,'Khordha','Odisha',$7) returning id`,
      [fac[p.facility], p.name, p.lang, p.sex, p.age, phone, ids[p.facility === 'A' ? 'hw_a' : 'doctor_b']]);
    const pid = pr.rows[0].id;
    await c.query(`insert into public.patient_identifiers (patient_id, system, value) values ($1,'facility_mrn',$2)`, [pid, p.mrn]);
    await c.query(`insert into public.consents (patient_id, purpose, given_by, method, notice_version, captured_by) values ($1,'care_triage','self','verbal_witnessed','seed-v0',$2)`,
      [pid, ids[p.facility === 'A' ? 'hw_a' : 'doctor_b']]);
    const er = await c.query(
      `insert into public.encounters (patient_id, facility_id, scenario, status, language, chief_complaint_original, chief_complaint_translated, submitted_at, created_by)
       values ($1,$2,$3,'submitted',$4,$5,$6, now() - interval '20 minutes', $7) returning id`,
      [pid, fac[p.facility], p.scenario, p.lang, p.complaint, p.translated, ids[p.facility === 'A' ? 'hw_a' : 'doctor_b']]);
    const eid = er.rows[0].id;
    for (const [text, dur, unit, sev] of p.symptoms)
      await c.query(`insert into public.symptom_entries (encounter_id, text_original, lang, source, duration_value, duration_unit, severity) values ($1,$2,'en','health_worker',$3,$4,$5)`, [eid, text, dur, unit, sev]);
    for (const [kind, value, unit] of p.vitals)
      await c.query(`insert into public.vitals (encounter_id, kind, value, unit, measured_at) values ($1,$2,$3,$4, now() - interval '15 minutes')`, [eid, kind, value, unit]);
  }
  await c.query('commit');
  writeFileSync('.seed-credentials.local.json', JSON.stringify({ note: 'SYNTHETIC demo accounts. Git-ignored. Delete after the demo.', created_at: new Date().toISOString(), accounts: creds }, null, 2));
  console.log(`done: ${FACILITIES.length} facilities, ${USERS.length} users, ${created} new patients`);
  console.log('credentials written to .seed-credentials.local.json (not printed)');
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('FAILED:', e.message);
  console.error('Note: auth users created before the failure remain; re-running is safe.');
  process.exitCode = 1;
} finally { await c.end(); }
