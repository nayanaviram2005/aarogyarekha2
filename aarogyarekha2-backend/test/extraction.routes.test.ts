import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type Deps, type DocumentRow, type ExtractionView, type SaveExtractionArgs, type UserReader, type UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';
import { OcrUnavailable, SAMPLE_REPORT, type OcrResult } from '../src/ocr/engines.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const D = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const patient = { id: P, registered_facility_id: F, full_name: 'Test Patient' } as unknown as PatientRow;
const enc: EncounterRow = { id: E, patient_id: P, facility_id: F, status: 'in_review', scenario: 'opd_queue', language: 'en', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z' };
const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({ id: D, patient_id: P, encounter_id: E, facility_id: F, kind: 'lab_report', storage_path: 'p/a/b.pdf', mime_type: 'application/pdf', size_bytes: 10, original_filename: 'x.pdf', scan_status: 'clean', uploaded_by: 'u', created_at: '2026-10-06T10:00:00Z', ...over });

interface World {
  consent: boolean; docs: DocumentRow[]; ocr: () => Promise<OcrResult>; saved: SaveExtractionArgs[]; saveFails: boolean; extraction: ExtractionView | null; audits: AuditEvent[]; auditFails: boolean;
  verified: { id: string; v: unknown }[]; verifyFail?: DbError; downloadFails: boolean; readArgs: unknown[];
}
let w: World;
const ok = (text: string): OcrResult => ({ engine: 'pdf-text-layer', engineVersion: 'pdfjs', text, confidence: 0.99, language: null });
const extraction = (): ExtractionView => ({ id: 'ex1', document_id: D, engine: 'pdf-text-layer', engine_version: 'pdfjs', status: 'completed', language: null, avg_confidence: 0.91, error: null, created_at: '2026-10-06T10:05:00Z', completed_at: '2026-10-06T10:05:01Z',
  fields: [{ id: FID, extraction_id: 'ex1', field_name: 'haemoglobin', extracted_value_text: 'Haemoglobin 9.1 g/dL 12.0 - 15.5 L', value_text: 'Haemoglobin 9.1 g/dL 12.0 - 15.5 L', value_num: 9.1, unit: 'g/dL', reference_range_text: '12.0 - 15.5', printed_flag: 'low', confidence: 0.91, verified_by: null, verified_at: null }] });

let consents: unknown[] = [];
const make = async (over: Partial<Deps> = {}) => {
  const reader = (t: string): UserReader => {
    const sees = t === 'clinician';
    return {
      getPatient: async () => (sees ? patient : null), getIdentifiers: async () => [], getEncounter: async id => (sees && id === E ? enc : null), getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
      getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [],
      getConsents: async () => consents as never, getNames: async () => ({}), listDocuments: async () => [], getDocument: async id => (sees ? w.docs.find(d => d.id === id) ?? null : null), getExtraction: async () => (sees ? w.extraction : null),
    };
  };
  const impl: Partial<UserWriter> = {
    hasActiveConsent: async () => w.consent,
    downloadObject: async () => { if (w.downloadFails) throw new Error('storage down'); return Buffer.from('%PDF-bytes'); },
    verifyField: async (id, v) => { if (w.verifyFail) throw w.verifyFail; w.verified.push({ id, v }); },
  };
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null), userReader: reader, userWriter: () => impl as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async f => { w.readArgs.push({ mime: f.mime, language: f.language }); return w.ocr(); },
    finishUpload: async () => {}, failUpload: async () => {},
    saveExtraction: async a => { if (w.saveFails) throw new Error('db down'); w.saved.push(a); w.extraction = extraction(); return { extractionId: 'ex1' }; },
    audit: async e => { if (w.auditFails) throw new Error('audit down'); w.audits.push(e); },
    ...over,
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, token: string | null = 'clinician') =>
  app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => { w = { consent: true, docs: [doc()], ocr: async () => ok(SAMPLE_REPORT), saved: [], saveFails: false, extraction: null, audits: [], auditFails: false, verified: [], downloadFails: false, readArgs: [] }; });

describe('running the reader', () => {
  it('reads the file, parses rows, stores them with the raw text, and returns the rows without the raw text', async () => {
    const r = await call(await make(), 'POST', `/documents/${D}/extract`, { language: 'hi' });
    expect(r.statusCode).toBe(201);
    expect(w.readArgs[0]).toEqual({ mime: 'application/pdf', language: 'hi' });
    const s = w.saved[0]!;
    expect(s).toMatchObject({ documentId: D, engine: 'pdf-text-layer', status: 'completed', error: null });
    expect(s.rawText).toBe(SAMPLE_REPORT);
    expect(s.fields.map(f => f.fieldName)).toEqual(['haemoglobin', 'wbc_count', 'platelet_count', 'esr', 'glucose_fasting']);
    expect(s.avgConfidence).toBeGreaterThan(0.8);
    const b = r.json().extraction;
    expect(b.fields[0]).toMatchObject({ name: 'haemoglobin', valueNum: 9.1, unit: 'g/dL', printedFlag: 'low', verified: false });
    expect(JSON.stringify(b)).not.toContain('CITY DIAGNOSTIC');                       // raw OCR text is never sent to the browser
  });
  it('audits the run with counts only', async () => {
    await call(await make(), 'POST', `/documents/${D}/extract`);
    expect(w.audits[0]).toMatchObject({ action: 'create', entityType: 'extraction', patientId: P, outcome: 'success', details: { engine: 'pdf-text-layer', fields: 5 } });
    expect(JSON.stringify(w.audits)).not.toMatch(/Haemoglobin|Test Patient/);
  });
  it('a scanned PDF is a plain 422 with advice, and the failed attempt is recorded', async () => {
    w.ocr = async () => { throw new OcrUnavailable('scanned_pdf', 'This PDF is a scan with no text in it. Upload a clear photo of each page instead.'); };
    const r = await call(await make(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/photo/);
    expect(w.saved[0]).toMatchObject({ status: 'failed', fields: [] });
  });
  it('text with no test results is a clear failure, not an empty success', async () => {
    w.ocr = async () => ok('Hello world\nThis is a letter');
    const r = await call(await make(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/No test results/);
    expect(w.saved[0]!.status).toBe('failed');
  });
  it('an unexpected reader crash says nothing about internals', async () => {
    w.ocr = async () => { throw new Error('wasm crash at C:\\secret\\path'); };
    const r = await call(await make(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(422);
    expect(r.body).not.toContain('secret');
  });
  it('refuses unknown languages, a file that was not accepted, and missing storage', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/documents/${D}/extract`, { language: 'fr' })).statusCode).toBe(400);
    w.docs = [doc({ scan_status: 'pending' })];
    expect((await call(app, 'POST', `/documents/${D}/extract`)).statusCode).toBe(409);
    w.docs = [doc()]; w.downloadFails = true;
    const r = await call(app, 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(502); expect(r.body).not.toContain('storage down');
    expect(w.saved).toHaveLength(0);
  });
  it('a database failure saving the result is a plain 502', async () => {
    w.saveFails = true;
    const r = await call(await make(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(502); expect(r.body).not.toContain('db down');
  });
  it('401 without a login, 404 for outsiders, 403 without consent, 400 for a bad id', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/documents/${D}/extract`, undefined, null)).statusCode).toBe(401);
    expect((await call(app, 'POST', `/documents/${D}/extract`, undefined, 'outsider')).statusCode).toBe(404);
    expect((await call(app, 'POST', '/documents/nope/extract')).statusCode).toBe(400);
    w.consent = false;
    expect((await call(app, 'POST', `/documents/${D}/extract`)).statusCode).toBe(403);
    expect(w.readArgs).toHaveLength(0);
  });
});

describe('viewing the rows', () => {
  it('returns the latest extraction, audited, and none when there is none', async () => {
    const app = await make();
    expect((await call(app, 'GET', `/documents/${D}/extraction`)).json().extraction).toBeNull();
    w.extraction = extraction();
    const r = await call(app, 'GET', `/documents/${D}/extraction`);
    expect(r.json().extraction.fields).toHaveLength(1);
    expect(w.audits.at(-1)).toMatchObject({ action: 'read', entityType: 'extraction', details: { fields: 1 } });
  });
  it('404 for outsiders; nothing returned when the read cannot be audited', async () => {
    w.extraction = extraction();
    const app = await make();
    expect((await call(app, 'GET', `/documents/${D}/extraction`, undefined, 'outsider')).statusCode).toBe(404);
    w.auditFails = true;
    const r = await call(app, 'GET', `/documents/${D}/extraction`);
    expect(r.statusCode).toBe(503); expect(r.body).not.toContain('haemoglobin');
  });
});

describe('verifying a row', () => {
  const url = `/documents/${D}/fields/${FID}`;
  it('records the confirmed value as the signed-in person, and audits it without the value', async () => {
    w.extraction = extraction();
    const r = await call(await make(), 'PUT', url, { valueNum: 9.4, unit: 'g/dL' });
    expect(r.statusCode).toBe(200);
    expect(w.verified[0]).toEqual({ id: FID, v: { valueText: '9.4', valueNum: 9.4, unit: 'g/dL' } });
    expect(w.audits.at(-1)).toMatchObject({ action: 'update', entityType: 'extracted_field', entityId: FID, patientId: P, details: { verified: true } });
    expect(JSON.stringify(w.audits)).not.toContain('9.4');
  });
  it('accepts a text value, rejects empty or unknown input, and cannot set who verified', async () => {
    w.extraction = extraction(); const app = await make();
    expect((await call(app, 'PUT', url, { valueText: 'Negative' })).statusCode).toBe(200);
    expect((await call(app, 'PUT', url, {})).statusCode).toBe(400);
    expect((await call(app, 'PUT', url, { valueNum: 1, verified_by: 'someone-else' })).statusCode).toBe(400);
    expect((await call(app, 'PUT', url, { valueNum: Infinity })).statusCode).toBe(400);
  });
  it('404 for a row that is not in this document, for outsiders; 403 when the database refuses; 403 without consent', async () => {
    w.extraction = extraction(); const app = await make();
    expect((await call(app, 'PUT', `/documents/${D}/fields/cccccccc-cccc-4ccc-8ccc-cccccccccccc`, { valueNum: 1 })).statusCode).toBe(404);
    expect((await call(app, 'PUT', url, { valueNum: 1 }, 'outsider')).statusCode).toBe(404);
    w.verifyFail = new DbError('42501', 'update affected no rows');
    expect((await call(app, 'PUT', url, { valueNum: 1 })).statusCode).toBe(403);
    w.verifyFail = undefined; w.consent = false;
    expect((await call(app, 'PUT', url, { valueNum: 1 })).statusCode).toBe(403);
  });
});

describe('reading in the background (?async=1)', () => {
  const settle = () => new Promise(r => setTimeout(r, 30));
  it('answers at once with a job id, then the job shows done and the rows are saved', async () => {
    const app = await make(); const r = await call(app, 'POST', `/documents/${D}/extract?async=1`);
    expect(r.statusCode).toBe(202); expect(r.json()).toMatchObject({ status: 'queued' }); const { jobId } = r.json();
    await settle(); const j = await call(app, 'GET', `/jobs/${jobId}`);
    expect(j.json()).toMatchObject({ jobId, kind: 'extract', status: 'done', documentId: D, error: null }); expect(w.saved).toHaveLength(1); expect(w.saved[0]!.status).toBe('completed');
  });
  it('a report that could not be read is a finished job that carries the plain reason', async () => {
    w.ocr = async () => { throw new OcrUnavailable('scanned_pdf', 'This PDF is a scan with no text in it. Upload a clear photo of each page instead.'); };
    const app = await make(); const { jobId } = (await call(app, 'POST', `/documents/${D}/extract?async=1`)).json(); await settle();
    expect((await call(app, 'GET', `/jobs/${jobId}`)).json()).toMatchObject({ status: 'done', error: expect.stringContaining('photo') });
  });
  it('the same checks run first: a stranger gets 404 and no job starts; a rejected file is 409', async () => {
    const app = await make(); expect((await call(app, 'POST', `/documents/${D}/extract?async=1`, undefined, 'outsider')).statusCode).toBe(404); expect(w.readArgs).toHaveLength(0);
    w.docs = [doc({ scan_status: 'failed' })]; expect((await call(app, 'POST', `/documents/${D}/extract?async=1`)).statusCode).toBe(409);
  });
  it('only the person who started a job can see it; a bad or unknown id is a plain error', async () => {
    const app = await make(); const { jobId } = (await call(app, 'POST', `/documents/${D}/extract?async=1`)).json(); await settle();
    expect((await call(app, 'GET', `/jobs/${jobId}`, undefined, 'outsider')).statusCode).toBe(404); expect((await call(app, 'GET', '/jobs/nope')).statusCode).toBe(400); expect((await call(app, 'GET', '/jobs/99999999-9999-4999-8999-999999999999')).statusCode).toBe(404); expect((await call(app, 'GET', `/jobs/${jobId}`, undefined, null)).statusCode).toBe(401);
  });
  it('the job status never contains report text', async () => {
    const app = await make(); const { jobId } = (await call(app, 'POST', `/documents/${D}/extract?async=1`)).json(); await settle();
    expect(JSON.stringify((await call(app, 'GET', `/jobs/${jobId}`)).json())).not.toMatch(/Haemoglobin|CITY DIAGNOSTIC/);
  });
});

describe('AI second read (vision)', () => {
  const aiConsent = { id: 'c-ai', purpose: 'external_ai_processing', granted_at: '2025-01-01T00:00:00Z', revoked_at: null, expires_at: null };
  let runs: { purpose?: string; status: string; items: number }[]; let visionRows: import('../src/ai/vision.js').VisionRow[]; let visionError: Error | null; let sentBytes: number[];
  const vision = (name: 'gemini' | 'mock' = 'gemini', accepts = true): import('../src/ai/vision.js').Vision => ({
    name, model: 'm', supported: true, accepts: () => accepts,
    read: async ({ bytes }) => { sentBytes.push(bytes.length); if (visionError) throw visionError; return { rows: visionRows, provider: name, model: 'm', dropped: 0 }; },
  });
  const app = (v = vision(), o: Partial<Deps> = {}) => make({ vision: v, logExternalRun: async a => { runs.push(a); }, ...o });
  beforeEach(() => {
    consents = [aiConsent]; runs = []; sentBytes = []; visionError = null;
    visionRows = [{ name: 'Hemoglobin', value: '9.1', unit: 'g/dL', referenceRange: '12.0 - 15.5', flag: 'low' }, { name: 'ESR', value: '30', unit: 'mm/hr', referenceRange: null, flag: null }, { name: 'Haemoglobin A1c', value: '7.2', unit: '%', referenceRange: null, flag: null }];
  });

  it('reads with both and stores what the AI read beside each row, with agreement', async () => {
    const r = await call(await app(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(201); expect(r.json().secondRead.status).toBe('ok');
    const s = w.saved[0]!; expect(s.engine).toBe('pdf-text-layer+gemini');
    const hb = s.fields.find(f => f.fieldName === 'haemoglobin')!; expect(hb).toMatchObject({ agreement: 'agree', secondRead: '9.1' });
    expect(s.fields.find(f => f.fieldName === 'esr')).toMatchObject({ agreement: 'differ', secondRead: '30' });
    expect(s.fields.find(f => f.fieldName === 'esr')!.confidence).toBeLessThanOrEqual(0.5);
    expect(s.fields.find(f => f.fieldName === 'wbc_count')).toMatchObject({ agreement: 'ocr_only' });
    expect(s.fields.find(f => f.fieldName === 'hba1c')).toMatchObject({ agreement: 'ai_only', secondRead: '7.2', confidence: 0.5 });
  });
  it('logs the outside call (counts only) and audits agreement counts', async () => {
    await call(await app(), 'POST', `/documents/${D}/extract`);
    expect(runs).toEqual([expect.objectContaining({ purpose: 'vision_extraction', status: 'ok', items: 1 })]);
    expect(w.audits[0]!.details).toMatchObject({ secondRead: 'ok', agreement: expect.objectContaining({ agree: 1, differ: 1, ai_only: 1 }) }); expect(JSON.stringify(w.audits)).not.toMatch(/9\.1|Haemoglobin|Test Patient/);
  });
  it('sends nothing without the separate AI consent', async () => {
    consents = []; const r = await call(await app(), 'POST', `/documents/${D}/extract`);
    expect(sentBytes).toEqual([]); expect(r.json().secondRead.status).toBe('no_consent'); expect(w.saved[0]!.engine).toBe('pdf-text-layer'); expect(w.saved[0]!.fields.every(f => !f.agreement)).toBe(true);
  });
  it('is not used with the mock provider or a file type the service cannot read', async () => {
    expect((await call(await app(vision('mock')), 'POST', `/documents/${D}/extract`)).json().secondRead.status).toBe('not_set_up');
    expect((await call(await app(vision('gemini', false)), 'POST', `/documents/${D}/extract`)).json().secondRead.status).toBe('unsupported_type'); expect(sentBytes).toEqual([]);
  });
  it('a failing service leaves the OCR result alone and logs the failed call', async () => {
    const { AiError } = await import('../src/ai/provider.js'); visionError = new AiError('timeout', 'slow');
    const r = await call(await app(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(201); expect(r.json().secondRead.status).toBe('unavailable'); expect(runs[0]).toMatchObject({ status: 'timeout' }); expect(w.saved[0]!.fields).toHaveLength(5);
  });
  it('if the outside call cannot be recorded, the AI rows are not used', async () => {
    const r = await call(await app(vision(), { logExternalRun: async () => { throw new Error('log down'); } }), 'POST', `/documents/${D}/extract`);
    expect(r.json().secondRead.status).toBe('unavailable'); expect(w.saved[0]!.fields.every(f => !f.agreement)).toBe(true);
  });
  it('rescues a report the local reader could not read at all', async () => {
    w.ocr = async () => ok('smudged text with no rows');
    const r = await call(await app(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(201); expect(w.saved[0]).toMatchObject({ status: 'completed', error: null }); expect(w.saved[0]!.fields.every(f => f.agreement === 'ai_only')).toBe(true); expect(w.saved[0]!.fields).toHaveLength(3);
  });
  it('and when the OCR throws, the AI rows still save', async () => {
    w.ocr = async () => { throw new Error('boom'); };
    const r = await call(await app(), 'POST', `/documents/${D}/extract`);
    expect(r.statusCode).toBe(201); expect(w.saved[0]).toMatchObject({ engine: 'gemini', status: 'completed' });
  });
  it('with no rows from the AI and none from OCR it still says nothing was found', async () => {
    w.ocr = async () => ok('nothing here'); visionRows = [];
    const r = await call(await app(), 'POST', `/documents/${D}/extract`); expect(r.statusCode).toBe(422);
  });
});
