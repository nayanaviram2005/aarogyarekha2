// Exercises app.record_review (migration 0013) against the REAL schema in an in-process Postgres.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), P = randomUUID(), RS = randomUUID();
const U = { nurse: randomUUID(), doctor: randomUUID(), hw: randomUUID(), other: randomUUID(), outsider: randomUUID() };

const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const review = (u: string, e: string, a: string, action: string, to: string | null = null, reason: string | null = null, confirm = false) =>
  rows(`select app.record_review($1::uuid, $2::uuid, $3::uuid, $4::public.review_action_type, $5, $6, $7) as r`, [u, e, a, action, to, reason, confirm]).then(r => r[0].r);
/** Runs a call and returns the Postgres error (code, message, hint) instead of throwing. */
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { const x = e as { code?: string; message: string; hint?: string }; return { code: x.code, message: x.message, hint: x.hint }; } };

/** A fresh encounter with an assessment (rules said `urgency`) and a queue entry. */
async function make(urgency: 'red' | 'orange' | 'yellow' | 'green' = 'orange', layer = 'floor', status = 'submitted') {
  const e = randomUUID(), a = randomUUID();
  await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1, $2, $3, $4)`, [e, P, F1, status]);
  await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version)
                  values ($1, $2, 1, $3, 'rules_engine', $4, $5::jsonb, 'fp', 'test')`, [a, e, RS, urgency, JSON.stringify({ winning: { layer, ruleId: 'X' } })]);
  await db.query(`insert into public.queue_items (encounter_id, facility_id, urgency_code) values ($1, $2, $3)`, [e, F1, urgency]);
  return { e, a };
}
const queue = async (e: string) => (await rows(`select urgency_code, status from public.queue_items where encounter_id = $1`, [e]))[0];
const status = async (e: string) => (await rows(`select status from public.encounters where id = $1`, [e]))[0].status as string;
const actions = (e: string) => rows(`select * from public.review_actions where encounter_id = $1 order by created_at, id`, [e]);

beforeAll(async () => {
  db = await makeDb();
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${k}@t.test`]);
  await db.query(`insert into public.facilities (id, name, type) values ($1, 'PHC', 'phc'), ($2, 'DH', 'district_hospital')`, [F1, F2]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1, $2, 'Test Patient')`, [P, F1]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$3,'nurse'), ($2,$3,'doctor'), ($4,$3,'health_worker'), ($5,$6,'doctor')`, [U.nurse, U.doctor, F1, U.hw, U.other, F2]);
  await db.query(`insert into public.triage_rule_sets (id, name, version, status, source_citation, definition, approved_at) values ($1, 't', '1', 'approved', 'TEST FIXTURE', '{}'::jsonb, now())`, [RS]);
});

describe('who may review', () => {
  it('a health worker cannot sign off', async () => {
    const { e, a } = await make();
    expect(await fails(review(U.hw, e, a, 'approve'))).toMatchObject({ code: '42501' });
    expect(await actions(e)).toHaveLength(0);
  });
  it('a user with no membership cannot', async () => {
    const { e, a } = await make();
    expect(await fails(review(U.outsider, e, a, 'approve'))).toMatchObject({ code: '42501' });
  });
  it('a doctor at ANOTHER facility cannot', async () => {
    const { e, a } = await make();
    expect(await fails(review(U.other, e, a, 'approve'))).toMatchObject({ code: '42501' });
    expect(await actions(e)).toHaveLength(0);
  });
  it('a deactivated membership cannot', async () => {
    const u = randomUUID();
    await db.query(`insert into auth.users (id, email) values ($1, 'gone@t.test')`, [u]);
    await db.query(`insert into public.memberships (user_id, facility_id, role, is_active) values ($1, $2, 'nurse', false)`, [u, F1]);
    const { e, a } = await make();
    expect(await fails(review(u, e, a, 'approve'))).toMatchObject({ code: '42501' });
  });
  it('a nurse and a doctor can', async () => {
    const m = await make(); expect((await review(U.nurse, m.e, m.a, 'approve')).action).toBe('approve');
    const n = await make(); expect((await review(U.doctor, n.e, n.a, 'approve')).action).toBe('approve');
  });
});

describe('approve', () => {
  it('records the decision, keeps the urgency, and moves the encounter and queue into review', async () => {
    const { e, a } = await make('orange');
    const r = await review(U.nurse, e, a, 'approve');
    expect(r).toMatchObject({ effectiveUrgency: 'orange', fromUrgency: 'orange', downgrade: false });
    const [row] = await actions(e);
    expect(row).toMatchObject({ action: 'approve', reviewer_id: U.nurse, assessment_id: a, from_urgency_code: 'orange', to_urgency_code: 'orange' });
    expect(await queue(e)).toEqual({ urgency_code: 'orange', status: 'in_review' });
    expect(await status(e)).toBe('in_review');
  });
  it('cannot be approved twice, even by someone else', async () => {
    const { e, a } = await make();
    await review(U.nurse, e, a, 'approve');
    expect(await fails(review(U.doctor, e, a, 'approve'))).toMatchObject({ code: '23505' });
    expect(await actions(e)).toHaveLength(1);
  });
  it('is refused when a newer assessment exists (the reviewer saw an old one), and works against the new one', async () => {
    const { e, a } = await make();
    const a2 = randomUUID();
    await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version)
                    values ($1, $2, 2, $3, 'rules_engine', 'red', '{}'::jsonb, 'fp2', 'test')`, [a2, e, RS]);
    expect(await fails(review(U.nurse, e, a, 'approve'))).toMatchObject({ code: '40001' });
    expect(await actions(e)).toHaveLength(0);
    expect((await review(U.nurse, e, a2, 'approve')).action).toBe('approve');
  });
  it('a new assessment after sign-off needs a fresh review', async () => {
    const { e, a } = await make();
    await review(U.nurse, e, a, 'approve');
    const a2 = randomUUID();
    await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version)
                    values ($1, $2, 2, $3, 'rules_engine', 'red', '{}'::jsonb, 'fp2', 'test')`, [a2, e, RS]);
    expect((await review(U.doctor, e, a2, 'approve')).action).toBe('approve');
  });
});

describe('override', () => {
  it('raising the priority needs a reason and updates the queue', async () => {
    const { e, a } = await make('orange');
    const r = await review(U.doctor, e, a, 'override_urgency', 'red', 'Looks worse than the numbers show');
    expect(r).toMatchObject({ effectiveUrgency: 'red', fromUrgency: 'orange', rulesUrgency: 'orange', downgrade: false, belowRuleFloor: false });
    expect((await queue(e)).urgency_code).toBe('red');
    expect((await actions(e))[0]).toMatchObject({ action: 'override_urgency', from_urgency_code: 'orange', to_urgency_code: 'red' });
  });
  it('lowering below what the rules set is refused without confirmation, with a hint', async () => {
    const { e, a } = await make('orange');
    expect(await fails(review(U.doctor, e, a, 'override_urgency', 'green', 'Patient is comfortable and talking'))).toMatchObject({ code: '22023', hint: 'confirm_downgrade' });
    expect((await queue(e)).urgency_code).toBe('orange');
    expect(await actions(e)).toHaveLength(0);
  });
  it('lowering with confirmation works, and is flagged as below a rule floor when a danger-sign rule set the priority', async () => {
    const { e, a } = await make('orange', 'floor');
    const r = await review(U.doctor, e, a, 'override_urgency', 'yellow', 'Danger sign was entered by mistake', true);
    expect(r).toMatchObject({ effectiveUrgency: 'yellow', downgrade: true, belowRuleFloor: true });
    expect((await queue(e)).urgency_code).toBe('yellow');
  });
  it('lowering a score-based priority is a downgrade but not "below a rule floor"', async () => {
    const { e, a } = await make('orange', 'news2');
    expect(await review(U.doctor, e, a, 'override_urgency', 'yellow', 'Reading was taken while the child cried', true)).toMatchObject({ downgrade: true, belowRuleFloor: false });
  });
  it('moving back to what the rules said is not a downgrade', async () => {
    const { e, a } = await make('orange');
    await review(U.doctor, e, a, 'override_urgency', 'red', 'Escalating on clinical judgement');
    expect(await review(U.nurse, e, a, 'override_urgency', 'orange', 'On review, the earlier concern has settled')).toMatchObject({ downgrade: false });
  });
  it.each([
    ['the same priority', 'orange', 'A perfectly good reason'],
    ['an unknown level', 'purple', 'A perfectly good reason'],
    ['a missing reason', 'red', null],
    ['a short reason', 'red', 'too short'],
    ['a blank reason', 'red', '          '],
  ])('rejects %s', async (_n, to, reason) => {
    const { e, a } = await make('orange');
    expect(await fails(review(U.doctor, e, a, 'override_urgency', to, reason as string | null))).toMatchObject({ code: '22023' });
    expect(await actions(e)).toHaveLength(0);
  });
});

describe('state checks', () => {
  it.each(['closed', 'cancelled', 'referred', 'reviewed', 'draft'])('refuses an encounter that is %s', async st => {
    const { e, a } = await make('orange', 'floor', st);
    expect(await fails(review(U.nurse, e, a, 'approve'))).toMatchObject({ code: '55000' });
  });
  it('refuses when there is no assessment yet', async () => {
    const e = randomUUID();
    await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1, $2, $3, 'submitted')`, [e, P, F1]);
    expect(await fails(review(U.nurse, e, randomUUID(), 'approve'))).toMatchObject({ code: '55000' });
  });
  it('refuses an unknown encounter', async () => {
    expect(await fails(review(U.nurse, randomUUID(), randomUUID(), 'approve'))).toMatchObject({ code: 'P0002' });
  });
  it('refuses actions other than approve and override', async () => {
    const { e, a } = await make();
    expect(await fails(review(U.nurse, e, a, 'close'))).toMatchObject({ code: '22023' });
    expect(await fails(review(U.nurse, e, a, 'comment'))).toMatchObject({ code: '22023' });
  });
});

describe('integrity and permissions', () => {
  it('review rows cannot be edited or deleted afterwards', async () => {
    const { e, a } = await make();
    await review(U.nurse, e, a, 'approve');
    expect(await fails(db.query(`update public.review_actions set reason = 'x' where encounter_id = $1`, [e]))).not.toBeNull();
    expect(await fails(db.query(`delete from public.review_actions where encounter_id = $1`, [e]))).not.toBeNull();
  });
  it('a failed review changes nothing (all or nothing)', async () => {
    const { e, a } = await make('orange');
    await fails(review(U.doctor, e, a, 'override_urgency', 'green', 'Looks fine to me, honestly'));   // refused: unconfirmed downgrade
    expect(await status(e)).toBe('submitted');
    expect(await queue(e)).toEqual({ urgency_code: 'orange', status: 'waiting' });
  });
  it.each(['authenticated', 'anon'])('the role %s cannot call the function directly', async role => {
    const { e, a } = await make();
    await db.exec(`set role ${role}`);
    const err = await fails(review(U.nurse, e, a, 'approve'));
    await db.exec('reset role');
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/permission denied/i);
    expect(await actions(e)).toHaveLength(0);
  });
});

// The error mapping used by the API, exercised against the REAL database errors.
import { recordReview, ReviewError } from '../src/review/record.js';
describe('recordReview: database errors become the right plain failures', () => {
  const pool = () => ({ connect: async () => ({ query: async (sql: string, params?: unknown[]) => ({ rows: (await db.query(sql, params as any[])).rows as any[] }), release() {} }) });
  const kind = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ReviewError ? e.kind : `other:${(e as Error).message}`; } };

  it('success returns the decision details', async () => {
    const { e, a } = await make('orange');
    expect(await recordReview(pool(), { reviewerId: U.nurse, encounterId: e, assessmentId: a, action: 'approve' })).toMatchObject({ action: 'approve', effectiveUrgency: 'orange', facilityId: F1, patientId: P });
  });
  it('maps every refusal to its kind', async () => {
    const m = await make('orange');
    expect(await kind(recordReview(pool(), { reviewerId: U.hw, encounterId: m.e, assessmentId: m.a, action: 'approve' }))).toBe('forbidden');
    expect(await kind(recordReview(pool(), { reviewerId: U.nurse, encounterId: randomUUID(), assessmentId: m.a, action: 'approve' }))).toBe('not_found');
    expect(await kind(recordReview(pool(), { reviewerId: U.nurse, encounterId: m.e, assessmentId: randomUUID(), action: 'approve' }))).toBe('stale');
    expect(await kind(recordReview(pool(), { reviewerId: U.doctor, encounterId: m.e, assessmentId: m.a, action: 'override_urgency', toUrgency: 'green', reason: 'Patient is comfortable and talking' }))).toBe('confirm_downgrade');
    expect(await kind(recordReview(pool(), { reviewerId: U.doctor, encounterId: m.e, assessmentId: m.a, action: 'override_urgency', toUrgency: 'orange', reason: 'Patient is comfortable and talking' }))).toBe('invalid');
    await recordReview(pool(), { reviewerId: U.nurse, encounterId: m.e, assessmentId: m.a, action: 'approve' });
    expect(await kind(recordReview(pool(), { reviewerId: U.doctor, encounterId: m.e, assessmentId: m.a, action: 'approve' }))).toBe('already_reviewed');
    const c = await make('orange', 'floor', 'closed');
    expect(await kind(recordReview(pool(), { reviewerId: U.nurse, encounterId: c.e, assessmentId: c.a, action: 'approve' }))).toBe('wrong_state');
  });
  it('never exposes the database message', async () => {
    const m = await make('orange');
    const err = await recordReview(pool(), { reviewerId: U.hw, encounterId: m.e, assessmentId: m.a, action: 'approve' }).catch(x => x as ReviewError) as ReviewError;
    expect(err.message).not.toMatch(/membership|facility_id|public\./);
  });
});
