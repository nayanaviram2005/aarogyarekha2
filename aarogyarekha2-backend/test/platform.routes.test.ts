import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemberError, PlatformError, type AuditEvent, type Deps, type MemberAdmin, type PlatformAdmin, type UserReader, type UserWriter } from '../src/deps.js';

const F = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
interface World { calls: { op: string; a: unknown }[]; fail: PlatformError | MemberError | null; found: boolean; mfa: boolean; absent: boolean; audits: AuditEvent[] }
let w: World;

const make = async () => {
  const reader = (t: string) => ({ getMe: async () => ({ displayName: t, memberships: t === 'nurse' ? [{ facilityId: F, facilityName: 'F', facilityType: 'phc', role: 'nurse' }] : [] }) }) as unknown as UserReader;
  const platformAdmin: PlatformAdmin = {
    isPlatform: async id => id === 'u-plat' || id === 'u-plat1',
    facilities: async () => [{ id: F, name: 'Khordha PHC', type: 'phc', state: null, district: null, code: null, active: true, staff: 3, admins: [{ userId: T, name: 'Asha', email: 'a@x.in' }] }],
    create: async a => { w.calls.push({ op: 'create', a }); if (w.fail) throw w.fail; return { id: F }; },
    setActive: async a => { w.calls.push({ op: 'active', a }); if (w.fail) throw w.fail; },
  };
  const memberAdmin = {
    findByEmail: async (e: string) => { w.calls.push({ op: 'find', a: e }); return w.found ? { id: T } : null; },
    setRole: async (a: unknown) => { w.calls.push({ op: 'set', a }); if (w.fail) throw w.fail; return { role: 'facility_admin', previous: 'none' }; },
    deactivate: async (a: unknown) => { w.calls.push({ op: 'off', a }); if (w.fail) throw w.fail; return { previous: 'facility_admin' }; },
  } as unknown as MemberAdmin;
  const deps = {
    verifyToken: async (t: string) => (['plat', 'plat1', 'nurse'].includes(t) ? { userId: 'u-' + t, aal: t === 'plat1' ? 'aal1' : 'aal2' } : null), userReader: reader, userWriter: () => ({}) as UserWriter,
    ...(w.absent ? {} : { platformAdmin, memberAdmin }), audit: async (e: AuditEvent) => { w.audits.push(e); },
  } as unknown as Deps;
  return buildApp({ allowedOrigins: [], requireMfa: w.mfa }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, token: string | null, body?: object) => app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => { w = { calls: [], fail: null, found: true, mfa: false, absent: false, audits: [] }; });

describe('who may use the platform screens', () => {
  const routes = [['GET', '/platform/facilities'], ['POST', '/platform/facilities'], ['POST', `/platform/facilities/${F}/active`], ['POST', `/platform/facilities/${F}/admins`], ['POST', `/platform/facilities/${F}/admins/${T}/remove`]] as const;
  it.each(routes)('%s %s: a clinician gets 403 and no login 401, and nothing changes', async (m, url) => {
    const app = await make(); const body = m === 'POST' ? { name: 'X', type: 'phc', active: true, email: 'a@b.in' } : undefined;
    expect((await call(app, m, url, 'nurse', body)).statusCode).toBe(403); expect((await call(app, m, url, null, body)).statusCode).toBe(401);
    expect(w.calls).toEqual([]);
  });
  it('says plainly when the feature is not set up', async () => { w.absent = true; expect((await call(await make(), 'GET', '/platform/facilities', 'plat')).statusCode).toBe(503); });
  it('/me tells the page whether to show the platform screen', async () => {
    const app = await make();
    expect((await call(app, 'GET', '/me', 'plat')).json().isPlatformAdmin).toBe(true); expect((await call(app, 'GET', '/me', 'nurse')).json().isPlatformAdmin).toBe(false);
  });
});

describe('facilities', () => {
  it('lists them with their administrators and audits the read', async () => {
    const r = await call(await make(), 'GET', '/platform/facilities', 'plat');
    expect(r.statusCode).toBe(200); expect(r.json().facilities[0]).toMatchObject({ name: 'Khordha PHC', staff: 3, admins: [{ name: 'Asha' }] });
    expect(w.audits.at(-1)).toMatchObject({ entityType: 'platform_facilities', action: 'read' });
  });
  it('creates one from a checked form', async () => {
    const r = await call(await make(), 'POST', '/platform/facilities', 'plat', { name: ' Khordha PHC ', type: 'phc', pincode: '752055', district: '' });
    expect(r.statusCode).toBe(201); expect(w.calls[0]).toMatchObject({ op: 'create', a: { actor: 'u-plat', name: 'Khordha PHC', type: 'phc', pincode: '752055' } });
  });
  it.each([[{ name: 'X', type: 'phc' }], [{ name: 'Khordha', type: 'hospital' }], [{ name: 'Khordha', type: 'phc', pincode: '12' }], [{ name: 'Khordha', type: 'phc', extra: 1 }]])('refuses a bad form %j', async body => {
    expect((await call(await make(), 'POST', '/platform/facilities', 'plat', body)).statusCode).toBe(400); expect(w.calls).toEqual([]);
  });
  it('turns the database refusals into plain words', async () => {
    w.fail = new PlatformError('invalid', 'That facility code is already used by another facility.');
    const r = await call(await make(), 'POST', '/platform/facilities', 'plat', { name: 'Khordha', type: 'phc', code: 'A' });
    expect(r.statusCode).toBe(400); expect(r.body).toMatch(/already used/);
  });
  it('switches one off and on', async () => {
    const app = await make(); expect((await call(app, 'POST', `/platform/facilities/${F}/active`, 'plat', { active: false })).statusCode).toBe(200);
    expect(w.calls[0]).toMatchObject({ op: 'active', a: { facilityId: F, active: false } });
    expect((await call(app, 'POST', `/platform/facilities/${F}/active`, 'plat', { active: 'no' })).statusCode).toBe(400);
    w.fail = new PlatformError('not_found', 'x'); expect((await call(app, 'POST', `/platform/facilities/${F}/active`, 'plat', { active: true })).statusCode).toBe(404);
  });
  it('asks for a verified second factor when the deployment requires one', async () => {
    w.mfa = true; const app = await make();
    expect((await call(app, 'POST', '/platform/facilities', 'plat1', { name: 'Khordha', type: 'phc' })).statusCode).toBe(403);
    expect((await call(app, 'POST', '/platform/facilities', 'plat', { name: 'Khordha', type: 'phc' })).statusCode).toBe(201);
  });
});

describe('facility administrators', () => {
  it('appoints an existing account by email, as facility administrator', async () => {
    const r = await call(await make(), 'POST', `/platform/facilities/${F}/admins`, 'plat', { email: 'Asha@X.in' });
    expect(r.statusCode).toBe(201); expect(w.calls).toEqual([{ op: 'find', a: 'asha@x.in' }, { op: 'set', a: { actor: 'u-plat', facilityId: F, userId: T, role: 'facility_admin' } }]);
  });
  it('tells the person to sign in first when the account is not there, and changes nothing', async () => {
    w.found = false; const r = await call(await make(), 'POST', `/platform/facilities/${F}/admins`, 'plat', { email: 'new@x.in' });
    expect(r.statusCode).toBe(404); expect(r.body).toMatch(/sign in once/); expect(w.calls.some(c => c.op === 'set')).toBe(false);
  });
  it('removes an administrator, and explains a database refusal', async () => {
    const app = await make(); expect((await call(app, 'POST', `/platform/facilities/${F}/admins/${T}/remove`, 'plat')).statusCode).toBe(200);
    expect(w.calls[0]).toMatchObject({ op: 'off', a: { actor: 'u-plat', facilityId: F, userId: T } });
    w.fail = new MemberError('not_found', 'that person has no active role here'); expect((await call(app, 'POST', `/platform/facilities/${F}/admins/${T}/remove`, 'plat')).statusCode).toBe(404);
  });
  it('rejects ids that are not UUIDs', async () => { expect((await call(await make(), 'POST', '/platform/facilities/nope/admins', 'plat', { email: 'a@b.in' })).statusCode).toBe(400); });
});
