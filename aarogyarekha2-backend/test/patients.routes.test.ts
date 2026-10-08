import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type Deps, type NewPatient, type PatientBrief, type UserReader, type UserWriter } from '../src/deps.js';

const F1 = '22222222-2222-4222-8222-222222222222';
const F2 = '77777777-7777-4777-8777-777777777777';
const FX = '88888888-8888-4888-8888-888888888888';
const brief = (over: Partial<PatientBrief> = {}): PatientBrief => ({ id: 'p-old', public_ref: 'AR-0001', full_name: 'Anita Rao', sex: 'female', birth_date: null, age_years_reported: 30, preferred_language: 'hi', ...over });

interface World { memberships: { facilityId: string; facilityName: string | null; facilityType: string | null; role: string }[]; existing: PatientBrief[]; registered: NewPatient[]; audits: AuditEvent[]; fails: unknown; listFails: boolean; searched: (string | undefined)[] }
let w: World;
const mem = (facilityId: string) => ({ facilityId, facilityName: 'F', facilityType: 'phc', role: 'nurse' });

const make = async () => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => null, getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [], listPatients: async q => { w.searched.push(q); if (w.listFails) throw new Error('x'); return w.existing; }, getQueue: async () => [],
    getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: t === 'nomember' ? [] : w.memberships }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}),
    listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const writer: Partial<UserWriter> = { registerPatient: async p => { if (w.fails) throw w.fails; w.registered.push(p); return { id: 'p-new', publicRef: 'AR-0099' }; } };
  const deps: Deps = {
    verifyToken: async t => (['nurse', 'nomember'].includes(t) ? { userId: 'u-' + t } : null), userReader: reader, userWriter: () => writer as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    audit: async e => { w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const post = (app: App, body: unknown, token: string | null = 'nurse') => app.inject({ method: 'POST', url: '/patients', payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
const ok = { fullName: 'Meera Das', sex: 'female', ageYears: 28, preferredLanguage: 'or' };

beforeEach(() => { w = { memberships: [mem(F1)], existing: [], registered: [], audits: [], fails: null, listFails: false, searched: [] }; });

describe('registering', () => {
  it('registers at the caller\'s own facility and returns the new public reference', async () => {
    const r = await post(await make(), { ...ok, phone: '98765 43210', villageTown: 'Jatni', pincode: '752050' });
    expect(r.statusCode).toBe(201); expect(r.json()).toEqual({ id: 'p-new', publicRef: 'AR-0099' });
    expect(w.registered[0]).toMatchObject({ facilityId: F1, fullName: 'Meera Das', sex: 'female', ageYears: 28, preferredLanguage: 'or', phone: '9876543210', villageTown: 'Jatni', pincode: '752050' });
  });
  it('the audit entry has ids only: no name, phone, place', async () => {
    await post(await make(), { ...ok, phone: '9876543210', villageTown: 'Jatni' });
    const a = w.audits.find(x => x.entityType === 'patient')!;
    expect(a).toMatchObject({ action: 'create', outcome: 'success', entityId: 'p-new', patientId: 'p-new', facilityId: F1 });
    expect(JSON.stringify(a)).not.toMatch(/Meera|9876|Jatni/);
  });
  it('a birth date is enough instead of an age', async () => {
    expect((await post(await make(), { fullName: 'Ravi Nayak', sex: 'male', birthDate: '1990-05-01' })).statusCode).toBe(201);
  });
  it.each([
    ['no age or birth date', { fullName: 'A B', sex: 'male' }], ['empty name', { ...ok, fullName: '  ' }], ['markup in the name', { ...ok, fullName: '<script>' }], ['future birth date', { ...ok, ageYears: undefined, birthDate: '2999-01-01' }],
    ['not a date', { ...ok, ageYears: undefined, birthDate: '2020-13-45' }], ['age 200', { ...ok, ageYears: 200 }], ['bad phone', { ...ok, phone: 'abc' }], ['bad pincode', { ...ok, pincode: '12' }], ['unknown sex', { ...ok, sex: 'x' }], ['extra field', { ...ok, role: 'admin' }], ['bad language code', { ...ok, preferredLanguage: 'Hindi!' }],
  ])('rejects %s', async (_n, body) => {
    expect((await post(await make(), body)).statusCode).toBe(400); expect(w.registered).toHaveLength(0);
  });
});

describe('facility', () => {
  it('a member of several facilities must choose one, and may only choose their own', async () => {
    w.memberships = [mem(F1), mem(F2)];
    const app = await make();
    expect((await post(app, ok)).statusCode).toBe(400);
    expect((await post(app, { ...ok, facilityId: F2 })).statusCode).toBe(201); expect(w.registered[0]!.facilityId).toBe(F2);
    expect((await post(app, { ...ok, facilityId: FX })).statusCode).toBe(403); expect(w.registered).toHaveLength(1);
  });
  it('someone with no facility cannot register patients', async () => {
    expect((await post(await make(), ok, 'nomember')).statusCode).toBe(400);
  });
  it('a facility administrator is not clinical staff and cannot register patients', async () => {
    w.memberships = [{ ...mem(F1), role: 'facility_admin' }]; const r = await post(await make(), ok);
    expect(r.statusCode).toBe(400); expect(w.registered).toHaveLength(0);
    w.memberships = [{ ...mem(F1), role: 'facility_admin' }, { ...mem(F1), role: 'health_worker' }]; expect((await post(await make(), ok)).statusCode).toBe(201);
  });
  it('no login is 401', async () => { expect((await post(await make(), ok, null)).statusCode).toBe(401); });
});

describe('duplicates', () => {
  it('stops on a probable duplicate and lists who it matched, without registering', async () => {
    w.existing = [brief()];
    const r = await post(await make(), { fullName: 'anita rao', sex: 'female', ageYears: 31, preferredLanguage: 'hi' });
    expect(r.statusCode).toBe(409);
    expect(r.json().possibleDuplicates).toEqual([{ id: 'p-old', publicRef: 'AR-0001', fullName: 'Anita Rao', sex: 'female', birthDate: null, ageYears: 30 }]);
    expect(r.json().issue[0].details.text).toMatch(/already registered/); expect(w.registered).toHaveLength(0);
    expect(w.audits.some(a => a.entityType === 'patient_duplicate_check' && (a.details as { matches: number }).matches === 1)).toBe(true);
  });
  it('registers anyway once the staff member confirms it is a different person', async () => {
    w.existing = [brief()];
    expect((await post(await make(), { fullName: 'Anita Rao', sex: 'female', ageYears: 30, confirmNotDuplicate: true })).statusCode).toBe(201);
    expect(w.registered).toHaveLength(1); expect(w.searched).toHaveLength(0);
  });
  it('a different person with a similar name goes straight through', async () => {
    w.existing = [brief({ full_name: 'Anita Rani' }), brief({ id: 'z', age_years_reported: 60 })];
    expect((await post(await make(), { fullName: 'Anita Rao', sex: 'female', ageYears: 30 })).statusCode).toBe(201);
  });
  it('searches with a safe first name only, even when the name has odd characters', async () => {
    await post(await make(), { fullName: "D'Souza Maria", sex: 'female', ageYears: 30 });
    expect(w.searched).toEqual(['DSouza']);
  });
  it('if existing patients cannot be checked it does not register blindly', async () => {
    w.listFails = true;
    const r = await post(await make(), ok);
    expect(r.statusCode).toBe(502); expect(w.registered).toHaveLength(0);
  });
});

describe('database refusals', () => {
  it('a row-level-security refusal is a plain 403', async () => {
    w.fails = new DbError('42501', 'rls');
    const r = await post(await make(), ok);
    expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/not allowed/);
  });
});
