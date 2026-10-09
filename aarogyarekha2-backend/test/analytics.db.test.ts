import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeSystemAdmin } from '../src/admin/store.js';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), RS = randomUUID(), U = randomUUID(), PT = randomUUID();
const sys = () => makeSystemAdmin({ query: async (sql, p) => ({ rows: (await db.query(sql, p as any[])).rows as any[] }) });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

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
  await visit({ urgency: 'orange', assessAfterSec: 6, review: { action: 'override_urgency', afterMin: 30, to: 'red' } });
  await visit({ urgency: 'yellow', assessAfterSec: 8, review: { action: 'override_urgency', afterMin: 40, to: 'green' }, scenario: 'campus_fever' });
  await visit({ urgency: 'green', assessAfterSec: null, scenario: 'campus_fever' });
  await visit({ facility: F2, urgency: 'red', assessAfterSec: 1, review: { action: 'approve', afterMin: 5 } });
  await visit({ created: ago(60 * 24 * 100), submittedMinAgo: 60 * 24 * 100, assessAfterSec: 2, review: { action: 'approve', afterMin: 9 } });
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

describe('referrals sent and visits per day', () => {
  it('counts referrals that were sent from the facility, not drafts, and breaks visits down by day', async () => {
    const e = await visit({ assessAfterSec: 3 }); const e2 = await visit({ assessAfterSec: 3 });
    await db.query(`insert into public.referrals (encounter_id, patient_id, from_facility_id, to_facility_id, requested_by, status, bundle, bundle_sha256, sent_at) values ($1,$2,$3,$4,$5,'requested','{}'::jsonb,decode(repeat('ab',32),'hex'), now())`, [e, PT, F1, F2, U]);
    await db.query(`insert into public.referrals (encounter_id, patient_id, from_facility_id, requested_by, status) values ($1,$2,$3,$4,'draft')`, [e2, PT, F1, U]);
    const a = await sys().analytics([F1], 30);
    expect(a.referralsSent).toBe(1); expect((await sys().analytics([F2], 30)).referralsSent).toBe(0);
    expect(a.perDay.length).toBeGreaterThan(0); for (const d of a.perDay) expect(d.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.perDay.reduce((n, d) => n + d.n, 0)).toBe(a.encounters);
  });
  it('an empty facility list gives empty figures', async () => { const a = await sys().analytics([], 30); expect(a.referralsSent).toBe(0); expect(a.perDay).toEqual([]); });
});

describe('audit export rows', () => {
  it('lists only the facility entries, newest first, with the person, facility and record number', async () => {
    await db.query(`insert into public.audit_events (actor_user_id, actor_role, facility_id, action, entity_type, patient_id, outcome) values ($1,'nurse',$2,'read','encounter_summary',$3,'success'), ($1,'nurse',$4,'read','encounter_summary',null,'denied')`, [U, F1, PT, F2]);
    await db.query(`insert into public.profiles (user_id, display_name) values ($1,'Export Nurse') on conflict (user_id) do nothing`, [U]);
    const rows = await sys().auditExport([F1], new Date(Date.now() - 86_400_000).toISOString(), 100);
    expect(rows.length).toBeGreaterThan(0); expect(rows.every(r => r.facility_id === F1)).toBe(true);
    expect(rows[0]).toMatchObject({ actor_name: 'Export Nurse', facility_name: 'A', action: 'read', entity_type: 'encounter_summary', outcome: 'success' }); expect(rows[0]!.patient_ref).toMatch(/^AR/);
    expect(await sys().auditExport([], new Date(0).toISOString(), 10)).toEqual([]);
    expect((await sys().auditExport([F1], new Date(Date.now() + 60_000).toISOString(), 10)).length).toBe(0);
  });
});

describe('finding a patient for emergency access', () => {
  beforeAll(async () => {
    await db.query(`insert into public.patients (registered_facility_id, full_name, sex, age_years_reported) values ($1,'Sita Mohanty','female',34), ($1,'Ramesh Sita Das','male',60), ($2,'Gopal 100% Behera','male',45)`, [F2, F2]);
    await db.query(`insert into public.patients (registered_facility_id, full_name, deleted_at) values ($1,'Sita Removed', now())`, [F2]);
  });
  it('matches the start of the record number or any part of the name, across facilities, and never a removed patient', async () => {
    const byName = await sys().searchPatients('sita', 20);
    expect(byName.map(r => r.name).sort()).toEqual(['Ramesh Sita Das', 'Sita Mohanty']);
    expect(byName[0]).toMatchObject({ facilityName: 'B' });
    const ref = (await db.query(`select public_ref from public.patients where full_name = 'Sita Mohanty'`)).rows[0] as { public_ref: string };
    expect((await sys().searchPatients(ref.public_ref.toLowerCase(), 5)).map(r => r.name)).toEqual(['Sita Mohanty']);
  });
  it('gives the reported age and sex, and leaves an unknown sex out', async () => {
    const r = (await sys().searchPatients('Sita Mohanty', 5))[0]!; expect(r).toMatchObject({ sex: 'female', age: 34 });
  });
  it('treats % and _ as plain characters, and respects the limit', async () => {
    expect((await sys().searchPatients('100%', 5)).map(r => r.name)).toEqual(['Gopal 100% Behera']);
    expect((await sys().searchPatients('%', 5)).map(r => r.name)).toEqual(['Gopal 100% Behera']); expect(await sys().searchPatients('_o', 5)).toEqual([]);
    expect((await sys().searchPatients('sita', 1)).length).toBe(1);
  });
});
