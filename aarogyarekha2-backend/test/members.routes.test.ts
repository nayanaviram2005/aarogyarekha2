import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemberError, type AuditEvent, type Deps, type MemberAdmin, type UserReader, type UserWriter } from '../src/deps.js';

const F1 = '22222222-2222-4222-8222-222222222222';
const F2 = '77777777-7777-4777-8777-777777777777';
const T = '33333333-3333-4333-8333-333333333333';
const mem = (facilityId: string, role: string) => ({ facilityId, facilityName: 'F', facilityType: 'phc', role });

interface World { members: Record<string, ReturnType<typeof mem>[]>; calls: { op: string; a: any }[]; fail: MemberError | null; found: boolean; requireMfa: boolean; auditLog: AuditEvent[]; absent: boolean }
let w: World;

const make = async () => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => null, getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
    getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: w.members[t] ?? [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [],
    getNames: async () => ({}), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const memberAdmin: MemberAdmin = {
    list: async f => { w.calls.push({ op: 'list', a: f }); return [{ userId: 'u-admin', facilityId: F1, role: 'facility_admin', active: true, since: '2026-01-01T00:00:00.000Z', name: 'Asha', email: 'a@x.in', lastSignIn: '2026-10-07T08:00:00.000Z', mfa: true }, { userId: T, facilityId: F1, role: 'nurse', active: true, since: '2026-01-01T00:00:00.000Z', name: 'Ravi', email: 'r@x.in', lastSignIn: null, mfa: false }]; },
    findByEmail: async e => { w.calls.push({ op: 'find', a: e }); return w.found ? { id: T } : null; },
    setRole: async a => { w.calls.push({ op: 'set', a }); if (w.fail) throw w.fail; return { role: a.role, previous: 'none' }; },
    deactivate: async a => { w.calls.push({ op: 'off', a }); if (w.fail) throw w.fail; return { previous: 'nurse' }; },
    changes: async () => [{ at: '2026-10-07T00:00:00.000Z', facilityId: F1, op: 'set_role', role: 'doctor', previous: 'none', actor: 'Asha', target: 'Ravi' }],
  };
  const deps: Deps = {
    verifyToken: async t => (t in w.members ? { userId: 'u-' + t, aal: t === 'admin1' ? 'aal1' : 'aal2' } : null), userReader: reader, userWriter: () => ({ hasActiveConsent: async () => true }) as unknown as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    ...(w.absent ? {} : { memberAdmin }),
    audit: async e => { w.auditLog.push(e); },
  };
  return buildApp({ allowedOrigins: [], requireMfa: w.requireMfa }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, token: string | null, body?: object) => app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  w = { members: { admin: [mem(F1, 'facility_admin')], admin1: [mem(F1, 'facility_admin')], nurse: [mem(F1, 'nurse')], two: [mem(F1, 'facility_admin'), mem(F2, 'facility_admin')] }, calls: [], fail: null, found: true, requireMfa: false, auditLog: [], absent: false };
});

describe('who may use people and roles', () => {
  it.each([['GET', '/admin/members'], ['GET', '/admin/members/changes'], ['POST', '/admin/members']] as const)('%s %s: a clinician gets 403 and no login 401', async (m, url) => {
    const app = await make(); const body = m === 'POST' ? { email: 'a@b.in', role: 'nurse' } : undefined;
    expect((await call(app, m, url, 'nurse', body)).statusCode).toBe(403); expect((await call(app, m, url, null, body)).statusCode).toBe(401);
    expect(w.calls.filter(c => c.op === 'set')).toEqual([]);
  });
  it('says plainly when the feature is not set up', async () => { w.absent = true; expect((await call(await make(), 'GET', '/admin/members', 'admin')).statusCode).toBe(503); });
});

describe('listing', () => {
  it('lists people at the administrator\'s facilities, marks self and who can be changed, and audits the read', async () => {
    const r = await call(await make(), 'GET', '/admin/members', 'admin');
    expect(r.statusCode).toBe(200); expect(w.calls[0]).toEqual({ op: 'list', a: [F1] });
    const m = r.json().members; expect(m.find((x: any) => x.userId === 'u-admin')).toMatchObject({ isSelf: true, canChange: false }); expect(m.find((x: any) => x.userId === T)).toMatchObject({ isSelf: false, canChange: true });
    expect(w.auditLog.at(-1)).toMatchObject({ entityType: 'admin_members', action: 'read' });
  });
  it('lists recent changes', async () => { expect((await call(await make(), 'GET', '/admin/members/changes', 'admin')).json().changes[0]).toMatchObject({ op: 'set_role', role: 'doctor' }); });
});

describe('adding by email', () => {
  it('adds an existing account with a clinical role, as the caller, at the only facility they administer', async () => {
    const r = await call(await make(), 'POST', '/admin/members', 'admin', { email: ' New@X.in ', role: 'doctor' });
    expect(r.statusCode).toBe(201); expect(w.calls.find(c => c.op === 'find')!.a).toBe('new@x.in');
    expect(w.calls.find(c => c.op === 'set')!.a).toEqual({ actor: 'u-admin', facilityId: F1, userId: T, role: 'doctor' });
  });
  it('an unknown email is a plain 404 and nothing is granted', async () => {
    w.found = false; const r = await call(await make(), 'POST', '/admin/members', 'admin', { email: 'no@x.in', role: 'nurse' });
    expect(r.statusCode).toBe(404); expect(w.calls.some(c => c.op === 'set')).toBe(false); expect(w.auditLog.at(-1)).toMatchObject({ entityType: 'membership', outcome: 'denied' });
  });
  it('refuses facility_admin, unknown roles and extra fields at the door', async () => {
    const app = await make();
    for (const body of [{ email: 'a@b.in', role: 'facility_admin' }, { email: 'a@b.in', role: 'root' }, { email: 'nope', role: 'nurse' }, { email: 'a@b.in', role: 'nurse', userId: T }]) expect((await call(app, 'POST', '/admin/members', 'admin', body)).statusCode, JSON.stringify(body)).toBe(400);
    expect(w.calls.some(c => c.op === 'set')).toBe(false);
  });
  it('needs a facility when the caller administers several, and refuses one they do not administer', async () => {
    const app = await make();
    expect((await call(app, 'POST', '/admin/members', 'two', { email: 'a@b.in', role: 'nurse' })).statusCode).toBe(400);
    expect((await call(app, 'POST', '/admin/members', 'admin', { email: 'a@b.in', role: 'nurse', facilityId: F2 })).statusCode).toBe(403);
    expect((await call(app, 'POST', '/admin/members', 'two', { email: 'a@b.in', role: 'nurse', facilityId: F2 })).statusCode).toBe(201);
  });
});

describe('changing and removing', () => {
  it('changes a role and removes a person', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/admin/members/${T}/role`, 'admin', { role: 'medical_officer' })).json()).toMatchObject({ role: 'medical_officer' });
    expect((await call(app, 'POST', `/admin/members/${T}/deactivate`, 'admin')).json()).toMatchObject({ removed: true, previous: 'nurse' });
  });
  it('turns the database refusals into plain words', async () => {
    const app = await make();
    w.fail = new MemberError('forbidden', 'you cannot change your own role'); const a = await call(app, 'POST', `/admin/members/${T}/role`, 'admin', { role: 'nurse' });
    expect(a.statusCode).toBe(403); expect(a.json().issue[0].details.text).toMatch(/own role/);
    w.fail = new MemberError('forbidden', 'only a platform administrator can create or change facility administrators'); expect((await call(app, 'POST', `/admin/members/${T}/role`, 'admin', { role: 'nurse' })).json().issue[0].details.text).toMatch(/platform administrator/);
    w.fail = new MemberError('not_found', 'that person has no active role here'); expect((await call(app, 'POST', `/admin/members/${T}/deactivate`, 'admin')).statusCode).toBe(404);
  });
  it('a bad id is 400', async () => { expect((await call(await make(), 'POST', '/admin/members/nope/role', 'admin', { role: 'nurse' })).statusCode).toBe(400); });
});

describe('second factor', () => {
  it('writes need it when required; reading does not', async () => {
    w.requireMfa = true; const app = await make();
    const r = await call(app, 'POST', '/admin/members', 'admin1', { email: 'a@b.in', role: 'nurse' });
    expect(r.statusCode).toBe(403); expect(w.calls.some(c => c.op === 'set')).toBe(false);
    expect((await call(app, 'POST', `/admin/members/${T}/deactivate`, 'admin1')).statusCode).toBe(403);
    expect((await call(app, 'GET', '/admin/members', 'admin1')).statusCode).toBe(200);
    expect((await call(app, 'POST', '/admin/members', 'admin', { email: 'a@b.in', role: 'nurse' })).statusCode).toBe(201);
  });
});
