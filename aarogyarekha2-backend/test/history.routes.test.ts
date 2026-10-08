import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type Deps, type HistoryKind, type HistoryRow, type UserReader, type UserWriter } from '../src/deps.js';
import type { PatientRow } from '../src/fhir/project.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const H = '99999999-9999-4999-8999-999999999999';
const patient = { id: P, public_ref: 'AR-1', registered_facility_id: F } as unknown as PatientRow;
const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({ id: H, patient_id: P, kind: 'allergy', text_original: 'penicillin rash', lang: 'en', source: 'health_worker', created_at: '2026-10-06T00:00:00Z', confirmed_by: null, confirmed_at: null, ...over });

interface World { rows: HistoryRow[]; added: { patientId?: string; kind: HistoryKind; text: string; lang?: string }[]; consent: boolean; visible: boolean; addError: unknown; confirmResult: boolean; audits: AuditEvent[]; noStore: boolean; auditFails: boolean }
let w: World;
const make = async () => {
  const reader = (): UserReader => ({
    getPatient: async () => (w.visible ? patient : null), getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [], listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null,
    getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async ids => Object.fromEntries(ids.map(i => [i, 'Dr Das'])),
    listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const deps: Deps = {
    verifyToken: async t => (t === 'u' ? { userId: 'u1' } : null), userReader: reader, userWriter: () => ({ hasActiveConsent: async () => w.consent }) as unknown as UserWriter,
    assess: async () => { throw new Error('x'); }, review: async () => { throw new Error('x'); }, sendReferral: async () => { throw new Error('x'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    ...(w.noStore ? {} : { history: () => ({ list: async () => w.rows, add: async (a: { patientId?: string; kind: HistoryKind; text: string; lang?: string }) => { if (w.addError) throw w.addError; w.added.push(a); return { id: H }; }, confirm: async () => w.confirmResult }) }),
    audit: async e => { if (w.auditFails && e.entityType === 'reported_history' && e.action === 'read') throw new Error('x'); w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, body?: object, token: string | null = 'u') => app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => { w = { rows: [row()], added: [], consent: true, visible: true, addError: null, confirmResult: true, audits: [], noStore: false, auditFails: false }; });

describe('reading', () => {
  it('lists entries as told, with confirmation shown by name, and audits the read with a count only', async () => {
    w.rows = [row(), row({ id: 'b', kind: 'medication', text_original: 'metformin 500 morning', confirmed_by: 'u2', confirmed_at: '2026-10-06T10:00:00Z' })];
    const r = await call(await make(), 'GET', `/patients/${P}/history`);
    expect(r.statusCode).toBe(200);
    expect(r.json().history).toEqual([
      expect.objectContaining({ id: H, kind: 'allergy', text: 'penicillin rash', confirmed: false, confirmedBy: null }),
      expect.objectContaining({ id: 'b', kind: 'medication', confirmed: true, confirmedBy: 'Dr Das' })]);
    expect(w.audits.find(a => a.entityType === 'reported_history' && a.action === 'read')).toMatchObject({ patientId: P, details: { count: 2 } });
    expect(JSON.stringify(w.audits)).not.toMatch(/penicillin|metformin/);
  });
  it('a failed audit releases nothing; no consent 403; stranger 404; no login 401; bad id 400; not set up 503', async () => {
    w.auditFails = true; const r = await call(await make(), 'GET', `/patients/${P}/history`); expect(r.statusCode).toBe(503); expect(JSON.stringify(r.json())).not.toContain('penicillin'); w.auditFails = false;
    const app = await make();
    w.consent = false; expect((await call(app, 'GET', `/patients/${P}/history`)).statusCode).toBe(403); w.consent = true;
    w.visible = false; expect((await call(app, 'GET', `/patients/${P}/history`)).statusCode).toBe(404); w.visible = true;
    expect((await call(app, 'GET', `/patients/${P}/history`, undefined, null)).statusCode).toBe(401);
    expect((await call(app, 'GET', '/patients/nope/history')).statusCode).toBe(400);
    w.noStore = true; expect((await call(await make(), 'GET', `/patients/${P}/history`)).statusCode).toBe(503);
  });
});

describe('adding', () => {
  it('adds an entry as told and audits kind only', async () => {
    const r = await call(await make(), 'POST', `/patients/${P}/history`, { kind: 'medication', text: ' metformin 500 morning ', lang: 'en' });
    expect(r.statusCode).toBe(201); expect(w.added).toEqual([{ patientId: P, kind: 'medication', text: 'metformin 500 morning', lang: 'en' }]);
    expect(w.audits.find(a => a.action === 'create')).toMatchObject({ details: { kind: 'medication' } }); expect(JSON.stringify(w.audits)).not.toContain('metformin');
  });
  it.each([['empty', { kind: 'allergy', text: '  ' }], ['too long', { kind: 'allergy', text: 'x'.repeat(501) }], ['bad kind', { kind: 'diagnosis', text: 'x' }], ['extra field', { kind: 'allergy', text: 'x', source: 'patient' }], ['bad lang', { kind: 'allergy', text: 'x', lang: 'Hindi!' }]])('rejects %s', async (_n, body) => {
    expect((await call(await make(), 'POST', `/patients/${P}/history`, body)).statusCode).toBe(400); expect(w.added).toHaveLength(0);
  });
  it('needs consent; a database refusal is a plain 403', async () => {
    const app = await make(); w.consent = false; expect((await call(app, 'POST', `/patients/${P}/history`, { kind: 'allergy', text: 'x' })).statusCode).toBe(403); w.consent = true;
    w.addError = new DbError('42501', 'rls'); expect((await call(app, 'POST', `/patients/${P}/history`, { kind: 'allergy', text: 'x' })).statusCode).toBe(403);
  });
});

describe('confirming', () => {
  it('confirms, audited', async () => { const r = await call(await make(), 'POST', `/history/${H}/confirm`); expect(r.json()).toEqual({ id: H, confirmed: true }); expect(w.audits.find(a => (a.details as { confirmed?: boolean })?.confirmed)).toBeTruthy(); });
  it('refused (not a reviewer, not found, already confirmed) is a plain 404; bad id 400', async () => {
    w.confirmResult = false; const app = await make();
    expect((await call(app, 'POST', `/history/${H}/confirm`)).statusCode).toBe(404); expect((await call(app, 'POST', '/history/nope/confirm')).statusCode).toBe(400);
  });
});
