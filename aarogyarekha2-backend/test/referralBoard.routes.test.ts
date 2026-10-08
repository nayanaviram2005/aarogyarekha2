import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type ConsentBrief, type Deps, type FacilityRow, type ReferralBoardRow, type ReferralRow, type ReferralStatus, type UserReader, type UserWriter } from '../src/deps.js';

const FA = '22222222-2222-4222-8222-222222222222';   // sending
const FB = '77777777-7777-4777-8777-777777777777';   // receiving
const FC = '88888888-8888-4888-8888-888888888888';   // unrelated
const R = '99999999-9999-4999-8999-999999999999';
const P = '11111111-1111-4111-8111-111111111111';
const mem = (facilityId: string, role: string) => ({ facilityId, facilityName: 'F', facilityType: 'phc', role });
const consent = (over: Partial<ConsentBrief> = {}): ConsentBrief => ({ id: 'c', purpose: 'referral_sharing', granted_at: '2026-10-01T08:00:00Z', revoked_at: null, expires_at: null, ...over });
const row = (over: Partial<ReferralBoardRow> = {}): ReferralBoardRow => ({ id: R, encounter_id: 'e', patient_id: P, from_facility_id: FA, to_facility_id: FB, priority: 'urgent', reason_text: 'Needs a scan', status: 'requested', status_reason: null, sent_at: '2026-10-07T08:00:00Z', updated_at: '2026-10-07T08:00:00Z', patient: { id: P, public_ref: 'AR-0001', full_name: 'Anita Rao', sex: 'female', birth_date: null, age_years_reported: 30, preferred_language: 'hi' }, ...over });
const refRow = (over: Partial<ReferralRow> = {}): ReferralRow => ({ id: R, encounter_id: 'e', patient_id: P, from_facility_id: FA, to_facility_id: FB, requested_by: 'u', priority: 'urgent', reason_text: 'x', status: 'requested', status_reason: null, bundle: null, bundle_sha256: null, sent_at: null, created_at: '', updated_at: '', ...over });

interface World { members: Record<string, ReturnType<typeof mem>[]>; rows: ReferralBoardRow[]; ref: ReferralRow | null; consents: ConsentBrief[]; listed: { side: string; fac: string[]; statuses: ReferralStatus[] }[]; responded: { id: string; to: ReferralStatus; note: string | null }[]; respondError: unknown; audits: AuditEvent[]; requireMfa: boolean; auditFails: boolean }
let w: World;

const make = async () => {
  const facs: FacilityRow[] = [{ id: FA, name: 'Seed PHC', type: 'phc', state: null, district: null, capabilities: [] }, { id: FB, name: 'Seed District Hospital', type: 'district_hospital', state: null, district: null, capabilities: [] }];
  const reader = (t: string): UserReader => ({
    getPatient: async () => null, getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [], listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null,
    getMe: async () => ({ displayName: null, memberships: w.members[t] ?? [] }), listFacilities: async () => facs, getFacility: async () => null, getReferral: async () => w.ref, listReferrals: async () => [], getConsents: async () => w.consents, getNames: async () => ({}),
    listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const deps: Deps = {
    verifyToken: async t => (t in w.members ? { userId: 'u-' + t, aal: t === 'recv1' ? 'aal1' : 'aal2' } : null), userReader: reader, userWriter: () => ({ hasActiveConsent: async () => true }) as unknown as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    referralBoard: () => ({
      list: async (side, fac, statuses) => { w.listed.push({ side, fac, statuses }); return w.rows; },
      respond: async (id, to, note) => { if (w.respondError) throw w.respondError; w.responded.push({ id, to, note }); },
    }),
    audit: async e => { if (w.auditFails && e.entityType.startsWith('referrals_')) throw new Error('audit down'); w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [], requireMfa: w.requireMfa }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, token: string | null, body?: object) => app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  w = { members: { recv: [mem(FB, 'doctor')], recv1: [mem(FB, 'doctor')], send: [mem(FA, 'nurse')], other: [mem(FC, 'doctor')], admin: [mem(FB, 'facility_admin')] }, rows: [row()], ref: refRow(), consents: [consent()], listed: [], responded: [], respondError: null, audits: [], requireMfa: false, auditFails: false };
});

describe('incoming and sent lists', () => {
  it('incoming asks for the caller\'s facility and the open statuses by default, and names the facilities', async () => {
    const r = await call(await make(), 'GET', '/referrals/incoming', 'recv');
    expect(r.statusCode).toBe(200); expect(w.listed).toEqual([{ side: 'incoming', fac: [FB], statuses: ['requested', 'accepted', 'in_progress'] }]);
    expect(r.json().referrals[0]).toMatchObject({ id: R, status: 'requested', priority: 'urgent', from: { id: FA, name: 'Seed PHC' }, to: { id: FB, name: 'Seed District Hospital' }, patient: { publicRef: 'AR-0001', fullName: 'Anita Rao', ageYears: 30 } });
  });
  it('sent uses the same shape for the sending side', async () => {
    await call(await make(), 'GET', '/referrals/sent', 'send'); expect(w.listed[0]).toMatchObject({ side: 'sent', fac: [FA] });
  });
  it('accepts a status filter and rejects unknown ones and unknown parameters', async () => {
    const app = await make();
    await call(app, 'GET', '/referrals/incoming?status=completed,rejected', 'recv'); expect(w.listed[0]!.statuses).toEqual(['completed', 'rejected']);
    expect((await call(app, 'GET', '/referrals/incoming?status=draft', 'recv')).statusCode).toBe(400);
    expect((await call(app, 'GET', '/referrals/incoming?x=1', 'recv')).statusCode).toBe(400);
  });
  it('incoming puts the most urgent first, then the newest', async () => {
    w.rows = [row({ id: 'a', priority: 'routine', sent_at: '2026-10-07T09:00:00Z' }), row({ id: 'b', priority: 'stat', sent_at: '2026-10-07T07:00:00Z' }), row({ id: 'c', priority: 'urgent', sent_at: '2026-10-07T08:00:00Z' }), row({ id: 'd', priority: 'urgent', sent_at: '2026-10-07T08:30:00Z' })];
    expect((await call(await make(), 'GET', '/referrals/incoming', 'recv')).json().referrals.map((x: { id: string }) => x.id)).toEqual(['b', 'd', 'c', 'a']);
  });
  it('a row whose patient the caller cannot see still lists, with no patient', async () => {
    w.rows = [row({ patient: null })]; expect((await call(await make(), 'GET', '/referrals/incoming', 'recv')).json().referrals[0].patient).toBeNull();
  });
  it('the read is audited with a count only; if that fails nothing is released', async () => {
    await call(await make(), 'GET', '/referrals/incoming', 'recv'); expect(w.audits.find(a => a.entityType === 'referrals_incoming')).toMatchObject({ outcome: 'success', details: { count: 1 } });
    w.auditFails = true; const r = await call(await make(), 'GET', '/referrals/incoming', 'recv');
    expect(r.statusCode).toBe(503); expect(JSON.stringify(r.json())).not.toContain('Anita');
  });
  it('an administrator or a stranger gets 403, no login 401', async () => {
    const app = await make();
    expect((await call(app, 'GET', '/referrals/incoming', 'admin')).statusCode).toBe(403); expect((await call(app, 'GET', '/referrals/incoming', null)).statusCode).toBe(401);
  });
});

describe('responding', () => {
  const act = (app: App, action: string, extra: object = {}, token = 'recv') => call(app, 'POST', `/referrals/${R}/respond`, token, { action, ...extra });
  it.each([['accept', 'requested', 'accepted'], ['start', 'accepted', 'in_progress'], ['complete', 'in_progress', 'completed']] as const)('%s moves %s to %s and is audited without the note text', async (action, from, to) => {
    w.ref = refRow({ status: from as ReferralStatus });
    const r = await act(await make(), action, { note: 'Bed ready in ward 3' });
    expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ id: R, status: to }); expect(w.responded).toEqual([{ id: R, to, note: 'Bed ready in ward 3' }]);
    const a = w.audits.find(x => x.entityType === 'referral')!; expect(a).toMatchObject({ outcome: 'success', facilityId: FB, details: { action, to, hasNote: true } }); expect(JSON.stringify(a)).not.toContain('ward 3');
  });
  it('declining needs a reason and goes through; the note is passed to the sender', async () => {
    const app = await make();
    expect((await act(app, 'reject')).statusCode).toBe(400); expect((await act(app, 'reject', { note: 'no' })).statusCode).toBe(400); expect(w.responded).toHaveLength(0);
    expect((await act(app, 'reject', { note: 'No bed free today, try the medical college' })).statusCode).toBe(200); expect(w.responded[0]).toMatchObject({ to: 'rejected', note: 'No bed free today, try the medical college' });
  });
  it('a step out of order is refused with the current state in plain words', async () => {
    w.ref = refRow({ status: 'requested' });
    const r = await act(await make(), 'complete');
    expect(r.statusCode).toBe(409); expect(r.json().issue[0].details.text).toMatch(/requested, so it cannot be completed/); expect(w.responded).toHaveLength(0);
  });
  it('someone at a different facility, or the sending facility, cannot respond', async () => {
    const app = await make();
    expect((await act(app, 'accept', {}, 'other')).statusCode).toBe(403); expect((await act(app, 'accept', {}, 'send')).statusCode).toBe(403); expect(w.responded).toHaveLength(0);
  });
  it('a missing or draft referral is 404; a bad id 400; bad body 400', async () => {
    const app = await make();
    w.ref = null; expect((await act(app, 'accept')).statusCode).toBe(404);
    w.ref = refRow({ status: 'draft' }); expect((await act(app, 'accept')).statusCode).toBe(404);
    expect((await call(app, 'POST', '/referrals/nope/respond', 'recv', { action: 'accept' })).statusCode).toBe(400);
    w.ref = refRow(); for (const b of [{ action: 'cancel' }, { action: 'accept', extra: 1 }, {}]) expect((await call(app, 'POST', `/referrals/${R}/respond`, 'recv', b)).statusCode).toBe(400);
  });
  it('accepting or starting care needs the sharing consent to still be in force; the refusal is audited', async () => {
    const app = await make();
    for (const over of [{ revoked_at: '2026-10-05T00:00:00Z' }, { expires_at: '2026-10-02T00:00:00Z' }]) {
      w.consents = [consent(over)]; w.ref = refRow({ status: 'requested' });
      const r = await act(app, 'accept'); expect(r.statusCode).toBe(409); expect(r.json().issue[0].details.text).toMatch(/no longer in force/);
    }
    w.consents = []; w.ref = refRow({ status: 'accepted' }); expect((await act(app, 'start')).statusCode).toBe(409);
    expect(w.responded).toHaveLength(0); expect(w.audits.some(a => a.outcome === 'denied' && (a.details as { why?: string }).why === 'consent_withdrawn')).toBe(true);
  });
  it('declining and completing do NOT need the consent (you must always be able to say no or finish)', async () => {
    w.consents = []; const app = await make();
    w.ref = refRow({ status: 'requested' }); expect((await act(app, 'reject', { note: 'Patient withdrew consent' })).statusCode).toBe(200);
    w.ref = refRow({ status: 'in_progress' }); expect((await act(app, 'complete')).statusCode).toBe(200);
  });
  it('needs a verified second factor when the deployment requires it', async () => {
    w.requireMfa = true; const app = await make();
    const r = await act(app, 'accept', {}, 'recv1'); expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/Two-factor/); expect(w.responded).toHaveLength(0);
    expect((await act(app, 'accept')).statusCode).toBe(200);
  });
  it('the database\'s own refusals become plain words: illegal step 409, not allowed 403', async () => {
    const app = await make();
    w.respondError = new DbError('23514', 'illegal referral transition'); expect((await act(app, 'accept')).statusCode).toBe(409);
    w.respondError = new DbError('42501', 'only the receiving facility'); const r = await act(app, 'accept'); expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/reviewing doctor or nurse/);
    expect(w.audits.filter(a => a.outcome === 'denied' && a.entityType === 'referral')).toHaveLength(2);
  });
});
