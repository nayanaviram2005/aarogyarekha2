import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, DocumentRow, ExtractionView, UserReader, UserWriter } from '../src/deps.js';
import type { EncounterRow } from '../src/fhir/project.js';
import { makeAccessBudget } from '../src/guard/accessBudget.js';
import { reportNotes, summariseRecords, type ContextDoc } from '../src/ocr/recordContext.js';

const P = '11111111-1111-4111-8111-111111111111', F = '22222222-2222-4222-8222-222222222222', E = '33333333-3333-4333-8333-333333333333', D = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const enc = { id: E, patient_id: P, facility_id: F, status: 'submitted' } as unknown as EncounterRow;

const f = (name: string, valueNum: number | null, printedFlag: string | null, verified: boolean, unit: string | null = null) => ({ name, valueText: valueNum === null ? null : String(valueNum), valueNum, unit, printedFlag, verified });
const docs: ContextDoc[] = [
  { id: 'd1', kind: 'lab_report', filename: 'cbc.pdf', createdAt: '2026-10-08', status: 'completed', fields: [f('Haemoglobin', 9.1, 'low', true, 'g/dL'), f('Platelets', 240, 'normal', true), f('WBC', 11200, 'high', false)] },
  { id: 'd2', kind: 'photo', filename: 'x.jpg', createdAt: '2026-10-08', status: 'failed', fields: [] },
];
describe('what the records say', () => {
  it('summarises with the lab\'s own flags, and says which rows no person has checked', () => {
    const s = summariseRecords(docs);
    expect(s).toMatchObject({ documents: 2, read: 1, notRead: 1, rows: 3, verified: 2, flagged: 2 });
    expect(s.lines).toEqual(['Haemoglobin 9.1 g/dL (printed LOW)', 'WBC 11200 (printed HIGH, not yet checked by a person)']);
  });
  it('gives the AI only checked rows, flagged first, with no file names or dates', () => {
    const n = reportNotes(docs);
    expect(n).toEqual(['Haemoglobin 9.1 g/dL (printed LOW)', 'Platelets 240']);
    expect(JSON.stringify(n)).not.toMatch(/cbc|2026|WBC/);
  });
});

describe('the access budget', () => {
  it('lets the same patient be opened again, stops a new one past the limit, and recovers as the hour passes', () => {
    const b = makeAccessBudget(3, 1000);
    for (const p of ['a', 'b', 'c']) expect(b.record('u', p, 0).exceeded).toBe(false);
    expect(b.record('u', 'a', 10).exceeded).toBe(false);
    expect(b.record('u', 'd', 20)).toMatchObject({ exceeded: true, firstTime: true, count: 3 });
    expect(b.record('u', 'e', 30)).toMatchObject({ exceeded: true, firstTime: false });
    expect(b.record('other', 'd', 30).exceeded).toBe(false);
    expect(b.record('u', 'd', 5000).exceeded).toBe(false);
  });
  it('a limit of 0 turns it off', () => { const b = makeAccessBudget(0); for (let i = 0; i < 500; i++) expect(b.record('u', 'p' + i).exceeded).toBe(false); });
});

interface World { audits: AuditEvent[]; docs: DocumentRow[]; ext: Record<string, ExtractionView>; roles: string[]; text: string }
let w: World;
const make = async (budget = 80) => {
  const reader = {
    getPatient: async () => null, getIdentifiers: async () => [], getEncounter: async (id: string) => (id === E ? enc : null), getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
    getEncounterSummary: async (id: string) => ({ encounter: { ...enc, id, patient_id: 'patient-of-' + id } }),
    getMe: async () => ({ displayName: 'N', memberships: w.roles.map(role => ({ facilityId: F, facilityName: 'x', facilityType: 'phc', role })) }),
    listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}),
    listDocuments: async () => w.docs, getDocument: async () => null, getExtraction: async (id: string) => w.ext[id] ?? null,
  } as unknown as UserReader;
  const deps = {
    verifyToken: async (t: string) => (t === 'clinician' ? { userId: 'u-c' } : null), userReader: () => reader, userWriter: () => ({ hasActiveConsent: async () => true }) as unknown as UserWriter,
    readText: async () => ({ engine: 'mock', engineVersion: null, text: w.text, confidence: 0.9, language: 'en' }),
    audit: async (e: AuditEvent) => { w.audits.push(e); },
  } as unknown as Deps;
  return buildApp({ allowedOrigins: [], accessBudgetPerHour: budget }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const auth = { authorization: 'Bearer clinician' };
const upload = (app: App, bytes: Buffer, headers: Record<string, string> = auth) => {
  const B = '----t7MA4YWx';
  const payload = Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="r.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), bytes, Buffer.from(`\r\n--${B}--\r\n`)]);
  return app.inject({ method: 'POST', url: '/intake/records/read', payload, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${B}` } });
};
const pdf = async () => { const d = await PDFDocument.create(); const fnt = await d.embedFont(StandardFonts.Helvetica); d.addPage().drawText('Haemoglobin 9.1 g/dL', { font: fnt, size: 12 }); return Buffer.from(await d.save()); };
beforeEach(() => { w = { audits: [], docs: [], ext: {}, roles: ['nurse'], text: 'Patient Name: Asha Rao   Age: 27 Y   Sex: F\nHaemoglobin 9.1 g/dL 12.0 - 15.5 L' }; });

describe('POST /intake/records/read', () => {
  it('says who the record seems to be about, and the audit entry holds no name', async () => {
    const r = await upload(await make(), await pdf());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ identity: { fullName: 'Asha Rao', ageYears: 27, sex: 'female' }, readable: true });
    const a = w.audits.find(x => x.entityType === 'record_preview')!;
    expect(JSON.stringify(a)).not.toMatch(/Asha/); expect(a.details).toMatchObject({ foundName: true });
  });
  it('is for clinical staff only, needs a sign-in, and refuses files that are not safe', async () => {
    w.roles = ['facility_admin']; expect((await upload(await make(), await pdf())).statusCode).toBe(403);
    w.roles = ['nurse'];
    expect((await upload(await make(), await pdf(), {})).statusCode).toBe(401);
    expect((await upload(await make(), Buffer.from('MZ not a document'))).statusCode).toBe(400);
  });
  it('a report with no readable text still answers, with nothing found', async () => {
    w.text = ''; const r = await upload(await make(), await pdf());
    expect(r.statusCode).toBe(200); expect(r.json().identity).toEqual({});
  });
});

describe('GET /encounters/:id/record-context', () => {
  it('summarises the encounter\'s reports and audits the read', async () => {
    w.docs = [{ id: D, patient_id: P, encounter_id: E, facility_id: F, kind: 'lab_report', scan_status: 'clean', original_filename: 'cbc.pdf', created_at: '2026-10-08' } as unknown as DocumentRow];
    w.ext[D] = { id: 'x', document_id: D, status: 'completed', fields: [{ field_name: 'Haemoglobin', value_text: '9.1', extracted_value_text: '9.1', value_num: 9.1, unit: 'g/dL', printed_flag: 'low', verified_at: null }] } as unknown as ExtractionView;
    const r = await (await make()).inject({ method: 'GET', url: `/encounters/${E}/record-context`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().summary).toMatchObject({ rows: 1, flagged: 1, verified: 0 });
    expect(r.json().documents[0].rows[0]).toMatchObject({ name: 'Haemoglobin', verified: false });
    expect(w.audits.some(a => a.entityType === 'record_context' && a.patientId === P)).toBe(true);
  });
});

describe('the access budget on the API', () => {
  it('pauses opening a new patient past the limit and reports it once; an already-opened patient still opens', async () => {
    const app = await make(2); const open = (id: string) => app.inject({ method: 'GET', url: `/encounters/${id}/summary`, headers: auth });
    const ids = [1, 2, 3].map(n => `44444444-4444-4444-8444-44444444444${n}`);
    expect((await open(ids[0]!)).statusCode).toBe(200);
    expect((await open(ids[1]!)).statusCode).toBe(200);
    const third = await open(ids[2]!);
    expect(third.statusCode).toBe(429); expect(third.body).toMatch(/paused to protect/);
    expect((await open(ids[2]!)).statusCode).toBe(429);
    expect((await open(ids[0]!)).statusCode).toBe(200);
    expect(w.audits.filter(a => a.entityType === 'access_budget')).toHaveLength(1);
    expect(w.audits.find(a => a.entityType === 'access_budget')!.details).toMatchObject({ distinctPatients: 2, limitPerHour: 2 });
  });
});
