import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, UserReader, UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';
import { ReviewError, type ReviewArgs, type ReviewResult } from '../src/review/record.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const A = '44444444-4444-4444-8444-444444444444';

const patient = { id: P, registered_facility_id: F, full_name: 'Test Patient' } as unknown as PatientRow;
const enc: EncounterRow = { id: E, patient_id: P, facility_id: F, status: 'submitted', scenario: 'opd_queue', language: 'en', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z' };

interface World { consent: boolean; calls: ReviewArgs[]; audits: AuditEvent[]; fail?: unknown; result: ReviewResult }
let w: World;

const make = async () => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => (t === 'clinician' ? patient : null), getIdentifiers: async () => [], getEncounter: async id => (t === 'clinician' && id === E ? enc : null), getVitals: async () => [],
    listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null, listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null, getMe: async () => ({ displayName: null, memberships: [] }),
  });
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null),
    userReader: reader,
    userWriter: () => ({ hasActiveConsent: async () => w.consent }) as unknown as UserWriter,
    assess: async () => { throw new Error('unused'); },
    review: async a => { w.calls.push(a); if (w.fail) throw w.fail; return w.result; },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }), sendReferral: async () => { throw new Error('unused'); },
    audit: async e => { w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const post = (app: App, body: unknown, token: string | null = 'clinician', id = E) =>
  app.inject({ method: 'POST', url: `/encounters/${id}/review`, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  w = { consent: true, calls: [], audits: [], result: { reviewId: 'r1', action: 'approve', fromUrgency: 'orange', effectiveUrgency: 'orange', rulesUrgency: 'orange', downgrade: false, belowRuleFloor: false, facilityId: F, patientId: P } };
});

const approve = { action: 'approve', assessmentId: A };
const override = { action: 'override', assessmentId: A, toUrgency: 'red', reasonCode: 'clinical_judgement', reason: 'Looks worse than the numbers show' };

describe('approve', () => {
  it('records the sign-off as the signed-in user, against the assessment they saw', async () => {
    const r = await post(await make(), approve);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ reviewId: 'r1', action: 'approve', effectiveUrgency: 'orange' });
    expect(w.calls).toEqual([{ reviewerId: 'u-clinician', encounterId: E, assessmentId: A, action: 'approve' }]);
  });
  it('audits the sign-off with ids and flags only', async () => {
    await post(await make(), approve);
    expect(w.audits[0]).toMatchObject({ action: 'update', entityType: 'review', entityId: 'r1', patientId: P, facilityId: F, outcome: 'success', actor: 'u-clinician' });
    expect(JSON.stringify(w.audits)).not.toContain('Test Patient');
  });
  it('cannot be performed on behalf of someone else: the reviewer is always the caller', async () => {
    expect((await post(await make(), { ...approve, reviewerId: 'someone-else' })).statusCode).toBe(400);
    expect(w.calls).toHaveLength(0);
  });
});

describe('override', () => {
  it('sends the new priority with the reason code and text, and the confirmation flag', async () => {
    const r = await post(await make(), { ...override, confirmDowngrade: true });
    expect(r.statusCode).toBe(201);
    expect(w.calls[0]).toMatchObject({ action: 'override_urgency', toUrgency: 'red', confirmDowngrade: true, reason: '[clinical_judgement] Looks worse than the numbers show' });
  });
  it('defaults the confirmation to false', async () => {
    await post(await make(), override);
    expect(w.calls[0]!.confirmDowngrade).toBe(false);
  });
  it('keeps the reason text out of the audit entry but records the reason code', async () => {
    w.result = { ...w.result, action: 'override_urgency', effectiveUrgency: 'red', downgrade: false };
    await post(await make(), override);
    const a = w.audits.find(x => x.outcome === 'success')!;
    expect(JSON.stringify(a)).not.toContain('Looks worse');
    expect(a.details).toMatchObject({ action: 'override_urgency', to: 'red', reasonCode: 'clinical_judgement', belowRuleFloor: false });
  });
  it('records when an override goes below a rule floor', async () => {
    w.result = { ...w.result, action: 'override_urgency', effectiveUrgency: 'green', downgrade: true, belowRuleFloor: true };
    const r = await post(await make(), { ...override, toUrgency: 'green', confirmDowngrade: true });
    expect(r.json()).toMatchObject({ downgrade: true, belowRuleFloor: true });
    expect(w.audits.find(x => x.outcome === 'success')!.details).toMatchObject({ downgrade: true, belowRuleFloor: true });
  });
  it.each([
    ['a short reason', { reason: 'too short' }], ['no reason code', { reasonCode: undefined }], ['an unknown reason code', { reasonCode: 'because' }],
    ['an unknown priority', { toUrgency: 'purple' }], ['a very long reason', { reason: 'x'.repeat(501) }], ['an unexpected field', { extra: 1 }], ['a non-UUID assessment', { assessmentId: 'abc' }],
  ])('rejects %s before touching the database', async (_n, patch) => {
    expect((await post(await make(), { ...override, ...patch })).statusCode).toBe(400);
    expect(w.calls).toHaveLength(0);
  });
  it('does not echo the submitted reason in a validation error', async () => {
    const r = await post(await make(), { ...override, reason: 'SECRET', toUrgency: 'nope' });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('SECRET');
  });
});

describe('access', () => {
  it('401 without a login', async () => { expect((await post(await make(), approve, null)).statusCode).toBe(401); });
  it('404 for an encounter the caller cannot see, and the review function is never called', async () => {
    const r = await post(await make(), approve, 'outsider');
    expect(r.statusCode).toBe(404);
    expect(w.calls).toHaveLength(0);
  });
  it('403 without active consent, and nothing is recorded', async () => {
    w.consent = false;
    expect((await post(await make(), approve)).statusCode).toBe(403);
    expect(w.calls).toHaveLength(0);
  });
  it('400 for a bad encounter id', async () => { expect((await post(await make(), approve, 'clinician', 'nope')).statusCode).toBe(400); });
});

describe('refusals are explained in plain words and audited as denied', () => {
  it.each([
    ['forbidden', 403, /nurse, doctor or medical officer/], ['stale', 409, /changed while you were reviewing/], ['already_reviewed', 409, /already been reviewed/],
    ['confirm_downgrade', 409, /explicit confirmation/], ['wrong_state', 409, /no assessment to review|no longer be reviewed/], ['invalid', 400, /priority and the reason/], ['not_found', 404, /No such encounter/],
  ] as const)('%s', async (kind, status, text) => {
    w.fail = new ReviewError(kind, ({
      forbidden: 'Only a nurse, doctor or medical officer at this facility can review a triage assessment.', stale: 'The assessment changed while you were reviewing. Open the latest assessment and review that one.',
      already_reviewed: 'This assessment has already been reviewed.', confirm_downgrade: 'Making the case less urgent than the rules set needs your explicit confirmation.',
      wrong_state: 'This encounter has no assessment to review, or it can no longer be reviewed.', invalid: 'The review could not be recorded. Check the priority and the reason.', not_found: 'No such encounter, or you do not have access.',
    } as const)[kind]);
    const r = await post(await make(), approve);
    expect(r.statusCode).toBe(status);
    expect(r.json().issue[0].details.text).toMatch(text);
    expect(w.audits.find(a => a.entityType === 'review')).toMatchObject({ outcome: 'denied', details: { kind } });
  });
  it('an unexpected failure is a generic 502 with no internals', async () => {
    w.fail = new Error('connection to db.secret-host refused');
    const r = await post(await make(), approve);
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('secret-host');
  });
});
