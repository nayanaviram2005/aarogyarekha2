// LIVE access-matrix test against the hosted project, using the seeded synthetic users.
// Signs in as each persona (anon key + the passwords in ../.seed-credentials.local.json; nothing is printed) and checks
// that row-level security gives each one exactly the view the design promises.
//   npm run test:live
// If the API is running (API_URL, default http://127.0.0.1:8787) it also checks the same rules through the HTTP API.
// Side effect: a few audit rows are written by the API checks (append-only by design).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing from .env');
const creds = JSON.parse(readFileSync('../.seed-credentials.local.json', 'utf8')).accounts as Record<string, { password: string }>;
const DOMAIN = 'seed.aarogyarekha.test';

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '  [' + detail + ']' : ''}`);
  if (!ok) failed++;
};

async function login(key: string) {
  const email = `${key}@${DOMAIN}`;
  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: creds[email]!.password });
  if (error || !data.session) throw new Error(`sign-in failed for ${key}: ${error?.message}`);
  return { sb, token: data.session.access_token, userId: data.user.id };
}

const names = async (sb: SupabaseClient) => {
  const { data, error } = await sb.from('patients').select('full_name').order('full_name');
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => r.full_name as string);
};
const count = async (sb: SupabaseClient, table: string) => {
  const { count: n, error } = await sb.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
};

const A_PATIENTS = ['Seed Patient 01', 'Seed Patient 02', 'Seed Patient 03', 'Seed Patient 04'];
const B_PATIENTS = ['Seed Patient 05'];

console.log('--- anonymous (no login)');
{
  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const r = await sb.from('patients').select('id').limit(1);
  check(!!r.error || (r.data ?? []).length === 0, 'anonymous cannot read patients', JSON.stringify(r.data));
  const e = await sb.from('encounters').select('id').limit(1);
  check(!!e.error || (e.data ?? []).length === 0, 'anonymous cannot read encounters');
}

const sessions: Record<string, Awaited<ReturnType<typeof login>>> = {};
for (const k of ['hw_a', 'nurse_a', 'doctor_a', 'doctor_b', 'admin_a', 'platform', 'outsider']) sessions[k] = await login(k);

console.log('--- facility A clinical staff see facility A patients only');
for (const k of ['hw_a', 'nurse_a', 'doctor_a']) {
  const got = await names(sessions[k]!.sb);
  check(JSON.stringify(got) === JSON.stringify(A_PATIENTS), `${k} sees exactly the 4 facility A patients`, got.join(', '));
  check((await count(sessions[k]!.sb, 'encounters')) >= 4, `${k} sees at least the 4 seeded encounters (live runs add more)`);
}

console.log('--- facility B doctor sees facility B only (tenant isolation)');
{
  const got = await names(sessions.doctor_b!.sb);
  check(JSON.stringify(got) === JSON.stringify(B_PATIENTS), 'doctor_b sees exactly the 1 facility B patient', got.join(', '));
  check(!got.some(n => A_PATIENTS.includes(n)), 'doctor_b sees none of facility A');
}

console.log('--- non-clinical and unaffiliated users see no patient data');
for (const [k, label] of [['admin_a', 'facility admin'], ['platform', 'platform admin'], ['outsider', 'user with no membership']] as const) {
  check((await names(sessions[k]!.sb)).length === 0, `${label} sees 0 patients`);
  check((await count(sessions[k]!.sb, 'encounters')) === 0, `${label} sees 0 encounters`);
  check((await count(sessions[k]!.sb, 'vitals')) === 0, `${label} sees 0 vitals`);
  check((await count(sessions[k]!.sb, 'symptom_entries')) === 0, `${label} sees 0 symptom entries`);
}

console.log('--- writes that must be refused');
{
  const { data: facB } = await sessions.doctor_b!.sb.from('memberships').select('facility_id').limit(1);
  const fB = facB?.[0]?.facility_id as string | undefined;
  check(!!fB, 'could resolve facility B id for the write tests');
  if (fB) {
    const r = await sessions.hw_a!.sb.from('patients').insert({ registered_facility_id: fB, full_name: 'SHOULD NOT EXIST' });
    check(!!r.error, 'health worker A cannot register a patient at facility B', r.error ? '' : 'insert succeeded');
  }
  const p = await sessions.hw_a!.sb.from('profiles').update({ credential_reset_required: true }).eq('user_id', sessions.hw_a!.userId);
  check(!!p.error, 'a user cannot edit their own credential_reset_required flag (column privilege)');
  const m = await sessions.hw_a!.sb.from('memberships').insert({
    user_id: sessions.hw_a!.userId, facility_id: fB ?? '00000000-0000-0000-0000-000000000000', role: 'doctor',
  });
  check(!!m.error, 'a user cannot grant themselves a membership or role');
  const pa = await sessions.outsider!.sb.from('platform_admins').insert({ user_id: sessions.outsider!.userId });
  check(!!pa.error, 'a user cannot make themselves a platform admin');
  const aud = await sessions.doctor_a!.sb.from('audit_events').select('id').limit(1);
  check(!!aud.error || (aud.data ?? []).length === 0, 'clinicians cannot read the audit log');
}

console.log('--- through the HTTP API (skipped if the API is not running)');
{
  const api = process.env.API_URL ?? 'http://127.0.0.1:8787';
  const up = await fetch(`${api}/health`).then(r => r.ok).catch(() => false);
  if (!up) console.log(`SKIP  API not reachable at ${api} (start it with: npm run dev)`);
  else {
    const { data } = await sessions.doctor_a!.sb.from('patients').select('id').eq('full_name', 'Seed Patient 01').limit(1);
    const pid = data?.[0]?.id as string;
    const get = (token: string | null) => fetch(`${api}/fhir/Patient/${pid}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const ok = await get(sessions.doctor_a!.token);
    check(ok.status === 200 && (await ok.json()).resourceType === 'Patient', 'API: doctor at facility A reads the patient (200, FHIR Patient)');
    check((await get(sessions.doctor_b!.token)).status === 404, 'API: doctor at facility B gets 404, not the record');
    check((await get(sessions.admin_a!.token)).status === 404, 'API: facility admin gets 404');
    check((await get(sessions.outsider!.token)).status === 404, 'API: user with no membership gets 404');
    check((await get(null)).status === 401, 'API: no token gets 401');
  }
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll live access checks passed');
process.exit(failed ? 1 : 0);
