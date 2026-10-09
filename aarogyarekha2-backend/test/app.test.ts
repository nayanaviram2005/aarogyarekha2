import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, UserReader } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';

const PID = '11111111-1111-4111-8111-111111111111';
const FID = '22222222-2222-4222-8222-222222222222';
const EID = '33333333-3333-4333-8333-333333333333';
const OTHER = '99999999-9999-4999-8999-999999999999';

const patient: PatientRow = {
  id: PID, public_ref: 'AR-0001', registered_facility_id: FID, full_name: 'Test Patient', preferred_language: 'en',
  sex: 'female', birth_date: '1990-01-01', age_years_reported: null, phone: null, address_line: null,
  village_town: null, district: null, state: null, pincode: null, updated_at: '2026-10-06T10:00:00Z',
};
const encounter: EncounterRow = {
  id: EID, patient_id: PID, facility_id: FID, status: 'submitted', scenario: 'opd_queue', language: 'en',
  chief_complaint_original: 'Fever', chief_complaint_translated: null, submitted_at: '2026-10-06T09:30:00Z',
  closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T10:00:00Z',
};

const readerFor = (visible: { patient?: boolean; encounter?: boolean }): UserReader => ({
  getPatient: async id => (visible.patient && id === PID ? patient : null),
  getIdentifiers: async () => [],
  listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null, listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null, getMe: async () => ({ displayName: 'T', memberships: [] }),
  getEncounter: async id => (visible.encounter && id === EID ? encounter : null),
  getVitals: async () => [{ id: 'v1', encounter_id: EID, kind: 'temperature_c', value: '38.6', unit: 'Cel', measured_at: '2026-10-06T09:40:00Z' }],
});

let audits: AuditEvent[];
let deps: Deps;
const make = async (over: Partial<Deps> = {}, cfg: { rateLimitPerMinute?: number } = {}) => {
  audits = [];
  deps = {
    verifyToken: async t => (t === 'good-clinician' || t === 'good-outsider' ? { userId: 'u-' + t } : null),
    userReader: t => readerFor(t === 'good-clinician' ? { patient: true, encounter: true } : {}),
    userWriter: () => { throw new Error('writer not used in this test'); },
    assess: async () => { throw new Error('assess not used in this test'); },
    review: async () => { throw new Error('review not used in this test'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }), sendReferral: async () => { throw new Error('unused'); },
    audit: async e => { audits.push(e); },
    ...over,
  };
  return buildApp({ allowedOrigins: ['http://localhost:5173'], ...cfg }, deps);
};
const get = (app: Awaited<ReturnType<typeof make>>, url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('authentication gate', () => {
  it('rejects a request with no token and returns no data', async () => {
    const app = await make();
    const r = await get(app, `/fhir/Patient/${PID}`);
    expect(r.statusCode).toBe(401);
    expect(r.body).not.toContain('Test Patient');
  });

  it('rejects an invalid token, and records the failed login', async () => {
    const app = await make();
    const r = await get(app, `/fhir/Patient/${PID}`, 'forged');
    expect(r.statusCode).toBe(401);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'login_failed', outcome: 'denied' });
  });

  it('a verifier that cannot be reached is a clear 503 (not "session expired"), and leaks nothing', async () => {
    const app = await make({ verifyToken: async () => { throw new Error('auth backend down'); } });
    const r = await get(app, `/fhir/Patient/${PID}`, 'anything');
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toMatch(/auth backend down|stack/i);
  });

  it('keeps /health open and PHI-free', async () => {
    const r = await get(await make(), '/health');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: 'ok', app: 'AarogyaRekha' });
  });
});

describe('authorised read', () => {
  it('returns a FHIR Patient with the right content type and no-store caching', async () => {
    const app = await make();
    const r = await get(app, `/fhir/Patient/${PID}`, 'good-clinician');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/fhir+json');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toMatchObject({ resourceType: 'Patient', id: PID });
  });

  it('writes exactly one success audit event naming the actor, patient and facility', async () => {
    const app = await make();
    await get(app, `/fhir/Patient/${PID}`, 'good-clinician');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'read', entityType: 'patient', patientId: PID, facilityId: FID, outcome: 'success', actor: 'u-good-clinician' });
    expect(audits[0]?.requestId).toBeTruthy();
  });

  it('never puts PHI in the audit record', async () => {
    const app = await make();
    await get(app, `/fhir/Patient/${PID}`, 'good-clinician');
    expect(JSON.stringify(audits)).not.toContain('Test Patient');
  });

  it('serves an Observation bundle for an encounter the caller can see', async () => {
    const r = await get(await make(), `/fhir/Observation?encounter=${EID}`, 'good-clinician');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ resourceType: 'Bundle', total: 1 });
    expect(audits[0]).toMatchObject({ entityType: 'observation', patientId: PID, outcome: 'success' });
  });
});

describe('row-level security outcome (record hidden from this user)', () => {
  it('returns 404, not 403, so existence is not disclosed, and returns no patient data', async () => {
    const app = await make();
    const r = await get(app, `/fhir/Patient/${PID}`, 'good-outsider');
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('Test Patient');
  });

  it('is indistinguishable from a record that truly does not exist', async () => {
    const app = await make();
    const hidden = await get(app, `/fhir/Patient/${PID}`, 'good-outsider');
    const missing = await get(app, `/fhir/Patient/${OTHER}`, 'good-clinician');
    expect(hidden.statusCode).toBe(missing.statusCode);
    expect(hidden.json().issue[0].details.text).toBe(missing.json().issue[0].details.text);
  });

  it('records the denied attempt', async () => {
    const app = await make();
    await get(app, `/fhir/Patient/${PID}`, 'good-outsider');
    expect(audits[0]).toMatchObject({ action: 'read', entityType: 'patient', entityId: PID, outcome: 'denied', actor: 'u-good-outsider' });
    expect(audits[0]?.patientId ?? null).toBeNull();
  });

  it('hides encounters and observations the same way', async () => {
    const app = await make();
    expect((await get(app, `/fhir/Encounter/${EID}`, 'good-outsider')).statusCode).toBe(404);
    expect((await get(app, `/fhir/Observation?encounter=${EID}`, 'good-outsider')).statusCode).toBe(404);
  });
});

describe('fail-closed auditing', () => {
  it('withholds the record when the audit write fails', async () => {
    const app = await make({ audit: async () => { throw new Error('db down'); } });
    const r = await get(app, `/fhir/Patient/${PID}`, 'good-clinician');
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('Test Patient');
  });

  it('withholds the 404 path too, rather than answering un-audited', async () => {
    const app = await make({ audit: async () => { throw new Error('db down'); } });
    const r = await get(app, `/fhir/Patient/${PID}`, 'good-outsider');
    expect(r.statusCode).toBe(503);
  });
});

describe('input validation and error handling', () => {
  it('rejects a non-UUID id before touching the database', async () => {
    const reader = vi.fn(readerFor({ patient: true }).getPatient);
    const app = await make({ userReader: () => ({ ...readerFor({ patient: true }), getPatient: reader }) });
    const r = await get(app, '/fhir/Patient/not-a-uuid', 'good-clinician');
    expect(r.statusCode).toBe(400);
    expect(reader).not.toHaveBeenCalled();
  });

  it('rejects an Observation search without an encounter', async () => {
    const r = await get(await make(), '/fhir/Observation', 'good-clinician');
    expect(r.statusCode).toBe(400);
  });

  it('returns a generic 502 and leaks no internals when the data layer fails', async () => {
    const app = await make({ userReader: () => ({ ...readerFor({}), getPatient: async () => { throw new Error('relation "patients" does not exist, host=db.secret'); } }) });
    const r = await get(app, `/fhir/Patient/${PID}`, 'good-clinician');
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('secret');
    expect(r.body).not.toContain('relation');
  });

  it('answers unknown routes with a FHIR OperationOutcome', async () => {
    const r = await get(await make(), '/nope', 'good-clinician');
    expect(r.statusCode).toBe(404);
    expect(r.json().resourceType).toBe('OperationOutcome');
  });

  it('ignores a client-supplied request id header', async () => {
    const app = await make();
    await app.inject({ method: 'GET', url: `/fhir/Patient/${PID}`, headers: { authorization: 'Bearer good-clinician', 'x-request-id': 'attacker-chosen' } });
    expect(audits[0]?.requestId).not.toBe('attacker-chosen');
  });
});

describe('security headers and rate limiting', () => {
  beforeEach(() => void 0);

  it('sets standard hardening headers', async () => {
    const r = await get(await make(), '/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeTruthy();
  });

  it('throttles a burst from one client (the ceiling is configurable; the default is 600 a minute)', async () => {
    const app = await make({}, { rateLimitPerMinute: 120 });
    let last = 200;
    for (let i = 0; i < 130; i++) last = (await get(app, '/health')).statusCode;
    expect(last).toBe(429);
  });
});
