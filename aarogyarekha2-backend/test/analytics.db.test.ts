// Administrator figures (counts and timings) against the REAL schema in an in-process Postgres.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeSystemAdmin } from '../src/admin/store.js';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), RS = randomUUID(), U = randomUUID(), PT = randomUUID();
const sys = () => makeSystemAdmin({ query: async (sql, p) => ({ rows: (await db.query(sql, p as any[])).rows as any[] }) });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** An encounter submitted `submittedMinAgo` ago; assessed `assessAfterSec` later; reviewed `reviewAfterMin` after it joined the queue. */
async function visit(o: { facility?: string; scenario?: string; urgency?: string; submittedMinAgo?: number; assessAfterSec?: number | null; review?: { action: 'approve' | 'override_urgency'; afterMin: number; to?: string } | null; created?: string }) {
  const e = randomUUID(), f = o.facility ?? F1; const sub = o.submittedMinAgo ?? 120;
  await db.query(`insert into public.encounters (id, patient_id, facility_id, scenario, status, submitted_at, created_at) values ($1,$2,$3,$4,'submitted',$5,$6)`, [e, PT, f, o.scenario ?? 'opd_queue', ago(sub), o.created ?? ago(sub + 5)]);
  if (o.assessAfterSec !== null) {
    const a = randomUUID(); const urg = o.urgency ?? 'orange';
    await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version, created_at) values ($1,$2,1,$3,'rules_engine',$4,'{}'::jsonb,'fp','t',$5)`, [a, e, RS, urg, new Date(Date.now() - sub * 60_000 + (o.assessAfterSec ?? 2) * 1000).toISOString()]);
    await db.query(`insert into public.queue_items (encounter_id, facility_id, urgency_code, entered_at) values ($1,$2,$3,$4)`, [e, f, urg, ago(sub)]);
    if (o.review) await db.query(`insert into public.review_actions (encounter_id, assessment_id, reviewer_id, action, from_urgency_code, to_urgency_code, reason, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e, a, U, o.review.action, urg, o.review.action === 'override_urgency' ? o.review.to : null, o.review.action === 'override_urgency' ? '[clinical_judgement] test reason' : null, new Date(Date.now() - sub * 60_000 + o.review.afterMin * 60_000).toISOString()]);
  }
  return e;
}

beforeAll(async () => {
  db = await makeDb();
  await db.query(`insert into auth.users (id, email) values ($1,'r@t.test')`, [U]);
  await db.query(`insert into public.facilities (id, name, type) values ($1,'A','phc'), ($2,'B','phc')`, [F1, F2]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1,$2,'Analytics Test')`, [PT, F1]);
  await db.query(`insert into public.triage_rule_sets (id, name, version, status, source_citation, definition, approved_at) values ($1,'t','1','approved','TEST','{}'::jsonb, now())`, [RS]);
  await visit({ urgency: 'red', assessAfterSec: 2, review: { action: 'approve', afterMin: 10 } });
  await visit({ urgency: 'orange', assessAfterSec: 4, review: { action: 'approve', afterMin: 20 } });
  await visit({ urgency: 'orange', assessAfterSec: 6, review: { action: 'override_urgency', afterMin: 30, to: 'red' } });          // raised
  await visit({ urgency: 'yellow', assessAfterSec: 8, review: { action: 'override_urgency', afterMin: 40, to: 'green' }, scenario: 'campus_fever' });   // lowered
  await visit({ urgency: 'green', assessAfterSec: null, scenario: 'campus_fever' });                                                    // submitted, never assessed
  await visit({ facility: F2, urgency: 'red', assessAfterSec: 1, review: { action: 'approve', afterMin: 5 } });                         // another facility
  await visit({ created: ago(60 * 24 * 100), submittedMinAgo: 60 * 24 * 100, assessAfterSec: 2, review: { action: 'approve', afterMin: 9 } });   // too old for 30 days
});

describe('analytics', () => {
  it('counts only the asked facilities and the asked period', async () => {
    const a = await sys().analytics([F1], 30);
    expect(a).toMatchObject({ days: 30, encounters: 5, submitted: 5, assessed: 4, reviewed: 4 });
    expect((await sys().analytics([F1, F2], 30)).encounters).toBe(6); expect((await sys().analytics([F2], 30)).encounters).toBe(1); expect((await sys().analytics([F1], 90)).encounters).toBe(5); expect((await sys().analytics([F1], 365 > 90 ? 90 : 90)).days).toBe(90);
  });
  it('splits by visit type and by the latest rules priority', async () => {
    const a = await sys().analytics([F1], 30);
    expect(Object.fromEntries(a.byScenario.map(x => [x.scenario, x.n]))).toEqual({ opd_queue: 3, campus_fever: 2 }); expect(Object.fromEntries(a.byUrgency.map(x => [x.urgency, x.n]))).toEqual({ red: 1, orange: 2, yellow: 1 });
  });
  it('time to assessment: median and 90th percentile in seconds', async () => {
    const t = (await sys().analytics([F1], 30)).secondsToAssessment; expect(t.n).toBe(4); expect(t.median).toBeCloseTo(5, 0); expect(t.p90).toBeGreaterThan(6); expect(t.p90).toBeLessThanOrEqual(8);
  });
  it('wait until a reviewer acts: median and 90th percentile in minutes', async () => {
    const t = (await sys().analytics([F1], 30)).minutesToReview; expect(t.n).toBe(4); expect(t.median).toBeCloseTo(25, 0); expect(t.p90).toBeGreaterThan(30); expect(t.p90).toBeLessThanOrEqual(40);
  });
  it('agreement: confirmations over all decisions, with how many changes made it LESS urgent', async () => {
    const r = (await sys().analytics([F1], 30)).review; expect(r).toEqual({ approved: 2, changed: 2, loweredBelowRules: 1, agreementRate: 0.5 });
  });
  it('feedback is null when there is none to count, and counts when there is', async () => {
    const a = await sys().analytics([F1], 30); expect(a.feedback).toEqual({ helpful: 0, notHelpful: 0 });
  });
  it('no facilities, or no activity, gives zeros and no invented rates', async () => {
    expect(await sys().analytics([], 30)).toMatchObject({ encounters: 0, review: { agreementRate: null }, secondsToAssessment: { n: 0, median: null } });
    const none = await sys().analytics([randomUUID()], 30); expect(none).toMatchObject({ encounters: 0, reviewed: 0, review: { approved: 0, changed: 0, agreementRate: null }, minutesToReview: { n: 0, median: null, p90: null } });
  });
  it('contains nothing that identifies a person', async () => { expect(JSON.stringify(await sys().analytics([F1], 30))).not.toMatch(/Analytics Test|r@t\.test|[0-9a-f]{8}-[0-9a-f]{4}-/); });
});
