import pg from 'pg';
import { randomBytes, randomInt } from 'node:crypto';

const apply = process.argv.includes('--apply');
const countArg = process.argv.find(a => a.startsWith('--count='));
const COUNT = countArg ? Number(countArg.slice(8)) : 6;
const dbUrl = process.env.DATABASE_URL_POOLER?.replace(':6543/', ':5432/') || process.env.DATABASE_URL_DIRECT;
if (!dbUrl) { console.error('Missing a database URL in .env'); process.exit(1); }
if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 50) { console.error('--count must be a whole number from 1 to 50'); process.exit(1); }

const DOMAIN = 'seed.aarogyarekha.test';
const FACILITY_CODES = { A: 'SEED-PHC-01', B: 'SEED-DH-01' };
const CREATORS = { A: `hw_a@${DOMAIN}`, B: `doctor_b@${DOMAIN}` };

const between = (lo, hi) => randomInt(lo, hi + 1);
const pick = list => list[randomInt(0, list.length)];
const tenth = (lo, hi) => between(Math.round(lo * 10), Math.round(hi * 10)) / 10;

const TEMPLATES = [
  { scenario: 'opd_queue', lang: 'en', sex: 'any', age: [18, 70], complaint: 'Fever and body ache for a few days', translated: null,
    symptoms: () => [['Fever', between(2, 5), 'days', between(4, 8)], ['Body ache', between(1, 4), 'days', between(3, 6)]],
    vitals: () => [['temperature_c', tenth(37.8, 39.6), 'Cel'], ['pulse_bpm', between(86, 118), '/min'], ['spo2_pct', between(95, 99), '%']] },
  { scenario: 'opd_queue', lang: 'or', sex: 'any', age: [20, 65], complaint: 'ଜ୍ୱର ଏବଂ କାଶ କିଛି ଦିନ ଧରି', translated: 'Fever and cough for some days',
    symptoms: () => [['Fever', between(2, 4), 'days', between(4, 7)], ['Cough', between(2, 6), 'days', between(3, 6)]],
    vitals: () => [['temperature_c', tenth(37.9, 39.2), 'Cel'], ['pulse_bpm', between(88, 112), '/min'], ['spo2_pct', between(93, 98), '%']] },
  { scenario: 'campus_fever', lang: 'hi', sex: 'any', age: [6, 14], complaint: 'दो दिन से बुखार और गले में दर्द', translated: 'Fever and sore throat for two days',
    symptoms: () => [['Fever', between(1, 3), 'days', between(5, 8)], ['Sore throat', between(1, 3), 'days', between(3, 6)]],
    vitals: () => [['temperature_c', tenth(38.2, 39.8), 'Cel'], ['weight_kg', between(18, 42), 'kg']] },
  { scenario: 'maternal_followup', lang: 'en', sex: 'female', age: [19, 38], complaint: 'Headache and swelling of feet in late pregnancy', translated: null,
    symptoms: () => [['Headache', between(1, 3), 'days', between(4, 7)], ['Swelling of both feet', between(2, 6), 'days', between(3, 5)]],
    vitals: () => [['bp_systolic_mmhg', between(132, 165), 'mm[Hg]'], ['bp_diastolic_mmhg', between(84, 108), 'mm[Hg]']] },
  { scenario: 'chronic_checkin', lang: 'en', sex: 'any', age: [45, 75], complaint: 'Routine check-in, feeling tired', translated: null,
    symptoms: () => [['Tiredness', between(1, 4), 'weeks', between(2, 5)]],
    vitals: () => [['blood_glucose_mgdl', between(140, 290), 'mg/dL'], ['bp_systolic_mmhg', between(120, 158), 'mm[Hg]'], ['bp_diastolic_mmhg', between(76, 98), 'mm[Hg]']] },
  { scenario: 'opd_queue', lang: 'en', sex: 'any', age: [16, 80], complaint: 'Abdominal pain since yesterday', translated: null,
    symptoms: () => [['Abdominal pain', between(1, 2), 'days', between(4, 8)], ['Nausea', 1, 'days', between(2, 5)]],
    vitals: () => [['pulse_bpm', between(80, 112), '/min'], ['temperature_c', tenth(36.8, 38.4), 'Cel']] },
  { scenario: 'opd_queue', lang: 'hi', sex: 'any', age: [3, 10], complaint: 'सुबह से सांस लेने में तकलीफ और खांसी', translated: 'Trouble breathing and cough since morning',
    symptoms: () => [['Fast breathing', 1, 'days', between(6, 9)], ['Cough', between(1, 3), 'days', between(4, 7)]],
    vitals: () => [['spo2_pct', between(88, 94), '%'], ['pulse_bpm', between(110, 150), '/min'], ['weight_kg', between(12, 30), 'kg']] },
  { scenario: 'opd_queue', lang: 'or', sex: 'any', age: [25, 60], complaint: 'ମୁଣ୍ଡ ବିନ୍ଧା ଏବଂ ବାନ୍ତି', translated: 'Headache and vomiting',
    symptoms: () => [['Headache', between(1, 3), 'days', between(4, 8)], ['Vomiting', between(1, 2), 'days', between(3, 6)]],
    vitals: () => [['bp_systolic_mmhg', between(110, 150), 'mm[Hg]'], ['pulse_bpm', between(76, 104), '/min']] },
];

const plan = Array.from({ length: COUNT }, () => {
  const t = pick(TEMPLATES);
  const facility = pick(['A', 'A', 'B']);
  const sex = t.sex === 'any' ? pick(['female', 'male']) : t.sex;
  return {
    mrn: `SEED-RND-${randomBytes(3).toString('hex').toUpperCase()}`,
    name: `Seed Patient ${randomBytes(2).toString('hex').toUpperCase()}`,
    facility, sex, age: between(t.age[0], t.age[1]), lang: t.lang, scenario: t.scenario,
    complaint: t.complaint, translated: t.translated, symptoms: t.symptoms(), vitals: t.vitals(),
    phone: `+9190000${between(20000, 99999)}`,
  };
});

console.log(apply ? 'APPLYING random seed patients' : 'DRY RUN (no changes). Re-run with --apply to create the patients below.');
for (const p of plan) console.log(`  ${p.mrn}  ${p.name}  ${p.sex} ${p.age}y  ${p.lang}  facility ${p.facility}  ${p.scenario}  "${p.translated ?? p.complaint}"`);
if (!apply) process.exit(0);

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
try {
  const fac = {};
  for (const [key, code] of Object.entries(FACILITY_CODES)) {
    const r = await c.query('select id from public.facilities where code = $1', [code]);
    if (!r.rowCount) throw new Error(`facility ${code} not found. Run scripts/seed.mjs --apply first.`);
    fac[key] = r.rows[0].id;
  }
  const by = {};
  for (const [key, email] of Object.entries(CREATORS)) {
    const r = await c.query('select id from auth.users where email = $1', [email]);
    if (!r.rowCount) throw new Error(`seed user ${email} not found. Run scripts/seed.mjs --apply first.`);
    by[key] = r.rows[0].id;
  }

  await c.query('begin');
  for (const p of plan) {
    const pr = await c.query(
      `insert into public.patients (registered_facility_id, full_name, preferred_language, sex, age_years_reported, phone, district, state, created_by)
       values ($1,$2,$3,$4,$5,$6,'Khordha','Odisha',$7) returning id`,
      [fac[p.facility], p.name, p.lang, p.sex, p.age, p.phone, by[p.facility]]);
    const pid = pr.rows[0].id;
    await c.query(`insert into public.patient_identifiers (patient_id, system, value) values ($1,'facility_mrn',$2)`, [pid, p.mrn]);
    await c.query(`insert into public.consents (patient_id, purpose, given_by, method, notice_version, captured_by) values ($1,'care_triage','self','verbal_witnessed','seed-v0',$2)`, [pid, by[p.facility]]);
    const er = await c.query(
      `insert into public.encounters (patient_id, facility_id, scenario, status, language, chief_complaint_original, chief_complaint_translated, submitted_at, created_by)
       values ($1,$2,$3,'submitted',$4,$5,$6, now() - make_interval(mins => $8), $7) returning id`,
      [pid, fac[p.facility], p.scenario, p.lang, p.complaint, p.translated, by[p.facility], between(5, 90)]);
    const eid = er.rows[0].id;
    for (const [text, dur, unit, sev] of p.symptoms)
      await c.query(`insert into public.symptom_entries (encounter_id, text_original, lang, source, duration_value, duration_unit, severity) values ($1,$2,'en','health_worker',$3,$4,$5)`, [eid, text, dur, unit, sev]);
    for (const [kind, value, unit] of p.vitals)
      await c.query(`insert into public.vitals (encounter_id, kind, value, unit, measured_at) values ($1,$2,$3,$4, now() - interval '3 minutes')`, [eid, kind, value, unit]);
  }
  await c.query('commit');
  console.log(`done: ${plan.length} synthetic patients with a visit, symptoms, vitals and care_triage consent`);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally { await c.end(); }
