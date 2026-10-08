import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { aalOf } from '../src/auth/aal.js';
import { loadConfig } from '../src/config.js';
import type { AuditEvent, Deps, UserReader, UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';
import type { ReviewArgs } from '../src/review/record.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const A = '44444444-4444-4444-8444-444444444444';
const R = '55555555-5555-4555-8555-555555555555';
const patient = { id: P, registered_facility_id: F, full_name: 'Test Patient' } as unknown as PatientRow;
const enc: EncounterRow = { id: E, patient_id: P, facility_id: F, status: 'submitted', scenario: 'opd_queue', language: 'en', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z' };

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('aalOf', () => {
  it('reads aal2 only when the claim says so', () => {
    expect(aalOf(jwt({ aal: 'aal2' }))).toBe('aal2');
    expect(aalOf(jwt({ aal: 'aal1' }))).toBe('aal1');
  });
  it('anything missing, odd or unreadable counts as aal1, never aal2', () => {
    for (const t of [jwt({}), jwt({ aal: 2 }), jwt({ aal: 'AAL2' }), jwt({ aal: ['aal2'] }), '', 'abc', 'a.b.c', 'a.%%%.c']) expect(aalOf(t)).toBe('aal1');
  });
});

describe('config', () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a'.repeat(30), DATABASE_URL_POOLER: 'postgres://x', };
  it('requires the second factor unless explicitly turned off', () => {
    expect(loadConfig({ ...env }).requireMfa).toBe(true);
    expect(loadConfig({ ...env, MFA_REQUIRED: 'false' }).requireMfa).toBe(false);
  });
  it('rejects a value that is neither true nor false', () => {
    expect(() => loadConfig({ ...env, MFA_REQUIRED: 'maybe' })).toThrow(/MFA_REQUIRED/);
  });
});

interface World { reviews: ReviewArgs[]; sends: number; audits: AuditEvent[] }
let w: World;
const make = async (requireMfa: boolean | undefined) => {
  const reader = (): UserReader => ({
    getPatient: async () => patient, getIdentifiers: async () => [], getEncounter: async id => (id === E ? enc : null), getVitals: async () => [],
    listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null, listFacilities: async () => [], getFacility: async () => null,
    getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
    getMe: async () => ({ displayName: 'Dr Test', memberships: [] }),
  });
  const deps: Deps = {
    verifyToken: async t => (t === 'aal1' ? { userId: 'u1', aal: 'aal1' } : t === 'aal2' ? { userId: 'u2', aal: 'aal2' } : t === 'legacy' ? { userId: 'u3' } : null),
    userReader: reader, userWriter: () => ({ hasActiveConsent: async () => true }) as unknown as UserWriter,
    assess: async () => { throw new Error('unused'); },
    review: async a => { w.reviews.push(a); return { reviewId: 'r1', action: 'approve', fromUrgency: 'orange', effectiveUrgency: 'orange', rulesUrgency: 'orange', downgrade: false, belowRuleFloor: false, facilityId: F, patientId: P }; },
    sendReferral: async () => { w.sends++; throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    audit: async e => { w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [], ...(requireMfa === undefined ? {} : { requireMfa }) }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const review = (app: App, token: string) => app.inject({ method: 'POST', url: `/encounters/${E}/review`, payload: { action: 'approve', assessmentId: A }, headers: { authorization: `Bearer ${token}` } });
const send = (app: App, token: string) => app.inject({ method: 'POST', url: `/referrals/${R}/send`, headers: { authorization: `Bearer ${token}` } });

beforeEach(() => { w = { reviews: [], sends: 0, audits: [] }; });

describe('when two-factor is required', () => {
  it.each(['aal1', 'legacy'])('a review by a %s session is refused with a plain reason and nothing is recorded', async token => {
    const r = await review(await make(true), token);
    expect(r.statusCode).toBe(403);
    expect(r.json().issue[0].details.text).toMatch(/Two-factor sign-in is required/);
    expect(w.reviews).toHaveLength(0);
  });
  it('the refusal is logged without any patient data', async () => {
    await review(await make(true), 'aal1');
    const a = w.audits.find(x => x.entityType === 'mfa_gate')!;
    expect(a).toMatchObject({ outcome: 'denied', actor: 'u1', details: { action: 'review' } });
    expect(a.patientId ?? null).toBeNull();
  });
  it('a verified (aal2) session reviews normally', async () => {
    const r = await review(await make(true), 'aal2');
    expect(r.statusCode).toBe(201); expect(w.reviews).toHaveLength(1); expect(w.reviews[0]!.reviewerId).toBe('u2');
  });
  it('sending a referral is gated the same way, before anything is looked up or sent', async () => {
    const app = await make(true);
    const blocked = await send(app, 'aal1');
    expect(blocked.statusCode).toBe(403); expect(blocked.json().issue[0].details.text).toMatch(/Two-factor/);
    expect(w.sends).toBe(0);
    const ok = await send(app, 'aal2');
    expect(ok.json().issue?.[0]?.details?.text ?? '').not.toMatch(/Two-factor/);   // got past the gate (then 404: no such referral here)
  });
  it('no token is still a 401, not a two-factor message', async () => {
    const r = await (await make(true)).inject({ method: 'POST', url: `/encounters/${E}/review`, payload: { action: 'approve', assessmentId: A } });
    expect(r.statusCode).toBe(401);
  });
  it('/me tells the screen what level the session has', async () => {
    const app = await make(true);
    expect((await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer aal1' } })).json()).toMatchObject({ aal: 'aal1', mfaRequired: true });
    expect((await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer aal2' } })).json()).toMatchObject({ aal: 'aal2', mfaRequired: true });
    expect((await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer legacy' } })).json()).toMatchObject({ aal: 'aal1' });
  });
});

describe('when it is not required', () => {
  it.each([[false], [undefined]])('a single-factor session reviews as before (requireMfa=%s)', async flag => {
    const r = await review(await make(flag), 'aal1');
    expect(r.statusCode).toBe(201); expect(w.audits.some(x => x.entityType === 'mfa_gate')).toBe(false);
  });
  it('/me says two-factor is not required', async () => {
    expect((await (await make(false)).inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer aal1' } })).json().mfaRequired).toBe(false);
  });
});
