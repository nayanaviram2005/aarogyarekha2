import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, EncounterSummary, PatientBrief, QueueEntry, UserReader } from '../src/deps.js';
import { sortQueue } from '../src/queue/sort.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const brief = (over: Partial<PatientBrief> = {}): PatientBrief => ({ id: P, public_ref: 'AR-0001', full_name: 'Test Patient', sex: 'female', birth_date: '1990-01-01', age_years_reported: null, preferred_language: 'en', ...over });
const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  encounterId: E, patient: brief(), scenario: 'opd_queue', chiefComplaint: 'Fever', chiefComplaintTranslated: null, assessed: true, urgencyCode: 'yellow', tier: 3,
  potentialTier: null, missingCount: 0, winningLabel: null, vulnerable: false, queueStatus: 'waiting', waitingSince: '2026-10-06T09:00:00Z', assessmentVersion: 1, engineTier: 3, reviewed: false, ...over,
});

describe('queue ordering', () => {
  const at = (h: number) => `2026-10-06T${String(h).padStart(2, '0')}:00:00Z`;
  const order = (xs: QueueEntry[]) => sortQueue(xs).map(x => x.encounterId);

  it('most urgent tier first', () => {
    expect(order([entry({ encounterId: 'routine', tier: 4 }), entry({ encounterId: 'emergency', tier: 1 }), entry({ encounterId: 'urgent', tier: 2 })])).toEqual(['emergency', 'urgent', 'routine']);
  });
  it('an unassessed encounter ranks as tier 3, never as routine', () => {
    expect(order([entry({ encounterId: 'routine', tier: 4 }), entry({ encounterId: 'unassessed', assessed: false, tier: null })])).toEqual(['unassessed', 'routine']);
  });
  it('an unassessed encounter still ranks behind a confirmed tier 1 or 2', () => {
    expect(order([entry({ encounterId: 'unassessed', assessed: false, tier: null }), entry({ encounterId: 'urgent', tier: 2 })])).toEqual(['urgent', 'unassessed']);
  });
  it('within a tier, unassessed comes before assessed', () => {
    expect(order([entry({ encounterId: 'assessed3', tier: 3 }), entry({ encounterId: 'unassessed', assessed: false, tier: null })])).toEqual(['unassessed', 'assessed3']);
  });
  it('then vulnerable patients first, then the longest wait', () => {
    expect(order([
      entry({ encounterId: 'late', tier: 3, waitingSince: at(11) }),
      entry({ encounterId: 'early', tier: 3, waitingSince: at(8) }),
      entry({ encounterId: 'child', tier: 3, vulnerable: true, waitingSince: at(10) }),
    ])).toEqual(['child', 'early', 'late']);
  });
  it('a vulnerable patient never jumps ahead of a more urgent tier', () => {
    expect(order([entry({ encounterId: 'childRoutine', tier: 4, vulnerable: true }), entry({ encounterId: 'adultUrgent', tier: 2 })])).toEqual(['adultUrgent', 'childRoutine']);
  });
  it('does not change the input and keeps an item with no wait time last in its group', () => {
    const xs = [entry({ encounterId: 'nowait', waitingSince: null }), entry({ encounterId: 'waited', waitingSince: at(8) })];
    const copy = [...xs];
    expect(order(xs)).toEqual(['waited', 'nowait']);
    expect(xs).toEqual(copy);
  });
});

const summary = (): EncounterSummary => ({
  encounter: { id: E, patient_id: P, facility_id: F, status: 'submitted', scenario: 'opd_queue', language: 'en', chief_complaint_original: 'Fever', chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z' },
  patient: brief(), symptoms: [], vitals: [], triageContext: {}, assessment: null, followUps: [], queue: null, reviews: [],
});

interface World { patients: PatientBrief[]; queue: QueueEntry[]; summary: EncounterSummary | null; audits: AuditEvent[]; auditFails: boolean; consent: boolean | null; listArgs: unknown[] }
const make = async (w: World, token = 'clinician') => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => null, getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [],
    listPatients: async (q, limit) => { w.listArgs.push([q, limit]); return t === 'clinician' ? w.patients : []; },
    getQueue: async () => (t === 'clinician' ? w.queue : []),
    getEncounterSummary: async () => (t === 'clinician' ? w.summary : null),
    listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null, getMe: async () => (t === 'clinician' ? { displayName: 'Seed Nurse', memberships: [{ facilityId: F, facilityName: 'Seed PHC', facilityType: 'phc', role: 'nurse' }] } : { displayName: null, memberships: [] }),
  });
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null),
    userReader: reader,
    userWriter: () => ({ hasActiveConsent: async () => { if (w.consent === null) throw new Error('x'); return w.consent; } }) as never,
    assess: async () => { throw new Error('unused'); },
    review: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }), sendReferral: async () => { throw new Error('unused'); },
    audit: async e => { if (w.auditFails) throw new Error('audit down'); w.audits.push(e); },
  };
  const app = await buildApp({ allowedOrigins: [] }, deps);
  return (url: string, tok: string | null = token) => app.inject({ method: 'GET', url, headers: tok ? { authorization: `Bearer ${tok}` } : {} });
};
const world = (): World => ({ patients: [brief()], queue: [], summary: summary(), audits: [], auditFails: false, consent: true, listArgs: [] });

describe('GET /patients', () => {
  it('requires a login', async () => { expect((await (await make(world()))('/patients', null)).statusCode).toBe(401); });
  it('returns the visible patients and audits the list read without any patient data', async () => {
    const w = world(); const get = await make(w);
    const r = await get('/patients');
    expect(r.statusCode).toBe(200);
    expect(r.json().patients).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ action: 'read', entityType: 'patient_list', outcome: 'success', details: { count: 1, searched: false } });
    expect(JSON.stringify(w.audits)).not.toContain('Test Patient');
  });
  it('a user who can see no patients gets an empty list, not an error', async () => {
    const r = await (await make(world(), 'outsider'))('/patients');
    expect(r.statusCode).toBe(200);
    expect(r.json().patients).toEqual([]);
  });
  it('passes a validated search term and limit through', async () => {
    const w = world(); const get = await make(w);
    await get('/patients?q=Seed%20Patient&limit=10');
    expect(w.listArgs[0]).toEqual(['Seed Patient', 10]);
    expect(w.audits[0]!.details).toMatchObject({ searched: true });
  });
  it('accepts a name in Hindi or Odia', async () => {
    const w = world(); const get = await make(w);
    expect((await get('/patients?q=' + encodeURIComponent('ସୁଧାଂଶୁ'))).statusCode).toBe(200);
    expect((await get('/patients?q=' + encodeURIComponent('राम'))).statusCode).toBe(200);
  });
  it.each([
    ['a comma (filter syntax)', 'a,b'], ['a bracket', 'a)b'], ['a wildcard', 'a%b'], ['too long', 'a'.repeat(61)],
    ['a quote', "a'b"], ['an or-injection', 'x,id.neq.0'],
  ])('rejects %s in the search term before it reaches the database', async (_n, q) => {
    const w = world(); const get = await make(w);
    expect((await get('/patients?q=' + encodeURIComponent(q))).statusCode).toBe(400);
    expect(w.listArgs).toHaveLength(0);
  });
  it('rejects an out-of-range limit and unknown parameters', async () => {
    const get = await make(world());
    expect((await get('/patients?limit=500')).statusCode).toBe(400);
    expect((await get('/patients?limit=0')).statusCode).toBe(400);
    expect((await get('/patients?facility=x')).statusCode).toBe(400);
  });
  it('withholds the list if the audit record cannot be written', async () => {
    const w = world(); w.auditFails = true;
    const r = await (await make(w))('/patients');
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('Test Patient');
  });
});

describe('GET /queue', () => {
  it('returns entries in queue order with a generation time', async () => {
    const w = world();
    w.queue = [entry({ encounterId: 'routine', tier: 4 }), entry({ encounterId: 'emergency', tier: 1 }), entry({ encounterId: 'unassessed', assessed: false, tier: null })];
    const r = await (await make(w))('/queue');
    expect(r.statusCode).toBe(200);
    expect(r.json().entries.map((x: QueueEntry) => x.encounterId)).toEqual(['emergency', 'unassessed', 'routine']);
    expect(Date.parse(r.json().generatedAt)).not.toBeNaN();
  });
  it('is empty for a user with no clinical access, and the read is still audited', async () => {
    const w = world(); w.queue = [entry()];
    const r = await (await make(w, 'outsider'))('/queue');
    expect(r.json().entries).toEqual([]);
    expect(w.audits[0]).toMatchObject({ entityType: 'queue', details: { count: 0 } });
  });
  it('requires a login and fails closed on audit failure', async () => {
    const w = world(); w.auditFails = true; w.queue = [entry()];
    const get = await make(w);
    expect((await get('/queue', null)).statusCode).toBe(401);
    const r = await get('/queue');
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('Test Patient');
  });
});

describe('GET /encounters/:id/summary', () => {
  it('returns the summary with the consent status and audits the read against the patient', async () => {
    const w = world(); const get = await make(w);
    const r = await get(`/encounters/${E}/summary`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ consentActive: true, patient: { full_name: 'Test Patient' } });
    expect(w.audits[0]).toMatchObject({ action: 'read', entityType: 'encounter_summary', entityId: E, patientId: P, facilityId: F, outcome: 'success' });
    expect(JSON.stringify(w.audits)).not.toContain('Test Patient');
  });
  it('reports consent as inactive so the screen can warn', async () => {
    const w = world(); w.consent = false;
    expect((await (await make(w))(`/encounters/${E}/summary`)).json().consentActive).toBe(false);
  });
  it('still returns the summary, with consent unknown, if the consent check itself fails', async () => {
    const w = world(); w.consent = null;
    const r = await (await make(w))(`/encounters/${E}/summary`);
    expect(r.statusCode).toBe(200);
    expect(r.json().consentActive).toBeNull();
  });
  it('404 for a user who cannot see it, recorded as denied and with no data', async () => {
    const w = world();
    const r = await (await make(w, 'outsider'))(`/encounters/${E}/summary`);
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('Test Patient');
    expect(w.audits[0]).toMatchObject({ entityType: 'encounter_summary', outcome: 'denied' });
  });
  it('400 for a bad id, 401 without a login, 503 if the audit cannot be written', async () => {
    const w = world(); const get = await make(w);
    expect((await get('/encounters/nope/summary')).statusCode).toBe(400);
    expect((await get(`/encounters/${E}/summary`, null)).statusCode).toBe(401);
    w.auditFails = true;
    const r = await get(`/encounters/${E}/summary`);
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('Test Patient');
  });
});

describe('GET /me', () => {
  it('requires a login', async () => { expect((await (await make(world()))('/me', null)).statusCode).toBe(401); });
  it('returns the caller, their facilities and roles, with no patient data and no audit entry', async () => {
    const w = world();
    const r = await (await make(w))('/me');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ userId: 'u-clinician', displayName: 'Seed Nurse', memberships: [{ facilityName: 'Seed PHC', role: 'nurse' }] });
    expect(w.audits).toHaveLength(0);
  });
  it('a user with no membership gets an empty list, not an error', async () => {
    const r = await (await make(world(), 'outsider'))('/me');
    expect(r.statusCode).toBe(200);
    expect(r.json().memberships).toEqual([]);
  });
});
