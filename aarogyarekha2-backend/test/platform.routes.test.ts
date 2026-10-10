import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemberError, PlatformError, type AuditEvent, type Deps, type MemberAdmin, type PlatformAdmin, type UserReader, type UserWriter } from '../src/deps.js';

const F = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
interface World { calls: { op: string; a: unknown }[]; fail: PlatformError | MemberError | null; found: boolean; mfa: boolean; absent: boolean; audits: AuditEvent[]; training: 'on' | 'off' | 'broken' }
let w: World;

const trainingCase = (id: string, complaint = 'Cough') => ({
  caseId: id, schema: 'aarogyarekha-training-case/1', withheldFields: 0, fhir: { resourceType: 'Bundle', type: 'collection', entry: [] },
  features: { ageYears: 7, sex: 'female', language: 'hi', pregnant: false, scenario: 'opd_queue', facilityType: 'phc', complaint, complaintEnglish: null, symptoms: [], vitals: { spo2_pct: 90 }, signsAnswered: {}, consciousness: null, onExtraOxygen: null, labResults: [], followUpAnswers: [] },
  engine: { tier: 2, ruleSet: null, winningRule: 'PAED-VITALS', log: [], extendedCheckTier: null },
  label: { finalTier: 1, rulesTier: 2, reviewAction: 'approve', changedByReviewer: false, reviewerRole: 'doctor', reviewerId: 'clinician-aaaaaaaaaaaa', reason: null },
});

const make = async () => {
  const reader = (t: string) => ({ getMe: async () => ({ displayName: t, memberships: t === 'nurse' ? [{ facilityId: F, facilityName: 'F', facilityType: 'phc', role: 'nurse' }] : [] }) }) as unknown as UserReader;
  const platformAdmin: PlatformAdmin = {
    isPlatform: async id => id === 'u-plat' || id === 'u-plat1',
    facilities: async () => [{ id: F, name: 'Khordha PHC', type: 'phc', state: null, district: null, code: null, active: true, staff: 3, lastActivity: '2026-10-07T08:00:00.000Z', visits30: 12, referrals30: 2, admins: [{ userId: T, name: 'Asha', email: 'a@x.in' }] }],
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
    ...(w.training === 'off' ? {} : { trainingStore: {
      key: 'k'.repeat(40), write: async () => {},
      summary: async () => { if (w.training === 'broken') throw new Error('table missing'); return { count: 2, latestAt: '2026-10-10T10:00:00.000Z' }; },
      list: async () => { if (w.training === 'broken') throw new Error('table missing'); return [trainingCase('case-aaaaaaaaaaaa'), trainingCase('case-bbbbbbbbbbbb', '=SUM(1+1)')]; },
    } }),
  } as unknown as Deps;
  return buildApp({ allowedOrigins: [], requireMfa: w.mfa }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, token: string | null, body?: object) => app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => { w = { calls: [], fail: null, found: true, mfa: false, absent: false, audits: [], training: 'on' }; });

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

describe('training data for platform administrators', () => {
  it.each(['/platform/training-cases', '/platform/training-cases/export'])('%s: a clinician gets 403 and no login 401, and nothing is audited', async url => {
    const app = await make();
    expect((await call(app, 'GET', url, 'nurse')).statusCode).toBe(403); expect((await call(app, 'GET', url, null)).statusCode).toBe(401);
    expect(w.audits.filter(a => a.entityType === 'training_cases')).toEqual([]);
  });

  it('says how many cases are saved', async () => {
    const r = await call(await make(), 'GET', '/platform/training-cases', 'plat');
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ enabled: true, count: 2, latestAt: '2026-10-10T10:00:00.000Z' });
  });

  it('says it is off, rather than failing, when the setting is missing', async () => {
    w.training = 'off';
    const r = await call(await make(), 'GET', '/platform/training-cases', 'plat');
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ enabled: false, count: 0, latestAt: null });
  });

  it('downloads a CSV with a header and one row per case, and audits the download', async () => {
    const r = await call(await make(), 'GET', '/platform/training-cases/export?format=csv', 'plat');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv'); expect(r.headers['content-disposition']).toMatch(/^attachment; filename="training-cases-\d{4}-\d{2}-\d{2}\.csv"$/); expect(r.headers['x-training-rows']).toBe('2');
    const lines = r.body.trim().split('\n'); expect(lines).toHaveLength(3); expect(lines[0]).toContain('case_id,age_years');
    expect(r.body).toContain(`"'=SUM(1+1)"`);
    expect(w.audits.at(-1)).toMatchObject({ action: 'export', entityType: 'training_cases', outcome: 'success', details: { format: 'csv', count: 2 } });
  });

  it('downloads JSON lines too, and the CSV is the default', async () => {
    const app = await make();
    const r = await call(app, 'GET', '/platform/training-cases/export?format=jsonl', 'plat');
    expect(r.headers['content-type']).toContain('application/x-ndjson'); expect(r.body.trim().split('\n').map(l => JSON.parse(l).caseId)).toEqual(['case-aaaaaaaaaaaa', 'case-bbbbbbbbbbbb']);
    expect((await call(app, 'GET', '/platform/training-cases/export', 'plat')).headers['content-type']).toContain('text/csv');
  });

  it('refuses an unknown format', async () => { expect((await call(await make(), 'GET', '/platform/training-cases/export?format=xml', 'plat')).statusCode).toBe(400); });

  it('asks for a verified second factor before a download', async () => {
    w.mfa = true; const app = await make();
    expect((await call(app, 'GET', '/platform/training-cases/export', 'plat1')).statusCode).toBe(403);
    expect((await call(app, 'GET', '/platform/training-cases/export', 'plat')).statusCode).toBe(200);
  });

  it('explains what is missing when it is not turned on, and when the table is not there', async () => {
    w.training = 'off'; const off = await call(await make(), 'GET', '/platform/training-cases/export', 'plat');
    expect(off.statusCode).toBe(503); expect(off.body).toMatch(/TRAINING_PSEUDONYM_KEY/);
    w.training = 'broken'; const app = await make();
    expect((await call(app, 'GET', '/platform/training-cases', 'plat')).statusCode).toBe(502);
    expect((await call(app, 'GET', '/platform/training-cases/export', 'plat')).statusCode).toBe(502);
  });
});
