// Exercises app.send_referral (migration 0014) against the REAL schema in an in-process Postgres.
import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), P = randomUUID(), RS = randomUUID();
const U = { nurse: randomUUID(), doctor: randomUUID(), hw: randomUUID(), other: randomUUID(), outsider: randomUUID(), receiver: randomUUID() };
const BUNDLE = { resourceType: 'Bundle', type: 'document', entry: [] };
const SHA = createHash('sha256').update(JSON.stringify(BUNDLE)).digest('hex');

const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const send = (u: string, ref: string, asm: string, bundle: unknown = BUNDLE, sha: string | null = SHA) =>
  rows(`select app.send_referral($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5) as r`, [u, ref, asm, bundle === null ? null : JSON.stringify(bundle), sha]).then(r => r[0].r);
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { const x = e as { code?: string; message: string; hint?: string }; return { code: x.code, message: x.message, hint: x.hint }; } };

interface Opts { reviewed?: boolean; consent?: boolean; to?: string | null; reason?: string | null; status?: string; reviewer?: string }
/** A submitted encounter with an assessment, optionally reviewed, a draft referral, and optionally a sharing consent. */
async function make(o: Opts = {}) {
  const { reviewed = true, consent = true, to = F2, reason = 'Needs assessment at a higher facility.', status = 'submitted' } = o;
  const e = randomUUID(), a = randomUUID(), r = randomUUID(), pt = randomUUID();
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1, $2, 'Test Patient')`, [pt, F1]);
  await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1, $2, $3, $4)`, [e, pt, F1, status]);
  await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version)
                  values ($1, $2, 1, $3, 'rules_engine', 'orange', '{}'::jsonb, 'fp', 'test')`, [a, e, RS]);
  await db.query(`insert into public.queue_items (encounter_id, facility_id, urgency_code, status) values ($1, $2, 'orange', 'in_review')`, [e, F1]);
  if (reviewed) await db.query(`insert into public.review_actions (encounter_id, assessment_id, reviewer_id, action, from_urgency_code, to_urgency_code) values ($1, $2, $3, 'approve', 'orange', 'orange')`, [e, a, o.reviewer ?? U.nurse]);
  if (consent) await db.query(`insert into public.consents (patient_id, purpose, given_by, method, notice_version) values ($1, 'referral_sharing', 'self', 'verbal_witnessed', 'v1')`, [pt]);
  await db.query(`insert into public.referrals (id, encounter_id, patient_id, from_facility_id, to_facility_id, requested_by, priority, reason_text) values ($1,$2,$3,$4,$5,$6,'asap',$7)`, [r, e, pt, F1, to, U.nurse, reason]);
  return { e, a, r, pt };
}
const referral = async (id: string) => (await rows(`select status, bundle, encode(bundle_sha256, 'hex') as sha, sent_at from public.referrals where id = $1`, [id]))[0];
const encStatus = async (e: string) => (await rows(`select status from public.encounters where id = $1`, [e]))[0].status as string;
const queueStatus = async (e: string) => (await rows(`select status from public.queue_items where encounter_id = $1`, [e]))[0].status as string;

beforeAll(async () => {
  db = await makeDb();
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${k}@t.test`]);
  await db.query(`insert into public.facilities (id, name, type) values ($1, 'PHC', 'phc'), ($2, 'DH', 'district_hospital')`, [F1, F2]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$3,'nurse'), ($2,$3,'doctor'), ($4,$3,'health_worker'), ($5,$6,'doctor'), ($7,$6,'nurse')`, [U.nurse, U.doctor, F1, U.hw, U.other, F2, U.receiver]);
  await db.query(`insert into public.triage_rule_sets (id, name, version, status, source_citation, definition, approved_at) values ($1, 't', '1', 'approved', 'TEST FIXTURE', '{}'::jsonb, now())`, [RS]);
});

describe('a valid send', () => {
  it('freezes the bundle and checksum, and moves the referral, encounter and queue entry together', async () => {
    const { e, a, r } = await make();
    const res = await send(U.nurse, r, a);
    expect(res).toMatchObject({ referralId: r, status: 'requested', sha256: SHA, toFacilityId: F2 });
    const row = await referral(r);
    expect(row).toMatchObject({ status: 'requested', sha: SHA });
    expect(row.bundle).toEqual(BUNDLE);
    expect(row.sent_at).not.toBeNull();
    expect(await encStatus(e)).toBe('referred');
    expect(await queueStatus(e)).toBe('referred');
  });
  it('records the sender in the referral event log (not an anonymous system action)', async () => {
    const { r, a } = await make();
    await send(U.doctor, r, a);
    const ev = await rows(`select status, actor_id from public.referral_events where referral_id = $1 order by at, id`, [r]);
    expect(ev.map(x => x.status)).toEqual(['draft', 'requested']);
    expect(ev[1].actor_id).toBe(U.doctor);
  });
  it('the audit trail names the sender', async () => {
    const { r, a } = await make();
    await send(U.nurse, r, a);
    const au = await rows(`select actor_user_id from public.audit_events where entity_type = 'referrals' and entity_id = $1 order by id desc limit 1`, [r]);
    expect(au[0].actor_user_id).toBe(U.nurse);
  });
  it('the content cannot be changed once sent', async () => {
    const { r, a } = await make();
    await send(U.nurse, r, a);
    expect(await fails(db.query(`update public.referrals set reason_text = 'changed afterwards' where id = $1`, [r]))).not.toBeNull();
    expect(await fails(db.query(`update public.referrals set bundle = '{"resourceType":"Bundle"}'::jsonb where id = $1`, [r]))).not.toBeNull();
  });
});

describe('who may send', () => {
  it.each([['a health worker', 'hw'], ['a user with no membership', 'outsider'], ['a doctor at the RECEIVING facility', 'receiver'], ['a doctor at another facility', 'other']] as const)('%s cannot', async (_n, who) => {
    const { r, a } = await make();
    expect(await fails(send(U[who], r, a))).toMatchObject({ code: '42501' });
    expect((await referral(r)).status).toBe('draft');
  });
});

describe('the safeguards that cannot be skipped', () => {
  it('refuses when the assessment has not been signed off, with a hint', async () => {
    const { e, r, a } = await make({ reviewed: false });
    expect(await fails(send(U.nurse, r, a))).toMatchObject({ code: '55000', hint: 'needs_review' });
    expect((await referral(r)).status).toBe('draft');
    expect(await encStatus(e)).toBe('submitted');
  });
  it('refuses when the patient has not consented to sharing, with a hint', async () => {
    const { r, a } = await make({ consent: false });
    expect(await fails(send(U.nurse, r, a))).toMatchObject({ code: '42501', hint: 'referral_consent' });
  });
  it('a revoked or expired consent does not count', async () => {
    const { r, a, pt } = await make();
    await db.query(`update public.consents set revoked_at = now() where patient_id = $1`, [pt]);
    expect(await fails(send(U.nurse, r, a))).toMatchObject({ code: '42501', hint: 'referral_consent' });
    const m = await make({ consent: false });
    await db.query(`insert into public.consents (patient_id, purpose, given_by, method, notice_version, granted_at, expires_at) values ($1,'referral_sharing','self','paper','v1', now() - interval '2 days', now() - interval '1 day')`, [m.pt]);
    expect(await fails(send(U.nurse, m.r, m.a))).toMatchObject({ code: '42501', hint: 'referral_consent' });
  });
  it('a consent for a DIFFERENT purpose does not count', async () => {
    const { r, a, pt } = await make({ consent: false });
    await db.query(`insert into public.consents (patient_id, purpose, given_by, method, notice_version) values ($1,'care_triage','self','paper','v1')`, [pt]);
    expect(await fails(send(U.nurse, r, a))).toMatchObject({ code: '42501', hint: 'referral_consent' });
  });
  it('refuses a stale assessment (a newer one exists)', async () => {
    const { e, r, a } = await make();
    await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version) values ($1,$2,2,$3,'rules_engine','red','{}'::jsonb,'fp2','test')`, [randomUUID(), e, RS]);
    expect(await fails(send(U.nurse, r, a))).toMatchObject({ code: '40001' });
  });
  it('a newer assessment that has NOT been reviewed cannot be referred, even by id', async () => {
    const { e, r } = await make();
    const a2 = randomUUID();
    await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version) values ($1,$2,2,$3,'rules_engine','red','{}'::jsonb,'fp2','test')`, [a2, e, RS]);
    expect(await fails(send(U.nurse, r, a2))).toMatchObject({ code: '55000', hint: 'needs_review' });
  });
  it.each(['closed', 'cancelled', 'referred', 'draft'])('refuses an encounter that is %s', async st => {
    const { r, a } = await make({ status: st });
    expect(await fails(send(U.nurse, r, a))).toMatchObject({ code: '55000' });
  });
});

describe('an incomplete or already-sent referral', () => {
  it('refuses with no receiving facility, or with a missing or short reason', async () => {
    const m1 = await make({ to: null }); expect(await fails(send(U.nurse, m1.r, m1.a))).toMatchObject({ code: '22023' });
    const m2 = await make({ reason: null }); expect(await fails(send(U.nurse, m2.r, m2.a))).toMatchObject({ code: '22023' });
    const m3 = await make({ reason: 'too short' }); expect(await fails(send(U.nurse, m3.r, m3.a))).toMatchObject({ code: '22023' });
  });
  it('refuses a missing or malformed document and checksum', async () => {
    const { r, a } = await make();
    expect(await fails(send(U.nurse, r, a, null))).toMatchObject({ code: '22023' });
    expect(await fails(send(U.nurse, r, a, { resourceType: 'Patient' }))).toMatchObject({ code: '22023' });
    expect(await fails(send(U.nurse, r, a, BUNDLE, 'not-a-hash'))).toMatchObject({ code: '22023' });
    expect(await fails(send(U.nurse, r, a, BUNDLE, SHA.toUpperCase()))).toMatchObject({ code: '22023' });
  });
  it('cannot be sent twice', async () => {
    const { r, a } = await make();
    await send(U.nurse, r, a);
    expect(await fails(send(U.nurse, r, a))).toMatchObject({ code: '55000' });
  });
  it('refuses an unknown referral', async () => {
    expect(await fails(send(U.nurse, randomUUID(), randomUUID()))).toMatchObject({ code: 'P0002' });
  });
});

describe('integrity and permissions', () => {
  it('a refused send changes nothing at all', async () => {
    const { e, r, a } = await make({ consent: false });
    await fails(send(U.nurse, r, a));
    expect((await referral(r)).status).toBe('draft');
    expect((await referral(r)).bundle).toBeNull();
    expect(await encStatus(e)).toBe('submitted');
    expect(await queueStatus(e)).toBe('in_review');
  });
  it.each(['authenticated', 'anon'])('the role %s cannot call the function directly', async role => {
    const { r, a } = await make();
    await db.exec(`set role ${role}`);
    const err = await fails(send(U.nurse, r, a));
    await db.exec('reset role');
    expect(err!.message).toMatch(/permission denied/i);
    expect((await referral(r)).status).toBe('draft');
  });
});
