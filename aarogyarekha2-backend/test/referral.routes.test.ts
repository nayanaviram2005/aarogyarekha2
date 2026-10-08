import { indexStructureDefinitionBundle, validateResource } from '@medplum/core';
import { readJson } from '@medplum/definitions';
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type ConsentBrief, type Deps, type EncounterSummary, type FacilityRow, type ReferralRow, type UserReader, type UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';
import { canonicalJson } from '../src/triage/engine.js';
import { SendError, SEND_TEXT, type SendReferralArgs } from '../src/referral/send.js';

const P = '11111111-1111-4111-8111-111111111111';
const F1 = '22222222-2222-4222-8222-222222222222';
const F2 = '22222222-2222-4222-8222-333333333333';
const E = '33333333-3333-4333-8333-333333333333';
const A = '44444444-4444-4444-8444-444444444444';
const REV = '55555555-5555-4555-8555-555555555555';
const R = '66666666-6666-4666-8666-666666666666';

const patient = { id: P, public_ref: 'AR-0001', registered_facility_id: F1, full_name: 'Test Patient', preferred_language: 'en', sex: 'female', birth_date: null, age_years_reported: 27, phone: '+919999900000', address_line: '12 Secret Lane', village_town: 'Khordha', district: 'Khordha', state: 'Odisha', pincode: '752001', updated_at: '2026-10-06T10:00:00Z' } as unknown as PatientRow;
const enc: EncounterRow = { id: E, patient_id: P, facility_id: F1, status: 'in_review', scenario: 'maternal_followup', language: 'en', chief_complaint_original: 'Headache', chief_complaint_translated: null, submitted_at: '2026-10-06T09:30:00Z', closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T10:00:00Z' };
const FAC: Record<string, FacilityRow> = {
  [F1]: { id: F1, name: 'Seed PHC', type: 'phc', state: 'Odisha', district: 'Khordha', capabilities: [] },
  [F2]: { id: F2, name: 'Seed District Hospital', type: 'district_hospital', state: 'Odisha', district: 'Khordha', capabilities: ['obstetrics'] },
};

const summary = (reviewed: boolean): EncounterSummary => ({
  encounter: enc, patient: { id: P, public_ref: 'AR-0001', full_name: 'Test Patient', sex: 'female', birth_date: null, age_years_reported: 27, preferred_language: 'en' },
  symptoms: [{ id: 's1', text_original: 'Headache', text_translated: null, lang: 'en', duration_value: 2, duration_unit: 'days', severity: 5, created_at: '2026-10-06T09:10:00Z' }],
  vitals: [{ id: 'v1', encounter_id: E, kind: 'temperature_c', value: '37.2', unit: 'Cel', measured_at: '2026-10-06T09:40:00Z' }],
  triageContext: { signs: { convulsions_in_pregnancy: false } },
  assessment: { id: A, version: 1, created_at: '2026-10-06T09:50:00Z', urgency_code: 'orange',
    note: { tier: 2, winning: { layer: 'pregnancy_bp', ruleId: 'WHO-PREG-BP', detail: 'Blood pressure in the severe range for pregnancy (as recorded)' }, log: [], missing: [{ code: 'x', label: 'Not yet assessed: Heavy vaginal bleeding', potentialTier: null }], ruleSet: { name: 'aarogyarekha-layered', version: '0.1.1', hash: 'abc' }, vulnerable: true } as never, signals: [] },
  followUps: [], queue: { urgency_code: 'orange', status: 'in_review', entered_at: '2026-10-06T09:30:00Z' },
  reviews: reviewed ? [{ id: 'rv1', action: 'approve', assessment_id: A, reviewer_id: REV, reviewer_name: 'Dr Mehta', from_urgency_code: 'orange', to_urgency_code: 'orange', reason: null, created_at: '2026-10-06T11:00:00Z' }] : [],
});

interface World {
  reviewed: boolean; triageConsent: boolean; consents: ConsentBrief[]; referrals: Map<string, ReferralRow>; sent: SendReferralArgs[];
  audits: AuditEvent[]; auditFailsOn: (e: AuditEvent) => boolean; sendFail?: unknown; writeFail?: DbError;
}
let w: World;

const refRow = (over: Partial<ReferralRow> = {}): ReferralRow => ({ id: R, encounter_id: E, patient_id: P, from_facility_id: F1, to_facility_id: F2, requested_by: REV, priority: 'asap', reason_text: 'Needs assessment at a higher facility.', status: 'draft', status_reason: null, bundle: null, bundle_sha256: null, sent_at: null, created_at: '2026-10-06T11:10:00Z', updated_at: '2026-10-06T11:10:00Z', ...over });
const sharing = (): ConsentBrief => ({ purpose: 'referral_sharing', granted_at: '2026-10-06T11:05:00Z', revoked_at: null, expires_at: null });
const triage = (): ConsentBrief => ({ purpose: 'care_triage', granted_at: '2026-10-06T08:55:00Z', revoked_at: null, expires_at: null });

const make = async () => {
  const reader = (t: string): UserReader => {
    const sees = t === 'clinician';
    return {
      getPatient: async () => (sees ? patient : null), getIdentifiers: async () => [], getEncounter: async id => (sees && id === E ? enc : null), getVitals: async () => [],
      listPatients: async () => [], getQueue: async () => [], listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null, getMe: async () => ({ displayName: null, memberships: [] }),
      getEncounterSummary: async id => (sees && id === E ? summary(w.reviewed) : null),
      listFacilities: async () => (sees ? Object.values(FAC).filter(f => f.id !== F1) : []), getFacility: async id => (sees ? FAC[id] ?? null : null),
      getReferral: async id => (sees ? w.referrals.get(id) ?? null : null),
      listReferrals: async eid => (sees ? [...w.referrals.values()].filter(r => r.encounter_id === eid).map(({ bundle: _b, ...rest }) => rest) : []),
      getConsents: async () => w.consents, getNames: async ids => Object.fromEntries(ids.map(i => [i, i === REV ? 'Dr Mehta' : null])),
    };
  };
  const writer = (): UserWriter => {
    const impl: Partial<UserWriter> = {
    hasActiveConsent: async () => w.triageConsent,
    createReferral: async r => { if (w.writeFail) throw w.writeFail; const row = refRow({ requested_by: REV, to_facility_id: r.toFacilityId, priority: r.priority, reason_text: r.reasonText }); w.referrals.set(row.id, row); return row; },
    updateReferralDraft: async (id, p) => { if (w.writeFail) throw w.writeFail; const cur = w.referrals.get(id)!; w.referrals.set(id, { ...cur, ...(p.toFacilityId ? { to_facility_id: p.toFacilityId } : {}), ...(p.priority ? { priority: p.priority } : {}), ...(p.reasonText ? { reason_text: p.reasonText } : {}) }); },
    cancelReferral: async id => { if (w.writeFail) throw w.writeFail; w.referrals.set(id, { ...w.referrals.get(id)!, status: 'cancelled' }); },
    };
    return impl as UserWriter;
  };
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null),
    userReader: reader, userWriter: writer,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }), sendReferral: async a => {
      w.sent.push(a); if (w.sendFail) throw w.sendFail;
      w.referrals.set(a.referralId, { ...w.referrals.get(a.referralId)!, status: 'requested', bundle: a.bundle, bundle_sha256: a.sha256, sent_at: '2026-10-06T12:00:00Z' });
      return { referralId: a.referralId, status: 'requested', sentAt: '2026-10-06T12:00:00Z', sha256: a.sha256, facilityId: F1, toFacilityId: F2, patientId: P, encounterId: E };
    },
    audit: async e => { if (w.auditFailsOn(e)) throw new Error('audit down'); w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, token: string | null = 'clinician') =>
  app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeAll(() => {
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json'));
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json'));
});
beforeEach(() => {
  w = { reviewed: true, triageConsent: true, consents: [triage(), sharing()], referrals: new Map(), sent: [], audits: [], auditFailsOn: () => false };
});

const create = { toFacilityId: F2, reasonText: 'Needs assessment at a higher facility.' };
const withDraft = (over: Partial<ReferralRow> = {}) => { w.referrals.set(R, refRow(over)); };

describe('facility directory', () => {
  it('lists other facilities with what they can receive, and needs a login', async () => {
    const app = await make();
    const r = await call(app, 'GET', '/facilities');
    expect(r.statusCode).toBe(200);
    expect(r.json().facilities).toEqual([FAC[F2]]);
    expect((await call(app, 'GET', '/facilities', undefined, null)).statusCode).toBe(401);
  });
});

describe('preparing a referral', () => {
  it('needs a reviewer sign-off first, with a clear message, and creates nothing', async () => {
    w.reviewed = false;
    const r = await call(await make(), 'POST', `/encounters/${E}/referrals`, create);
    expect(r.statusCode).toBe(409);
    expect(r.json().issue[0].details.text).toBe(SEND_TEXT.needs_review);
    expect(w.referrals.size).toBe(0);
  });
  it('creates a draft and suggests the priority from the effective urgency (orange becomes asap)', async () => {
    const r = await call(await make(), 'POST', `/encounters/${E}/referrals`, create);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'draft', priority: 'asap', toFacility: { id: F2, name: 'Seed District Hospital' } });
  });
  it('respects a priority chosen by the person', async () => {
    expect((await call(await make(), 'POST', `/encounters/${E}/referrals`, { ...create, priority: 'stat' })).json().priority).toBe('stat');
  });
  it('audits the creation without patient data', async () => {
    await call(await make(), 'POST', `/encounters/${E}/referrals`, create);
    expect(w.audits[0]).toMatchObject({ action: 'create', entityType: 'referral', patientId: P, facilityId: F1, outcome: 'success' });
    expect(JSON.stringify(w.audits)).not.toMatch(/Test Patient|Needs assessment/);
  });
  it.each([
    ['the same facility as the encounter', { toFacilityId: F1 }, 400], ['a short reason', { reasonText: 'short' }, 400], ['an unknown priority', { priority: 'now' }, 400],
    ['an unexpected field', { requested_by: 'someone' }, 400], ['an unknown facility', { toFacilityId: '99999999-9999-4999-8999-999999999999' }, 404],
  ])('rejects %s', async (_n, patch, status) => {
    const r = await call(await make(), 'POST', `/encounters/${E}/referrals`, { ...create, ...patch });
    expect(r.statusCode).toBe(status);
    expect(w.referrals.size).toBe(0);
  });
  it('refuses a second open referral for the same encounter', async () => {
    withDraft();
    const r = await call(await make(), 'POST', `/encounters/${E}/referrals`, create);
    expect(r.statusCode).toBe(409);
    expect(r.json().issue[0].details.text).toMatch(/already open/);
  });
  it('allows a new referral after the earlier one was cancelled', async () => {
    withDraft({ status: 'cancelled' });
    expect((await call(await make(), 'POST', `/encounters/${E}/referrals`, create)).statusCode).toBe(201);
  });
  it('404 for an encounter the caller cannot see, 403 without triage consent, 401 without a login', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/referrals`, create, 'outsider')).statusCode).toBe(404);
    w.triageConsent = false;
    expect((await call(app, 'POST', `/encounters/${E}/referrals`, create)).statusCode).toBe(403);
    expect((await call(app, 'POST', `/encounters/${E}/referrals`, create, null)).statusCode).toBe(401);
    expect(w.referrals.size).toBe(0);
  });
  it('a health worker is refused with a plain message when the database says no', async () => {
    w.writeFail = new DbError('42501', 'new row violates row-level security policy for table "referrals"');
    const r = await call(await make(), 'POST', `/encounters/${E}/referrals`, create);
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain('referrals"');
    expect(r.json().issue[0].details.text).toMatch(/nurse, doctor or medical officer/);
  });
});

describe('viewing a referral', () => {
  it('a draft shows a preview document, readiness flags, and is audited', async () => {
    withDraft();
    const r = await call(await make(), 'GET', `/referrals/${R}`);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.preview).toBe(true);
    expect(b.readiness).toEqual({ signedOff: true, sharingConsent: true, hasReceiver: true, hasReason: true });
    expect(b.bundle.type).toBe('document');
    expect(b.bundle.entry[0].resource).toMatchObject({ resourceType: 'Composition', status: 'preliminary' });
    expect(w.audits[0]).toMatchObject({ action: 'read', entityType: 'referral', entityId: R, patientId: P });
  });
  it('readiness reflects missing sign-off, consent, receiver and reason', async () => {
    w.reviewed = false; w.consents = [triage()]; withDraft({ to_facility_id: null, reason_text: null });
    expect((await call(await make(), 'GET', `/referrals/${R}`)).json().readiness).toEqual({ signedOff: false, sharingConsent: false, hasReceiver: false, hasReason: false });
  });
  it('a revoked or expired sharing consent is not ready', async () => {
    w.consents = [triage(), { ...sharing(), revoked_at: '2026-10-06T11:30:00Z' }]; withDraft();
    expect((await call(await make(), 'GET', `/referrals/${R}`)).json().readiness.sharingConsent).toBe(false);
  });
  it('a sent referral returns the FROZEN document, not a rebuilt one', async () => {
    const frozen = { resourceType: 'Bundle', type: 'document', entry: [], identifier: { value: 'frozen' } };
    withDraft({ status: 'requested', bundle: frozen as never, bundle_sha256: 'a'.repeat(64), sent_at: '2026-10-06T12:00:00Z' });
    const b = (await call(await make(), 'GET', `/referrals/${R}`)).json();
    expect(b.preview).toBe(false);
    expect(b.bundle).toEqual(frozen);
  });
  it('404 for someone who cannot see it, and nothing is returned when the audit cannot be written', async () => {
    withDraft();
    const app = await make();
    expect((await call(app, 'GET', `/referrals/${R}`, undefined, 'outsider')).statusCode).toBe(404);
    w.auditFailsOn = () => true;
    const r = await call(app, 'GET', `/referrals/${R}`);
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('Test Patient');
  });
  it('lists the referrals of an encounter with the receiving facility name', async () => {
    withDraft();
    const r = await call(await make(), 'GET', `/encounters/${E}/referrals`);
    expect(r.json().referrals).toMatchObject([{ id: R, status: 'draft', toFacility: { name: 'Seed District Hospital' } }]);
  });
});

describe('editing and cancelling a draft', () => {
  it('updates only a draft, and keeps the others', async () => {
    withDraft();
    const app = await make();
    expect((await call(app, 'PUT', `/referrals/${R}`, { priority: 'stat' })).statusCode).toBe(200);
    expect(w.referrals.get(R)).toMatchObject({ priority: 'stat', reason_text: 'Needs assessment at a higher facility.' });
  });
  it('refuses edits to a sent referral, an empty change, the same facility, and unknown fields', async () => {
    withDraft({ status: 'requested' });
    expect((await call(await make(), 'PUT', `/referrals/${R}`, { priority: 'stat' })).statusCode).toBe(409);
    withDraft();
    const app = await make();
    expect((await call(app, 'PUT', `/referrals/${R}`, {})).statusCode).toBe(400);
    expect((await call(app, 'PUT', `/referrals/${R}`, { toFacilityId: F1 })).statusCode).toBe(400);
    expect((await call(app, 'PUT', `/referrals/${R}`, { status: 'requested' })).statusCode).toBe(400);
  });
  it('cancels a draft but not a sent referral', async () => {
    withDraft();
    const app = await make();
    expect((await call(app, 'POST', `/referrals/${R}/cancel`, { reason: 'Patient left' })).statusCode).toBe(200);
    expect(w.referrals.get(R)!.status).toBe('cancelled');
    withDraft({ status: 'requested' });
    expect((await call(app, 'POST', `/referrals/${R}/cancel`, {})).statusCode).toBe(409);
  });
});

describe('sending', () => {
  it('hands the database a valid FHIR document, built from recorded facts, with a matching checksum', async () => {
    withDraft();
    const r = await call(await make(), 'POST', `/referrals/${R}/send`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: R, status: 'requested' });
    expect(w.sent).toHaveLength(1);
    const a = w.sent[0]!;
    expect(a).toMatchObject({ senderId: 'u-clinician', referralId: R, assessmentId: A });
    expect(() => validateResource(a.bundle as never)).not.toThrow();                       // independent structural check
    expect(a.sha256).toBe(createHash('sha256').update(canonicalJson(a.bundle)).digest('hex'));
    expect(a.bundle.entry![0]!.resource).toMatchObject({ resourceType: 'Composition', status: 'final' });
    const json = JSON.stringify(a.bundle);
    for (const secret of ['+919999900000', '12 Secret Lane', '752001']) expect(json).not.toContain(secret);
    expect(json).toContain('Needs assessment at a higher facility.');
  });
  it('records the attempt BEFORE sending and the outcome after', async () => {
    withDraft();
    await call(await make(), 'POST', `/referrals/${R}/send`);
    const phases = w.audits.filter(a => a.action === 'share').map(a => (a.details as { phase: string }).phase);
    expect(phases).toEqual(['attempt', 'sent']);
    expect(JSON.stringify(w.audits)).not.toMatch(/Test Patient|Needs assessment/);
  });
  it('sends nothing at all when the attempt cannot be recorded (fail closed)', async () => {
    withDraft();
    w.auditFailsOn = e => e.action === 'share';
    const r = await call(await make(), 'POST', `/referrals/${R}/send`);
    expect(r.statusCode).toBe(503);
    expect(w.sent).toHaveLength(0);
    expect(w.referrals.get(R)!.status).toBe('draft');
  });
  it.each(['forbidden', 'needs_consent', 'needs_review', 'wrong_state', 'stale', 'invalid', 'not_found'] as const)('a database refusal (%s) is explained in plain words and recorded as refused', async kind => {
    withDraft(); w.sendFail = new SendError(kind, SEND_TEXT[kind]);
    const r = await call(await make(), 'POST', `/referrals/${R}/send`);
    expect(r.statusCode).toBe({ forbidden: 403, needs_consent: 409, needs_review: 409, wrong_state: 409, stale: 409, invalid: 400, not_found: 404 }[kind]);
    expect(r.json().issue[0].details.text).toBe(SEND_TEXT[kind]);
    expect(w.audits.filter(a => a.action === 'share').pop()).toMatchObject({ outcome: 'denied', details: { phase: 'refused', kind } });
    expect(w.referrals.get(R)!.status).toBe('draft');
  });
  it('an unexpected failure says nothing was shared and leaks no internals', async () => {
    withDraft(); w.sendFail = new Error('connection to db.secret-host refused');
    const r = await call(await make(), 'POST', `/referrals/${R}/send`);
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('secret-host');
    expect(r.json().issue[0].details.text).toMatch(/Nothing was shared/);
    expect(w.audits.filter(a => a.action === 'share').pop()).toMatchObject({ outcome: 'error' });
  });
  it('cannot be sent twice, without triage consent, by someone who cannot see it, or without a login', async () => {
    const app = await make();
    withDraft({ status: 'requested' });
    expect((await call(app, 'POST', `/referrals/${R}/send`)).statusCode).toBe(409);
    withDraft(); w.triageConsent = false;
    expect((await call(app, 'POST', `/referrals/${R}/send`)).statusCode).toBe(403);
    w.triageConsent = true;
    expect((await call(app, 'POST', `/referrals/${R}/send`, undefined, 'outsider')).statusCode).toBe(404);
    expect((await call(app, 'POST', `/referrals/${R}/send`, undefined, null)).statusCode).toBe(401);
    expect(w.sent).toHaveLength(0);
  });
});

describe('downloading the sent document', () => {
  it('returns the frozen FHIR document as an attachment and audits the export', async () => {
    const frozen = { resourceType: 'Bundle', type: 'document', entry: [] };
    withDraft({ status: 'requested', bundle: frozen as never, bundle_sha256: 'b'.repeat(64), sent_at: '2026-10-06T12:00:00Z' });
    const r = await call(await make(), 'GET', `/referrals/${R}/bundle`);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/fhir+json');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="referral-66666666\.json"/);
    expect(r.json()).toEqual(frozen);
    expect(w.audits.find(a => a.action === 'export')).toMatchObject({ entityType: 'referral', entityId: R, patientId: P, details: { bundleSha256: 'b'.repeat(64) } });
  });
  it('refuses a draft, withholds the file when the export cannot be audited, and hides it from outsiders', async () => {
    const app = await make();
    withDraft();
    expect((await call(app, 'GET', `/referrals/${R}/bundle`)).statusCode).toBe(409);
    withDraft({ status: 'requested', bundle: { resourceType: 'Bundle' } as never, bundle_sha256: 'c'.repeat(64) });
    expect((await call(app, 'GET', `/referrals/${R}/bundle`, undefined, 'outsider')).statusCode).toBe(404);
    w.auditFailsOn = () => true;
    const r = await call(app, 'GET', `/referrals/${R}/bundle`);
    expect(r.statusCode).toBe(503);
    expect(r.headers['content-disposition']).toBeUndefined();
  });
});

describe('downloading the sent document as a PDF', () => {
  const frozen = { resourceType: 'Bundle', type: 'document', entry: [] };
  it('returns a real PDF as an attachment, sandboxed, and audits the export with the format', async () => {
    withDraft({ status: 'requested', bundle: frozen as never, bundle_sha256: 'b'.repeat(64), sent_at: '2026-10-06T12:00:00Z' });
    const r = await call(await make(), 'GET', `/referrals/${R}/pdf`);
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toBe('application/pdf'); expect(r.headers['content-disposition']).toMatch(/attachment; filename="referral-66666666\.pdf"/); expect(String(r.headers['content-security-policy'])).toContain('sandbox');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(w.audits.find(a => a.action === 'export' && (a.details as { format?: string })?.format === 'pdf')).toMatchObject({ entityType: 'referral', entityId: R, patientId: P });
  });
  it('refuses a draft, hides it from outsiders, requires login, and withholds the file when the export cannot be audited', async () => {
    const app = await make(); withDraft(); expect((await call(app, 'GET', `/referrals/${R}/pdf`)).statusCode).toBe(409);
    withDraft({ status: 'requested', bundle: frozen as never, bundle_sha256: 'c'.repeat(64) });
    expect((await call(app, 'GET', `/referrals/${R}/pdf`, undefined, 'outsider')).statusCode).toBe(404); expect((await call(app, 'GET', `/referrals/${R}/pdf`, undefined, null)).statusCode).toBe(401);
    w.auditFailsOn = () => true; const r = await call(app, 'GET', `/referrals/${R}/pdf`); expect(r.statusCode).toBe(503); expect(r.headers['content-disposition']).toBeUndefined();
  });
});
