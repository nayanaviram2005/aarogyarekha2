// LIVE end-to-end run of the newer features through the HTTP API, as the seeded accounts.
//   1) terminal A:  npm --prefix aarogyarekha2-backend run dev        (set MFA_REQUIRED=false in .env if you have not enrolled an authenticator)
//   2) terminal B:  npm --prefix aarogyarekha2-backend run test:features
// Registers ONE new synthetic patient ("Live Check <time>") and walks it through registration, consent, history, notes, follow-up,
// upload, background reading, outside-AI refusals, admin screens and the referral inbox. Rows are permanent (the audit log is
// append-only by design); everything is synthetic. Checks that need migration 0015 or an AI/OCR set-up say so instead of failing.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing from .env');
const API = process.env.API_URL ?? 'http://127.0.0.1:8787';
const creds = JSON.parse(readFileSync('../.seed-credentials.local.json', 'utf8')).accounts as Record<string, { password: string }>;

let failed = 0;
const check = (ok: boolean, label: string, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '  [' + detail + ']' : ''}`); if (!ok) failed++; };
const info = (s: string) => console.log(`INFO  ${s}`);

async function login(key: string) {
  const email = `${key}@seed.aarogyarekha.test`;
  const sb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: creds[email]!.password });
  if (error || !data.session) throw new Error(`sign-in failed for ${key}`);
  return data.session.access_token;
}
const call = async (token: string | null, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
};
const text = (r: { json: any }) => String(r.json?.issue?.[0]?.details?.text ?? '');

if (!(await fetch(`${API}/health`).then(r => r.ok).catch(() => false))) { console.error(`The API is not running at ${API}. Start it first.`); process.exit(2); }

const hw = await login('hw_a'), nurse = await login('nurse_a'), admin = await login('admin_a'), outsider = await login('outsider'), docB = await login('doctor_b');

console.log('--- register and consent');
const name = `Live Check ${Date.now().toString(36)}`;
const reg = await call(hw, 'POST', '/patients', { fullName: name, sex: 'female', ageYears: 28, preferredLanguage: 'hi', villageTown: 'Testpur' });
check(reg.status === 201 && !!reg.json.publicRef, 'a health worker registers a new patient', JSON.stringify(reg.json));
const pid = reg.json.id as string;
if (!pid) { console.log('\nCannot go on without a patient.'); process.exit(1); }
const dup = await call(hw, 'POST', '/patients', { fullName: name, sex: 'female', ageYears: 28, preferredLanguage: 'hi' });
check(dup.status === 409 && dup.json.possibleDuplicates?.length >= 1, 'registering the same person again is stopped with who they match (409)', JSON.stringify(dup.json).slice(0, 160));
check((await call(hw, 'POST', '/patients', { fullName: name, sex: 'female', ageYears: 28, confirmNotDuplicate: true })).status === 201, 'and goes through once staff confirm it is a different person');
check([400, 403].includes((await call(outsider, 'POST', '/patients', { fullName: 'Nobody Here', sex: 'male', ageYears: 30 })).status), 'a user with no facility cannot register patients');
check((await call(null, 'POST', '/patients', { fullName: 'x', sex: 'male', ageYears: 3 })).status === 401, 'no token is refused (401)');
for (const purpose of ['care_triage', 'reminders'] as const) {
  const c = await call(hw, 'POST', `/patients/${pid}/consents`, { purpose, method: 'verbal_witnessed', witnessName: 'Live Check Witness', noticeVersion: 'live-check' });
  check(c.status === 201, `consent recorded: ${purpose}`, JSON.stringify(c.json));
}

console.log('--- history, notes, trends');
const hx = await call(hw, 'POST', `/patients/${pid}/history`, { kind: 'allergy', text: 'penicillin rash (synthetic)' });
check(hx.status === 201, 'history entry added as told', JSON.stringify(hx.json));
const hl = await call(nurse, 'GET', `/patients/${pid}/history`);
const entry = hl.json.history?.find((x: any) => x.kind === 'allergy');
check(hl.status === 200 && !!entry && entry.confirmed === false, 'the nurse sees it as reported, not confirmed', JSON.stringify(hl.json).slice(0, 160));
check((await call(hw, 'POST', `/history/${entry?.id ?? '00000000-0000-4000-8000-000000000001'}/confirm`)).status === 404, 'a health worker cannot confirm history (404)');
check((await call(nurse, 'POST', `/history/${entry?.id}/confirm`)).status === 200, 'a nurse confirms it');
check((await call(outsider, 'GET', `/patients/${pid}/history`)).status === 404, 'an outsider cannot read the history (404)');
const tr = await call(nurse, 'GET', `/patients/${pid}/trends`);
check(tr.status === 200 && Array.isArray(tr.json.points), 'trends answer (empty is fine for a new patient)', JSON.stringify(tr.json).slice(0, 120));

console.log('--- visit');
const enc = await call(hw, 'POST', '/encounters', { patientId: pid, scenario: 'chronic_checkin', language: 'hi', chiefComplaint: 'bukhar teen din se' });
check(enc.status === 201, 'a visit is opened', JSON.stringify(enc.json));
const eid = enc.json.id as string;
if (eid) {
  check((await call(hw, 'POST', `/encounters/${eid}/symptoms`, { text: 'Taking medicines as prescribed: Yes', lang: 'en' })).status === 201, 'a template answer is saved as an ordinary note');
  check((await call(hw, 'POST', `/encounters/${eid}/vitals`, { kind: 'bp_systolic_mmhg', value: 150 })).status === 201, 'a measurement typed by hand is saved');
  check((await call(hw, 'POST', `/encounters/${eid}/submit`)).status === 200, 'visit submitted');
  const q = await call(hw, 'GET', '/queue');
  const row = q.json.entries?.find((e: any) => e.encounterId === eid);
  check(q.status === 200 && !!row && typeof row.waitingLong === 'boolean' && !!row.facilityId, 'the queue entry carries facilityId and waitingLong', JSON.stringify(row ?? {}).slice(0, 160));
  const tr2 = await call(nurse, 'GET', `/patients/${pid}/trends`);
  check(tr2.json.points?.some((p: any) => p.kind === 'bp_systolic_mmhg' && p.value === 150), 'the typed reading shows up in the trends');

  const nt = await call(nurse, 'POST', `/encounters/${eid}/notes`, { kind: 'comment', body: 'Recheck pressure after rest (synthetic)' });
  if (nt.status === 503 || nt.status === 502) info('reviewer notes are not available (migration 0015 not applied?): ' + text(nt));
  else {
    check(nt.status === 201, 'a nurse adds a reviewer note', JSON.stringify(nt.json));
    check((await call(hw, 'POST', `/encounters/${eid}/notes`, { kind: 'comment', body: 'x' })).status === 403, 'a health worker cannot add reviewer notes (403)');
    check((await call(nurse, 'POST', `/encounters/${eid}/notes`, { kind: 'escalation' })).status === 400, 'an escalation without a reason is refused (400)');
    const nl = await call(nurse, 'GET', `/encounters/${eid}/notes`); check(nl.status === 200 && nl.json.notes?.length >= 1, 'the notes list shows it');
  }

  console.log('--- follow-up and reminders');
  const fu = await call(nurse, 'POST', `/encounters/${eid}/followups`, { kind: 'chronic_checkin', firstDueInDays: 14, cadenceDays: 28 });
  check(fu.status === 201, 'a follow-up is planned', JSON.stringify(fu.json));
  const rm = await call(nurse, 'POST', `/followups/${fu.json.id}/reminders`, { channel: 'sms' });
  check(rm.status === 201 && rm.json.status === 'scheduled', 'a reminder is scheduled (consent was recorded)', JSON.stringify(rm.json));
  check((await call(outsider, 'POST', `/followups/${fu.json.id}/reminders`, { channel: 'sms' })).status === 404, 'an outsider cannot schedule reminders (404)');

  console.log('--- upload and background reading');
  const png = new PNG({ width: 900, height: 900 }); for (let y = 0; y < 900; y++) for (let x = 0; x < 900; x++) { const k = (y * 900 + x) * 4; const ink = Math.floor(y / 14) % 2 === 0 && x % 40 < 25 && x > 60 && x < 840; png.data[k] = png.data[k + 1] = png.data[k + 2] = ink ? 20 : 235; png.data[k + 3] = 255; }
  const fd = new FormData(); fd.append('kind', 'lab_report'); fd.append('file', new Blob([new Uint8Array(PNG.sync.write(png))], { type: 'image/png' }), 'live-check.png');
  const up = await fetch(`${API}/encounters/${eid}/documents`, { method: 'POST', headers: { authorization: `Bearer ${hw}` }, body: fd }); const upj = (await up.json().catch(() => ({}))) as any;
  check(up.status === 201 && upj.status === 'clean' && Array.isArray(upj.quality?.warnings), 'a picture is uploaded, cleaned and quality-checked', JSON.stringify(upj).slice(0, 200));
  if (upj.id) {
    const ex = await call(hw, 'POST', `/documents/${upj.id}/extract?async=1`);
    check(ex.status === 202 && !!ex.json.jobId, 'reading starts in the background (202)', JSON.stringify(ex.json));
    check((await call(outsider, 'GET', `/jobs/${ex.json.jobId}`)).status === 404, 'another user cannot see the job (404)');
    let st = 'queued'; let msg = '';
    for (let i = 0; i < 60 && (st === 'queued' || st === 'running'); i++) { await new Promise(r => setTimeout(r, 1500)); const j = await call(hw, 'GET', `/jobs/${ex.json.jobId}`); st = j.json.status; msg = j.json.error ?? ''; }
    check(st === 'done' || st === 'failed', 'the job finishes with a plain result', `${st} ${msg}`);
    info(`reading result: ${st}${msg ? ' (' + msg + ')' : ''}. A synthetic picture of bars has no test results, so a "No test results were found" message is the expected, correct answer.`);
  }

  console.log('--- outside AI is refused without the patient\'s separate consent');
  const tl = await call(hw, 'POST', `/encounters/${eid}/translate`);
  check(tl.status === 403 && /outside AI/i.test(text(tl)), 'translation is refused without external_ai_processing consent (403)', text(tl));
  const fdv = new FormData(); fdv.append('audio', new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], { type: 'audio/webm' }), 'a.webm');
  const tv = await fetch(`${API}/encounters/${eid}/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${hw}` }, body: fdv });
  check([403, 503].includes(tv.status), 'speech to text is refused without that consent (403), or says it is not set up (503)', String(tv.status));

  console.log('--- referral inbox and replies');
  check((await call(docB, 'GET', '/referrals/incoming')).status === 200, 'a clinician at another facility reads their incoming list');
  check((await call(admin, 'GET', '/referrals/incoming')).status === 403, 'an administrator cannot (403)');
  check((await call(docB, 'POST', '/referrals/00000000-0000-4000-8000-0000000000cc/respond', { action: 'accept' })).status === 404, 'replying to a referral that does not exist is a plain 404 (403 instead if a second factor is required and not verified)') || void 0;
}

console.log('--- administrator screens');
const fl = await call(admin, 'GET', '/admin/audit/flags'); check(fl.status === 200 && fl.json.rulesValidated === false, 'unusual-access list answers and says its limits are drafts', JSON.stringify(fl.json).slice(0, 120));
const ch = await call(admin, 'GET', '/admin/audit/chain'); check(ch.status === 200 && ch.json.intact === true, `the audit chain is intact (${ch.json.checked} entries)`, JSON.stringify(ch.json).slice(0, 160));
const an = await call(admin, 'GET', '/admin/analytics?days=30'); check(an.status === 200 && typeof an.json.encounters === 'number' && !JSON.stringify(an.json).match(/Live Check/), 'figures answer and carry no names', JSON.stringify(an.json).slice(0, 120));
check((await call(admin, 'GET', '/admin/break-glass')).status === 200, 'the emergency-access list answers');
check((await call(nurse, 'GET', '/admin/audit/flags')).status === 403, 'a nurse cannot open the administrator screens (403)');
check((await call(nurse, 'GET', '/admin/analytics')).status === 403, 'nor the figures (403)');
const bg = await call(nurse, 'POST', '/break-glass', { publicRef: 'AR-0000', reason: 'Live check: unknown record number' });
check([404, 403].includes(bg.status), 'emergency access for an unknown record number is refused (404, or 403 if a second factor is required and not verified)', String(bg.status));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll live feature checks passed');
process.exit(failed ? 1 : 0);
