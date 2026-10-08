// Migration 0018 (call in, complete the visit) against the REAL schema in an in-process Postgres.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), P = randomUUID(), RS = randomUUID();
const U = { hw: randomUUID(), nurse: randomUUID(), doctor: randomUUID(), other: randomUUID(), outsider: randomUUID(), admin: randomUUID() };
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const callIn = (u: string, e: string) => rows(`select app.call_in($1::uuid, $2::uuid) r`, [u, e]).then(r => r[0].r);
const complete = (u: string, e: string, o: string) => rows(`select app.complete_visit($1::uuid, $2::uuid, $3) r`, [u, e, o]).then(r => r[0].r);
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { const x = e as { code?: string; message: string; hint?: string }; return { code: x.code, message: x.message, hint: x.hint }; } };

async function make(status = 'submitted', queueStatus = 'waiting', urgency = 'orange') {
  const e = randomUUID(), a = randomUUID();
  await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1, $2, $3, $4)`, [e, P, F1, status]);
  await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version)
                  values ($1, $2, 1, $3, 'rules_engine', $4, '{}'::jsonb, 'fp', 'test')`, [a, e, RS, urgency]);
  await db.query(`insert into public.queue_items (encounter_id, facility_id, urgency_code, status, entered_at) values ($1, $2, $3, $4::public.queue_status, now() - interval '30 minutes')`, [e, F1, urgency, queueStatus]);
  return { e, a };
}
const review = (e: string, a: string, who = U.nurse) => db.query(`insert into public.review_actions (encounter_id, assessment_id, reviewer_id, action, from_urgency_code, to_urgency_code) values ($1, $2, $3, 'approve', 'orange', 'orange')`, [e, a, who]);
const q = async (e: string) => (await rows(`select status::text s, assigned_to, called_at, completed_at from public.queue_items where encounter_id = $1`, [e]))[0];
const enc = async (e: string) => (await rows(`select status::text s, outcome, closed_at, closed_by from public.encounters where id = $1`, [e]))[0];
const lastAudit = async () => (await rows(`select details, actor_user_id, facility_id, patient_id from public.audit_events where entity_type = 'queue_item' order by id desc limit 1`))[0];

beforeAll(async () => {
  db = await makeDb();
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${k}@t.test`]);
  await db.query(`insert into public.facilities (id, name, type) values ($1, 'PHC', 'phc'), ($2, 'DH', 'district_hospital')`, [F1, F2]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1, $2, 'Test Patient')`, [P, F1]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$6,'health_worker'), ($2,$6,'nurse'), ($3,$6,'doctor'), ($4,$7,'doctor'), ($5,$6,'facility_admin')`, [U.hw, U.nurse, U.doctor, U.other, U.admin, F1, F2]);
  await db.query(`insert into public.triage_rule_sets (id, name, version, status, source_citation, definition, approved_at) values ($1, 't', '1', 'approved', 'TEST FIXTURE', '{}'::jsonb, now())`, [RS]);
});

describe('calling a patient in', () => {
  it('a health worker or a nurse calls in a waiting patient: being seen, assigned, time recorded, audited without names', async () => {
    const { e } = await make(); const r = await callIn(U.hw, e);
    expect(r).toMatchObject({ status: 'in_review' }); expect(await q(e)).toMatchObject({ s: 'in_review', assigned_to: U.hw }); expect((await q(e)).called_at).not.toBeNull(); expect((await enc(e)).s).toBe('in_review');
    const a = await lastAudit(); expect(a).toMatchObject({ actor_user_id: U.hw, facility_id: F1, patient_id: P }); expect(a.details).toMatchObject({ op: 'call_in', urgency: 'orange' }); expect(JSON.stringify(a)).not.toMatch(/Test Patient|@t\.test/);
  });
  it('calling in again by the same person is harmless; by someone else it is refused (already being seen)', async () => {
    const { e } = await make(); await callIn(U.nurse, e); await callIn(U.nurse, e);
    expect(await fails(callIn(U.doctor, e))).toMatchObject({ code: '55000', hint: 'taken' }); expect((await q(e)).assigned_to).toBe(U.nurse);
  });
  it('a stranger, a doctor at another facility and a facility administrator cannot', async () => {
    const { e } = await make();
    for (const u of [U.outsider, U.other, U.admin, randomUUID()]) expect((await fails(callIn(u, e)))?.code, u).toBe('42501');
    expect((await q(e)).s).toBe('waiting');
  });
  it('a patient who left the queue, or an unknown encounter, cannot be called in', async () => {
    const closed = await make('closed', 'closed'); expect((await fails(callIn(U.nurse, closed.e)))?.code).toBe('55000');
    expect((await fails(callIn(U.nurse, randomUUID())))?.code).toBe('P0002');
  });
  it('an encounter that has not been assessed has no queue entry and cannot be called in', async () => {
    const e = randomUUID(); await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1, $2, $3, 'submitted')`, [e, P, F1]);
    expect((await fails(callIn(U.nurse, e)))?.code).toBe('55000');
  });
});

describe('completing the visit', () => {
  it('treated here: needs the priority reviewed first; then the queue entry is seen and the encounter closed with the outcome', async () => {
    const { e, a } = await make('in_review', 'in_review');
    expect(await fails(complete(U.nurse, e, 'treated_here'))).toMatchObject({ code: '55000', hint: 'review_first' });
    await review(e, a); const r = await complete(U.nurse, e, 'treated_here');
    expect(r).toMatchObject({ outcome: 'treated_here', queueStatus: 'seen' }); expect(await q(e)).toMatchObject({ s: 'seen' }); expect((await q(e)).completed_at).not.toBeNull();
    expect(await enc(e)).toMatchObject({ s: 'closed', outcome: 'treated_here', closed_by: U.nurse }); expect((await enc(e)).closed_at).not.toBeNull();
    expect((await lastAudit()).details).toMatchObject({ op: 'complete_visit', outcome: 'treated_here' });
  });
  it('sent home leaves the queue as closed', async () => {
    const { e, a } = await make(); await review(e, a, U.doctor); await complete(U.doctor, e, 'sent_home'); expect(await q(e)).toMatchObject({ s: 'closed' }); expect((await enc(e)).outcome).toBe('sent_home');
  });
  it('a review of an OLDER assessment is not enough: the current one must be reviewed', async () => {
    const { e, a } = await make(); await review(e, a);
    await db.query(`insert into public.triage_assessments (encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version) values ($1, 2, $2, 'rules_engine', 'red', '{}'::jsonb, 'fp2', 'test')`, [e, RS]);
    expect((await fails(complete(U.nurse, e, 'treated_here')))?.hint).toBe('review_first');
  });
  it('did not wait needs no review, and a health worker may record it', async () => {
    const { e } = await make(); await complete(U.hw, e, 'did_not_wait'); expect(await q(e)).toMatchObject({ s: 'no_show' }); expect((await enc(e)).outcome).toBe('did_not_wait');
  });
  it('a health worker cannot complete a visit as treated or sent home', async () => {
    const { e, a } = await make(); await review(e, a); expect((await fails(complete(U.hw, e, 'treated_here')))?.code).toBe('42501'); expect((await enc(e)).s).toBe('submitted');
  });
  it('strangers, other facilities and administrators cannot complete anything', async () => {
    const { e, a } = await make(); await review(e, a);
    for (const u of [U.outsider, U.other, U.admin]) { expect((await fails(complete(u, e, 'treated_here')))?.code, u).toBe('42501'); expect((await fails(complete(u, e, 'did_not_wait')))?.code, u).toBe('42501'); }
  });
  it('a referral is not completed here, and an unknown outcome is refused', async () => {
    const { e, a } = await make(); await review(e, a);
    expect((await fails(complete(U.nurse, e, 'referred')))?.code).toBe('22023'); expect((await fails(complete(U.nurse, e, 'cured')))?.code).toBe('22023');
  });
  it('a finished, referred or unknown encounter cannot be completed again', async () => {
    const { e, a } = await make(); await review(e, a); await complete(U.nurse, e, 'treated_here'); expect((await fails(complete(U.nurse, e, 'treated_here')))?.code).toBe('55000');
    const ref = await make('referred', 'referred'); expect((await fails(complete(U.nurse, ref.e, 'did_not_wait')))?.code).toBe('55000');
    expect((await fails(complete(U.nurse, randomUUID(), 'did_not_wait')))?.code).toBe('P0002');
  });
  it('an outcome outside the allowed list cannot be written directly', async () => {
    const { e } = await make(); expect((await fails(db.query(`update public.encounters set outcome = 'cured' where id = $1`, [e])))?.code).toBe('23514');
  });
});

describe('the functions are not callable by ordinary users', () => {
  it('execute is revoked from anon and authenticated', async () => {
    for (const fn of ['app.call_in(uuid, uuid)', 'app.complete_visit(uuid, uuid, text)']) {
      const r = await rows(`select has_function_privilege('authenticated', '${fn}', 'execute') a, has_function_privilege('anon', '${fn}', 'execute') b, has_function_privilege('service_role', '${fn}', 'execute') c`);
      expect(r[0]).toEqual({ a: false, b: false, c: true });
    }
  });
});
