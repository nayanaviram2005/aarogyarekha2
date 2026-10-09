import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { MockSender, runDueReminders } from '../src/reminders/core.js';
import { makeReminderStore } from '../src/reminders/store.js';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F = randomUUID();
const store = () => makeReminderStore({ query: async (sql, p) => ({ rows: (await db.query(sql, p as any[])).rows as any[] }) });
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const NOW = new Date('2026-10-20T06:00:00Z');

async function setup(o: { lang?: string; phone?: string | null; consent?: 'active' | 'revoked' | 'expired'; active?: boolean; due?: string; cadence?: number | null; channel?: string; status?: string } = {}) {
  const pt = randomUUID(), sc = randomUUID(), rm = randomUUID(), cs = randomUUID();
  await db.query(`insert into public.patients (id, registered_facility_id, full_name, preferred_language, phone) values ($1,$2,'Test Patient',$3,$4)`, [pt, F, o.lang ?? 'en', o.phone === undefined ? '+919876543210' : o.phone]);
  const c = o.consent ?? 'active';
  await db.query(`insert into public.consents (id, patient_id, purpose, given_by, method, notice_version, granted_at, revoked_at, expires_at) values ($1,$2,'reminders','self','paper','v1', '2026-10-01T00:00:00Z', $3, $4)`,
    [cs, pt, c === 'revoked' ? '2026-10-10T00:00:00Z' : null, c === 'expired' ? '2026-10-15T00:00:00Z' : null]);
  await db.query(`insert into public.followup_schedules (id, patient_id, facility_id, kind, cadence_days, next_due_at, active) values ($1,$2,$3,'anc_visit',$4,$5,$6)`, [sc, pt, F, o.cadence ?? null, o.due ?? '2026-10-20T04:00:00Z', o.active ?? true]);
  await db.query(`insert into public.reminders (id, schedule_id, consent_id, due_at, channel, status) values ($1,$2,$3,$4,$5,$6)`, [rm, sc, cs, o.due ?? '2026-10-20T04:00:00Z', o.channel ?? 'sms', o.status ?? 'scheduled']);
  return { rm, sc, pt };
}
const status = async (id: string) => (await rows(`select status, sent_at from public.reminders where id = $1`, [id]))[0];

beforeAll(async () => {
  db = await makeDb();
  await db.query(`insert into public.facilities (id, name, type) values ($1, 'Seed PHC Khordha', 'phc')`, [F]);
});

describe('claimDue', () => {
  it('takes a due reminder with what the sender needs, and marks it sent at once so nobody can take it again', async () => {
    const a = await setup({ lang: 'hi' });
    const got = (await store().claimDue(NOW, 100)).find(x => x.id === a.rm)!;
    expect(got).toMatchObject({ channel: 'sms', facilityName: 'Seed PHC Khordha', language: 'hi', phone: '+919876543210', consentActive: true });
    expect(got.dueAt).toBe('2026-10-20T04:00:00.000Z');
    expect((await status(a.rm)).status).toBe('sent');
    expect((await store().claimDue(NOW, 100)).some(x => x.id === a.rm)).toBe(false);
  });
  it('leaves alone: future ones, already-sent ones, and ones whose follow-up was stopped', async () => {
    const future = await setup({ due: '2026-10-25T00:00:00Z' }), sent = await setup({ status: 'sent' }), stopped = await setup({ active: false });
    const ids = (await store().claimDue(NOW, 100)).map(x => x.id);
    for (const x of [future, sent, stopped]) expect(ids).not.toContain(x.rm);
    expect((await status(future.rm)).status).toBe('scheduled'); expect((await status(stopped.rm)).status).toBe('scheduled');
  });
  it('reports consent as not active when it was revoked or has expired since scheduling', async () => {
    const rev = await setup({ consent: 'revoked' }), exp = await setup({ consent: 'expired' }), ok = await setup();
    const got = await store().claimDue(NOW, 100);
    expect(got.find(x => x.id === rev.rm)!.consentActive).toBe(false);
    expect(got.find(x => x.id === exp.rm)!.consentActive).toBe(false);
    expect(got.find(x => x.id === ok.rm)!.consentActive).toBe(true);
  });
  it('respects the batch limit and takes the oldest first', async () => {
    await rows(`delete from public.reminders`);
    const old = await setup({ due: '2026-10-01T00:00:00Z' }), mid = await setup({ due: '2026-10-10T00:00:00Z' }); await setup({ due: '2026-10-19T00:00:00Z' });
    const got = await store().claimDue(NOW, 2);
    expect(got.map(x => x.id)).toEqual([old.rm, mid.rm]);
  });
  it('a missing phone comes back as null, not "null"', async () => {
    await rows(`delete from public.reminders`);
    const a = await setup({ phone: null, channel: 'in_app' });
    expect((await store().claimDue(NOW, 10)).find(x => x.id === a.rm)!.phone).toBeNull();
  });
});

describe('marking', () => {
  it('markFailed turns it into failed and clears the sent time', async () => {
    const a = await setup(); await store().claimDue(NOW, 100);
    await store().markFailed(a.rm);
    expect(await status(a.rm)).toMatchObject({ status: 'failed', sent_at: null });
  });
  it('markSent moves a repeating schedule on by its cadence from the last due date, once', async () => {
    const a = await setup({ cadence: 28 }); await store().markSent(a.rm, NOW);
    expect((await rows(`select next_due_at from public.followup_schedules where id = $1`, [a.sc]))[0].next_due_at.toISOString()).toBe('2026-11-17T04:00:00.000Z');
    await store().markSent(a.rm, NOW);
    expect((await rows(`select next_due_at from public.followup_schedules where id = $1`, [a.sc]))[0].next_due_at.toISOString()).toBe('2026-11-17T04:00:00.000Z');
  });
  it('a one-off schedule keeps its date', async () => {
    const a = await setup({ cadence: null }); await store().markSent(a.rm, NOW);
    expect((await rows(`select next_due_at from public.followup_schedules where id = $1`, [a.sc]))[0].next_due_at.toISOString()).toBe('2026-10-20T04:00:00.000Z');
  });
});

describe('the whole run', () => {
  it('sends the consented ones through the mock, skips the withdrawn, and leaves the right statuses', async () => {
    await rows(`delete from public.reminders`);
    const good = await setup({ lang: 'or' }), gone = await setup({ consent: 'revoked' });
    const m = new MockSender();
    const r = await runDueReminders(store(), m, NOW);
    expect(r).toEqual({ claimed: 2, sent: 1, failed: 1, skippedNoConsent: 1 });
    expect((await status(good.rm)).status).toBe('sent'); expect((await status(gone.rm)).status).toBe('failed');
    expect(m.sent).toHaveLength(1); expect(m.sent[0]!.text).toMatch(/[଀-୿]/);
  });
});
