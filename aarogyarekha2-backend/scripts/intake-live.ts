// LIVE end-to-end run of the intake path through the HTTP API, as the seeded health worker at facility A.
//   1) in one terminal:  npm --prefix aarogyarekha2-backend run dev
//   2) in another:       npm --prefix aarogyarekha2-backend run test:intake
// Creates ONE new synthetic encounter for "Seed Patient 02" (a child) and walks it through intake. Rows are permanent
// (audit is append-only by design); everything is synthetic. Assessment succeeds only once the rule set is APPROVED;
// until then the expected result is a plain 503 saying so, and that is reported as a pass.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing from .env');
const API = process.env.API_URL ?? 'http://127.0.0.1:8787';
const creds = JSON.parse(readFileSync('../.seed-credentials.local.json', 'utf8')).accounts as Record<string, { password: string }>;

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '  [' + detail + ']' : ''}`); if (!ok) failed++; };

async function login(key: string) {
  const email = `${key}@seed.aarogyarekha.test`;
  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: creds[email]!.password });
  if (error || !data.session) throw new Error(`sign-in failed for ${key}`);
  return { sb, token: data.session.access_token };
}
const call = async (token: string | null, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
};

if (!(await fetch(`${API}/health`).then(r => r.ok).catch(() => false))) {
  console.error(`The API is not running at ${API}. Start it first: npm --prefix aarogyarekha2-backend run dev`);
  process.exit(2);
}

const hw = await login('hw_a');
const outsider = await login('outsider');
const docB = await login('doctor_b');
const nurse = await login('nurse_a');
const { data: p } = await hw.sb.from('patients').select('id').eq('full_name', 'Seed Patient 02').limit(1);
const patientId = p?.[0]?.id as string;
check(!!patientId, 'found the seeded child patient');

console.log('--- access');
check((await call(outsider.token, 'POST', '/encounters', { patientId })).status === 404, 'a user with no membership cannot start an encounter (404)');
check((await call(docB.token, 'POST', '/encounters', { patientId })).status === 404, 'a doctor at another facility cannot start an encounter (404)');
check((await call(null, 'POST', '/encounters', { patientId })).status === 401, 'no token is refused (401)');

console.log('--- intake as the facility A health worker');
const enc = await call(hw.token, 'POST', '/encounters', { patientId, scenario: 'campus_fever', language: 'hi', chiefComplaint: 'तीन दिन से बुखार' });
check(enc.status === 201 && enc.json.status === 'draft', 'encounter created as a draft', JSON.stringify(enc.json));
const eid = enc.json.id as string;
if (eid) {
  const sym = await call(hw.token, 'POST', `/encounters/${eid}/symptoms`, { text: 'Fever', durationValue: 3, durationUnit: 'days', severity: 7 });
  check(sym.status === 201, 'symptom recorded', JSON.stringify(sym.json));
  const t = await call(hw.token, 'POST', `/encounters/${eid}/vitals`, { kind: 'temperature_c', value: 39.2 });
  check(t.status === 201, 'temperature recorded', JSON.stringify(t.json));
  check((await call(hw.token, 'POST', `/encounters/${eid}/vitals`, { kind: 'temperature_c', value: 90 })).status === 422, 'an impossible temperature is refused (422, plain message)');
  check((await call(hw.token, 'POST', `/encounters/${eid}/vitals`, { kind: 'temperature_c', value: 38, unit: 'F' })).status === 400, 'a client-supplied unit is refused (400)');
  const inp = await call(hw.token, 'PUT', `/encounters/${eid}/triage-inputs`, { signs: { vomits_everything: false, convulsions_this_illness: false } });
  check(inp.status === 200, 'danger-sign answers saved', JSON.stringify(inp.json));
  check((await call(hw.token, 'PUT', `/encounters/${eid}/triage-inputs`, { signs: { made_up: true } })).status === 400, 'an unknown sign code is refused (400)');
  check((await call(outsider.token, 'POST', `/encounters/${eid}/symptoms`, { text: 'x' })).status === 404, 'an outsider cannot add to this encounter (404)');
  const sub = await call(hw.token, 'POST', `/encounters/${eid}/submit`);
  check(sub.status === 200 && sub.json.status === 'submitted', 'encounter submitted', JSON.stringify(sub.json));
  check((await call(hw.token, 'POST', `/encounters/${eid}/submit`)).status === 409, 'submitting twice is refused (409)');

  console.log('--- sign-off access');
  const ghost = '00000000-0000-4000-8000-00000000dead';
  const rv = (tok: string | null) => call(tok, 'POST', `/encounters/${eid}/review`, { action: 'approve', assessmentId: ghost });
  check((await rv(hw.token)).status === 403, 'a health worker cannot sign off (403)');
  check((await rv(outsider.token)).status === 404, 'a user with no membership cannot see the encounter to review it (404)');
  check((await rv(docB.token)).status === 404, 'a doctor at another facility gets 404');
  check((await rv(null)).status === 401, 'no token is refused (401)');
  const nr = await rv(nurse.token);
  check(nr.status === 409, 'a nurse at this facility passes the role check; a made-up assessment id is refused as stale or missing (409)', JSON.stringify(nr.json));
  check((await call(hw.token, 'POST', `/encounters/${eid}/review`, { action: 'override', assessmentId: ghost, toUrgency: 'green', reasonCode: 'other', reason: 'short' })).status === 400, 'an override with a short reason is refused before anything is recorded (400)');

  console.log('--- referral access');
  check((await call(hw.token, 'GET', '/facilities')).status === 200, 'a signed-in user can read the facility directory');
  const f = (await call(hw.token, 'GET', '/facilities')).json.facilities as { id: string }[] | undefined;
  const other = f?.[0]?.id ?? '00000000-0000-4000-8000-0000000000aa';
  const mk = (tok: string | null) => call(tok, 'POST', `/encounters/${eid}/referrals`, { toFacilityId: other, reasonText: 'Needs assessment at a higher facility.' });
  check((await mk(null)).status === 401, 'creating a referral without a token is refused (401)');
  check((await mk(outsider.token)).status === 404, 'a user with no membership cannot see the encounter (404)');
  check((await mk(docB.token)).status === 404, 'a doctor at another facility cannot see the encounter (404)');
  const early = await mk(nurse.token);
  check(early.status === 409 && /sign off/i.test(early.json.issue?.[0]?.details?.text ?? ''), 'a referral cannot be prepared before a reviewer has signed off the priority (409, plain message)', JSON.stringify(early.json));
  check((await call(nurse.token, 'POST', `/referrals/00000000-0000-4000-8000-0000000000bb/send`)).status === 404, 'sending a referral that does not exist or is not visible is 404');

  console.log('--- assessment');
  const a = await call(hw.token, 'POST', `/encounters/${eid}/assess`);
  if (a.status === 503) {
    check(/not approved/i.test(a.json.issue?.[0]?.details?.text ?? ''), 'rules not approved yet: plain 503 explains it and nothing is stored (expected until a reviewer approves)');
  } else {
    check(a.status === 200, 'assessment returned', JSON.stringify(a.json).slice(0, 200));
    if (a.status === 200) {
      console.log(`INFO  tier ${a.json.tier} (${a.json.urgencyCode}), potential tier ${a.json.potentialTier ?? 'none'}, ${a.json.followUps.length} follow-up questions, rule ${a.json.winning.ruleId}`);
      check(a.json.tier >= 1 && a.json.tier <= 4 && /does not diagnose/i.test(a.json.disclaimer), 'tier is 1-4 and the disclaimer is present');
      check(a.json.followUps[0]?.rank === 1, 'follow-up questions are ranked');
    }
  }
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll live intake checks passed');
process.exit(failed ? 1 : 0);
