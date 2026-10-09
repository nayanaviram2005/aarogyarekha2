import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type Deps, type NoteKind, type NoteRow, type UserReader, type UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';

const P = '11111111-1111-4111-8111-111111111111', F = '22222222-2222-4222-8222-222222222222', E = '33333333-3333-4333-8333-333333333333', A = '44444444-4444-4444-8444-444444444444';
const patient = { id: P, registered_facility_id: F } as unknown as PatientRow;
const enc: EncounterRow = { id: E, patient_id: P, facility_id: F, status: 'in_review', scenario: 'opd_queue', language: 'en', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '', updated_at: '' };
interface World { rows: NoteRow[]; added: { encounterId: string; assessmentId?: string | null; kind: NoteKind; body?: string | null }[]; consent: boolean; addError: unknown; audits: AuditEvent[]; noStore: boolean; auditFails: boolean }
let w: World;
const make = async () => {
  const reader = (t: string): UserReader => ({ getPatient: async () => patient, getIdentifiers: async () => [], getEncounter: async id => (t === 'nurse' && id === E ? enc : null), getVitals: async () => [], listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async ids => Object.fromEntries(ids.map(i => [i, 'Nurse Das'])), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null });
  const deps: Deps = {
    verifyToken: async t => (t === 'nurse' || t === 'stranger' ? { userId: 'u-' + t } : null), userReader: reader, userWriter: () => ({ hasActiveConsent: async () => w.consent }) as unknown as UserWriter,
    assess: async () => { throw new Error('x'); }, review: async () => { throw new Error('x'); }, sendReferral: async () => { throw new Error('x'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    ...(w.noStore ? {} : { notes: () => ({ list: async () => w.rows, add: async (a: { encounterId: string; assessmentId?: string | null; kind: NoteKind; body?: string | null }) => { if (w.addError) throw w.addError; w.added.push(a); return { id: 'n1' }; } }) }),
    audit: async e => { if (w.auditFails && e.action === 'read' && e.entityType === 'reviewer_notes') throw new Error('x'); w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', body?: object, token: string | null = 'nurse') => app.inject({ method, url: `/encounters/${E}/notes`, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => { w = { rows: [{ id: 'n0', encounter_id: E, assessment_id: null, author_id: 'u1', kind: 'comment', body: 'Recheck pulse', created_at: '2026-10-07T08:00:00Z' }], added: [], consent: true, addError: null, audits: [], noStore: false, auditFails: false }; });

describe('reading', () => {
  it('lists notes with the author\'s name; the read is audited with a count only', async () => {
    const r = await call(await make(), 'GET'); expect(r.json().notes).toEqual([{ id: 'n0', kind: 'comment', body: 'Recheck pulse', assessmentId: null, author: 'Nurse Das', at: '2026-10-07T08:00:00Z' }]);
    expect(w.audits.find(a => a.entityType === 'reviewer_notes')).toMatchObject({ action: 'read', details: { count: 1 } }); expect(JSON.stringify(w.audits)).not.toContain('Recheck');
  });
  it('a failed audit releases nothing; stranger 404; no consent 403; no login 401; not set up 503', async () => {
    w.auditFails = true; const r = await call(await make(), 'GET'); expect(r.statusCode).toBe(503); expect(JSON.stringify(r.json())).not.toContain('Recheck'); w.auditFails = false;
    const app = await make(); expect((await call(app, 'GET', undefined, 'stranger')).statusCode).toBe(404); w.consent = false; expect((await call(app, 'GET')).statusCode).toBe(403); w.consent = true;
    expect((await call(app, 'GET', undefined, null)).statusCode).toBe(401); w.noStore = true; expect((await call(await make(), 'GET')).statusCode).toBe(503);
  });
});

describe('writing', () => {
  it.each([[{ kind: 'comment', body: 'Recheck pulse' }], [{ kind: 'escalation', body: 'Senior review please' }], [{ kind: 'feedback_up', assessmentId: A }], [{ kind: 'feedback_down', assessmentId: A, body: 'Missed pregnancy' }]])('accepts %j', async b => {
    const r = await call(await make(), 'POST', b); expect(r.statusCode).toBe(201); expect(w.added[0]).toMatchObject({ encounterId: E, kind: b.kind });
  });
  it('audits the kind only, never the text', async () => {
    await call(await make(), 'POST', { kind: 'escalation', body: 'secret clinical wording' }); const a = w.audits.find(x => x.action === 'create')!; expect(a).toMatchObject({ details: { kind: 'escalation' } }); expect(JSON.stringify(a)).not.toContain('secret');
  });
  it.each([['comment without text', { kind: 'comment' }], ['escalation without a reason', { kind: 'escalation', body: '  ' }], ['feedback without an assessment', { kind: 'feedback_up' }], ['unknown kind', { kind: 'approve', body: 'x' }], ['too long', { kind: 'comment', body: 'x'.repeat(1001) }], ['extra field', { kind: 'comment', body: 'x', urgency: 'red' }], ['bad assessment id', { kind: 'feedback_up', assessmentId: 'nope' }]])('rejects %s', async (_n, b) => {
    expect((await call(await make(), 'POST', b)).statusCode).toBe(400); expect(w.added).toHaveLength(0);
  });
  it('a database refusal (not a reviewer) is a plain 403 saying who can', async () => {
    w.addError = new DbError('42501', 'rls'); const r = await call(await make(), 'POST', { kind: 'comment', body: 'x' }); expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/nurse, doctor or medical officer/);
  });
  it('needs consent and access', async () => {
    const app = await make(); w.consent = false; expect((await call(app, 'POST', { kind: 'comment', body: 'x' })).statusCode).toBe(403); w.consent = true; expect((await call(app, 'POST', { kind: 'comment', body: 'x' }, 'stranger')).statusCode).toBe(404); expect(w.added).toHaveLength(0);
  });
});

describe('doctor’s notes', () => {
  const setStatus = (s: string) => { (enc as { status: string }).status = s; };
  afterEach(() => setStatus('in_review'));
  it('adds one after sign-off, up to 2000 characters, and the audit entry holds the kind only', async () => {
    setStatus('reviewed');
    const r = await call(await make(), 'POST', { kind: 'doctor_note', body: 'x'.repeat(2000) });
    expect(r.statusCode).toBe(201); expect(w.added[0]).toMatchObject({ kind: 'doctor_note', body: 'x'.repeat(2000) });
    const a = w.audits.find(x => x.entityType === 'reviewer_notes' && x.action === 'create')!; expect(a.details).toEqual({ kind: 'doctor_note' });
  });
  it('also on a referred or closed visit', async () => {
    for (const s of ['referred', 'closed']) { setStatus(s); expect((await call(await make(), 'POST', { kind: 'doctor_note', body: 'Seen and treated' })).statusCode, s).toBe(201); }
  });
  it('is refused before sign-off, and nothing is written', async () => {
    setStatus('in_review');
    const r = await call(await make(), 'POST', { kind: 'doctor_note', body: 'Too early' });
    expect(r.statusCode).toBe(409); expect(r.json().issue[0].details.text).toMatch(/signed off/); expect(w.added).toHaveLength(0);
  });
  it('needs text, and other notes stay at 1000 characters', async () => {
    setStatus('reviewed'); const app = await make();
    expect((await call(app, 'POST', { kind: 'doctor_note' })).statusCode).toBe(400);
    expect((await call(app, 'POST', { kind: 'doctor_note', body: 'x'.repeat(2001) })).statusCode).toBe(400);
    expect((await call(app, 'POST', { kind: 'comment', body: 'x'.repeat(1001) })).statusCode).toBe(400);
    expect(w.added).toHaveLength(0);
  });
  it('says plainly that only a doctor or medical officer can write one', async () => {
    setStatus('reviewed'); w.addError = new DbError('42501', 'denied');
    const r = await call(await make(), 'POST', { kind: 'doctor_note', body: 'Seen' });
    expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/doctor or medical officer/);
  });
});
