import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { VisitError, type AuditEvent, type Deps, type DoneRow, type UserReader, type UserWriter, type VisitFlow } from '../src/deps.js';
import type { EncounterRow } from '../src/fhir/project.js';

const F1 = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const mem = (role: string) => ({ facilityId: F1, facilityName: 'F', facilityType: 'phc', role });
const enc = { id: E, patient_id: 'p', facility_id: F1, status: 'in_review' } as unknown as EncounterRow;
const doneRow: DoneRow = { encounterId: E, facilityId: F1, patientRef: 'AR-0001', patientName: 'Test Patient', sex: 'female', urgencyCode: 'orange', outcome: 'treated_here', finishedAt: '2026-10-08T05:00:00.000Z', by: 'Nurse Das', waitedMinutes: 25 };

interface World { members: Record<string, ReturnType<typeof mem>[]>; calls: { op: string; a: any }[]; fail: VisitError | null; requireMfa: boolean; auditLog: AuditEvent[]; absent: boolean; hidden: boolean }
let w: World;

const make = async () => {
  const reader = (t: string): UserReader => ({
    getEncounter: async () => (w.hidden ? null : enc), getMe: async () => ({ displayName: null, memberships: w.members[t] ?? [] }),
  } as unknown as UserReader);
  const visitFlow: VisitFlow = {
    callIn: async a => { w.calls.push({ op: 'callIn', a }); if (w.fail) throw w.fail; return { status: 'in_review' }; },
    complete: async a => { w.calls.push({ op: 'complete', a }); if (w.fail) throw w.fail; return { outcome: a.outcome, queueStatus: a.outcome === 'treated_here' ? 'seen' : a.outcome === 'sent_home' ? 'closed' : 'no_show' }; },
    done: async (f, hours) => { w.calls.push({ op: 'done', a: { f, hours } }); return [doneRow]; },
  };
  const deps = {
    verifyToken: async (t: string) => (t in w.members ? { userId: 'u-' + t, aal: t === 'nurse1' ? 'aal1' : 'aal2' } : null), userReader: reader, userWriter: () => ({}) as UserWriter,
    ...(w.absent ? {} : { visitFlow }), audit: async (e: AuditEvent) => { w.auditLog.push(e); },
  } as unknown as Deps;
  return buildApp({ allowedOrigins: [], requireMfa: w.requireMfa }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, token: string | null, body?: object) => app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => { w = { members: { nurse: [mem('nurse')], nurse1: [mem('nurse')], hw: [mem('health_worker')], admin: [mem('facility_admin')] }, calls: [], fail: null, requireMfa: false, auditLog: [], absent: false, hidden: false }; });

describe('calling in', () => {
  it('calls the patient in as the caller', async () => {
    const r = await call(await make(), 'POST', `/encounters/${E}/call-in`, 'hw');
    expect(r.statusCode).toBe(200); expect(w.calls[0]).toEqual({ op: 'callIn', a: { actor: 'u-hw', encounterId: E } }); expect(r.json()).toMatchObject({ status: 'in_review' });
  });
  it('needs a login, a valid id, and a record the caller can see (404 otherwise)', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/call-in`, null)).statusCode).toBe(401); expect((await call(app, 'POST', '/encounters/nope/call-in', 'hw')).statusCode).toBe(400);
    w.hidden = true; expect((await call(await make(), 'POST', `/encounters/${E}/call-in`, 'hw')).statusCode).toBe(404); expect(w.calls).toEqual([]);
  });
  it('turns the database refusals into plain words', async () => {
    const app = await make();
    w.fail = new VisitError('taken', 'x'); const a = await call(app, 'POST', `/encounters/${E}/call-in`, 'hw'); expect(a.statusCode).toBe(409); expect(a.json().issue[0].details.text).toMatch(/already being seen/);
    w.fail = new VisitError('forbidden', 'x'); expect((await call(app, 'POST', `/encounters/${E}/call-in`, 'admin')).statusCode).toBe(403);
    w.fail = new VisitError('state', 'x'); expect((await call(app, 'POST', `/encounters/${E}/call-in`, 'hw')).statusCode).toBe(409);
  });
  it('says plainly when the feature is not set up', async () => { w.absent = true; expect((await call(await make(), 'POST', `/encounters/${E}/call-in`, 'hw')).statusCode).toBe(503); });
});

describe('completing the visit', () => {
  it('completes with each outcome', async () => {
    const app = await make();
    for (const [o, qs] of [['treated_here', 'seen'], ['sent_home', 'closed'], ['did_not_wait', 'no_show']] as const) {
      const r = await call(app, 'POST', `/encounters/${E}/complete`, 'nurse', { outcome: o }); expect(r.statusCode, o).toBe(200); expect(r.json()).toMatchObject({ outcome: o, queueStatus: qs });
    }
    expect(w.calls.map(c => c.a.outcome)).toEqual(['treated_here', 'sent_home', 'did_not_wait']);
  });
  it('refuses a referral outcome, unknown outcomes and extra fields at the door', async () => {
    const app = await make();
    for (const b of [{ outcome: 'referred' }, { outcome: 'cured' }, {}, { outcome: 'sent_home', note: 'x' }]) expect((await call(app, 'POST', `/encounters/${E}/complete`, 'nurse', b)).statusCode, JSON.stringify(b)).toBe(400);
    expect(w.calls).toEqual([]);
  });
  it('treated or sent home need the second factor when required; did not wait does not', async () => {
    w.requireMfa = true; const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/complete`, 'nurse1', { outcome: 'treated_here' })).statusCode).toBe(403); expect(w.calls).toEqual([]);
    expect((await call(app, 'POST', `/encounters/${E}/complete`, 'nurse1', { outcome: 'did_not_wait' })).statusCode).toBe(200);
    expect((await call(app, 'POST', `/encounters/${E}/complete`, 'nurse', { outcome: 'treated_here' })).statusCode).toBe(200);
  });
  it('says to review first, and not allowed, in plain words', async () => {
    const app = await make();
    w.fail = new VisitError('review_first', 'x'); const a = await call(app, 'POST', `/encounters/${E}/complete`, 'nurse', { outcome: 'treated_here' }); expect(a.statusCode).toBe(409); expect(a.json().issue[0].details.text).toMatch(/review the priority/);
    w.fail = new VisitError('forbidden', 'x'); expect((await call(app, 'POST', `/encounters/${E}/complete`, 'hw', { outcome: 'treated_here' })).statusCode).toBe(403);
  });
});

describe('who was seen', () => {
  it('lists the last day for the facilities the caller works at, and audits the read', async () => {
    const r = await call(await make(), 'GET', '/queue/done', 'nurse');
    expect(r.statusCode).toBe(200); expect(w.calls[0]).toEqual({ op: 'done', a: { f: [F1], hours: 24 } }); expect(r.json().done[0]).toMatchObject({ patientRef: 'AR-0001', outcome: 'treated_here', waitedMinutes: 25 });
    expect(w.auditLog.at(-1)).toMatchObject({ entityType: 'queue_done', action: 'read' }); expect(JSON.stringify(w.auditLog)).not.toMatch(/Test Patient/);
  });
  it('accepts hours between 1 and 72 only, and refuses a facility administrator', async () => {
    const app = await make(); expect((await call(app, 'GET', '/queue/done?hours=72', 'nurse')).statusCode).toBe(200); expect((await call(app, 'GET', '/queue/done?hours=0', 'nurse')).statusCode).toBe(400); expect((await call(app, 'GET', '/queue/done?hours=500', 'nurse')).statusCode).toBe(400);
    expect((await call(app, 'GET', '/queue/done', 'admin')).statusCode).toBe(403); expect((await call(app, 'GET', '/queue/done', null)).statusCode).toBe(401);
  });
});

describe('before the migration is applied', () => {
  it('every visit route answers a clear 503 and not a crash', async () => {
    const app = await make(); w.fail = new VisitError('not_set_up', 'x');
    expect((await call(app, 'POST', `/encounters/${E}/call-in`, 'hw')).statusCode).toBe(503); expect((await call(app, 'POST', `/encounters/${E}/complete`, 'nurse', { outcome: 'sent_home' })).statusCode).toBe(503);
  });
});
