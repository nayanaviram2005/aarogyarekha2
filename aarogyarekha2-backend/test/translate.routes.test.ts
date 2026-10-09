import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { AiError, type Generate } from '../src/ai/provider.js';
import type { AuditEvent, ConsentBrief, Deps, EncounterSummary, UserReader, UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const patient = { id: P, public_ref: 'AR-0001', registered_facility_id: F, full_name: 'Anita Rao', phone: '+919876543210' } as unknown as PatientRow;
const encRow = (over: Partial<EncounterRow> = {}): EncounterRow => ({ id: E, patient_id: P, facility_id: F, status: 'in_review', scenario: 'opd_queue', language: 'hi', chief_complaint_original: 'Anita Rao ko teen din se bukhar, call 9876543210', chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z', ...over });
const sym = (id: string, text: string, lang: string | null, translated: string | null = null) => ({ id, text_original: text, text_translated: translated, lang, duration_value: null, duration_unit: null, severity: null, created_at: '2026-10-06T09:10:00Z' });
const consent = (purpose: string, over: Partial<ConsentBrief> = {}): ConsentBrief => ({ id: 'c-' + purpose, purpose, granted_at: '2026-10-06T08:00:00Z', revoked_at: null, expires_at: null, ...over });

interface World {
  enc: EncounterRow; symptoms: ReturnType<typeof sym>[]; consents: ConsentBrief[]; triageConsent: boolean; gen: Generate; sentToAi: { user: string }[]; runs: { status: string; items: number; chars: number; consentId: string }[]; runFails: boolean;
  savedComplaint: string[]; savedSymptoms: { id: string; text: string }[][]; audits: AuditEvent[]; saveFails: boolean;
}
let w: World;

const make = async () => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => (t === 'clinician' ? patient : null), getIdentifiers: async () => [], getEncounter: async id => (t === 'clinician' && id === E ? w.enc : null), getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
    getEncounterSummary: async () => (t === 'clinician' ? ({ encounter: w.enc, patient: {} as never, symptoms: w.symptoms, vitals: [], triageContext: {}, assessment: null, followUps: [], queue: null, reviews: [] } as EncounterSummary) : null),
    getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => w.consents, getNames: async () => ({}),
    listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const impl: Partial<UserWriter> = {
    hasActiveConsent: async () => w.triageConsent,
    setComplaintTranslation: async (_id, text) => { if (w.saveFails) throw new Error('x'); w.savedComplaint.push(text); },
  };
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null), userReader: reader, userWriter: () => impl as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'gemini', model: 'gemini-x', generate: async r => { w.sentToAi.push({ user: r.user }); return w.gen(r); } },
    saveSymptomTranslations: async items => { if (w.saveFails) throw new Error('x'); w.savedSymptoms.push(items); },
    logExternalRun: async a => { if (w.runFails) throw new Error('db down'); w.runs.push({ status: a.status, items: a.items, chars: a.chars, consentId: a.consentId }); },
    readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    audit: async e => { w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const post = (app: App, token: string | null = 'clinician') => app.inject({ method: 'POST', url: `/encounters/${E}/translate`, headers: token ? { authorization: `Bearer ${token}` } : {} });

const good: Generate = async r => {
  const st = JSON.parse(r.user).statements as { id: string; text: string }[];
  return { text: JSON.stringify({ translations: st.map(s => ({ id: s.id, english: `${s.text.match(/\[\[NAME_\d+\]\]/)?.[0] ?? 'Patient'} has fever for three days` })) }), provider: 'gemini', model: 'gemini-x' };
};

beforeEach(() => {
  w = { enc: encRow(), symptoms: [sym('s1', 'bukhar', 'hi'), sym('s2', 'khansi', 'or'), sym('s3', 'fever', 'en'), sym('s4', 'sir dard', 'hi', 'headache')], consents: [consent('care_triage')], triageConsent: true,
    gen: good, sentToAi: [], runs: [], runFails: false, savedComplaint: [], savedSymptoms: [], audits: [], saveFails: false };
});

describe('consent', () => {
  it('without the patient\'s consent to outside AI nothing is sent, with a plain explanation', async () => {
    w.consents = [];
    const r = await post(await make());
    expect(r.statusCode).toBe(403);
    expect(r.json().issue[0].details.text).toMatch(/No active consent for triage/);
    expect(w.sentToAi).toHaveLength(0);
  });
  it.each([['revoked', { revoked_at: '2026-10-06T08:30:00Z' }], ['expired', { expires_at: '2026-10-05T00:00:00Z' }]])('a %s consent does not count', async (_n, over) => {
    w.consents = [consent('care_triage', over)];
    expect((await post(await make())).statusCode).toBe(403);
    expect(w.sentToAi).toHaveLength(0);
  });
  it('triage consent is needed as well, and a stranger gets 404, no login 401', async () => {
    const app = await make();
    w.triageConsent = false; expect((await post(app)).statusCode).toBe(403); w.triageConsent = true;
    expect((await post(app, 'outsider')).statusCode).toBe(404);
    expect((await post(app, null)).statusCode).toBe(401);
    expect(w.sentToAi).toHaveLength(0);
  });
});

describe('what is sent and what is saved', () => {
  it('sends only what still needs translating, grouped by language, with the patient\'s name and phone removed', async () => {
    await post(await make());
    expect(w.sentToAi).toHaveLength(2);
    const all = w.sentToAi.map(s => s.user).join(' ');
    expect(all).not.toMatch(/Anita|Rao|9876543210|AR-0001/);
    expect(all).toContain('bukhar'); expect(all).toContain('khansi');
    expect(all).not.toContain('"fever"');
    expect(all).not.toContain('sir dard');
  });
  it('saves translations: the complaint on the encounter (with the name restored) and symptoms by id', async () => {
    const r = await post(await make());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ translated: 3, rejected: 0, provider: 'gemini', model: 'gemini-x', machineTranslation: true });
    expect(w.savedComplaint[0]).toBe('Anita Rao has fever for three days');
    expect(w.savedSymptoms.flat().map(s => s.id).sort()).toEqual(['s1', 's2']);
  });
  it('logs the outside call (sizes only) with the consent it relied on, before saving', async () => {
    await post(await make());
    expect(w.runs).toEqual([{ status: 'ok', items: 3, chars: expect.any(Number), consentId: 'c-care_triage' }]);
    expect(JSON.stringify(w.runs)).not.toMatch(/bukhar|Anita/);
  });
  it('audits the translation without the text', async () => {
    await post(await make());
    expect(w.audits.at(-1)).toMatchObject({ action: 'create', entityType: 'translation', patientId: P, details: { translated: 3, provider: 'gemini' } });
    expect(JSON.stringify(w.audits)).not.toMatch(/Anita|bukhar|fever for/);
  });
  it('does nothing when everything is already translated or in English', async () => {
    w.enc = encRow({ chief_complaint_translated: 'already' }); w.symptoms = [sym('s3', 'fever', 'en')];
    const r = await post(await make());
    expect(r.json()).toMatchObject({ translated: 0, nothingToDo: true });
    expect(w.sentToAi).toHaveLength(0); expect(w.runs).toHaveLength(0);
  });
  it('an English encounter sends nothing', async () => {
    w.enc = encRow({ language: 'en' }); w.symptoms = [];
    expect((await post(await make())).json().nothingToDo).toBe(true);
  });
});

describe('untrusted output', () => {
  it('a translation with a diagnosis is dropped (the original stays) and counted', async () => {
    w.gen = async r => { const st = JSON.parse(r.user).statements; return { text: JSON.stringify({ translations: st.map((s: { id: string }) => ({ id: s.id, english: 'Diagnosis: dengue fever' })) }), provider: 'gemini', model: 'm' }; };
    const r = await post(await make());
    expect(r.json()).toMatchObject({ translated: 0, rejected: 3 });
    expect(w.savedComplaint).toHaveLength(0); expect(w.savedSymptoms).toHaveLength(0);
  });
  it('a reply in the wrong shape is a plain 502 and nothing is saved', async () => {
    w.gen = async () => ({ text: 'sorry I cannot', provider: 'gemini', model: 'm' });
    const r = await post(await make());
    expect(r.statusCode).toBe(502);
    expect(w.savedComplaint).toHaveLength(0);
    expect(w.runs[0]).toMatchObject({ status: 'error' });
  });
});

describe('failures', () => {
  it('an unconfigured service is a clear 503, and the attempt is logged', async () => {
    w.gen = async () => { throw new AiError('not_configured', 'x'); };
    const r = await post(await make());
    expect(r.statusCode).toBe(503);
    expect(r.json().issue[0].details.text).toMatch(/not set up/);
  });
  it.each([['timeout', 'timeout'], ['rejected', 'rejected'], ['network', 'error']] as const)('a %s from the service is a plain 502 with no internals, logged as %s', async (kind, logged) => {
    w.gen = async () => { throw new AiError(kind, 'The outside AI service key=SECRET'); };
    const r = await post(await make());
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('SECRET');
    expect(w.runs.at(-1)!.status).toBe(logged);
  });
  it('if the outside call cannot be logged, nothing is saved (a disclosure is never unrecorded)', async () => {
    w.runFails = true;
    const r = await post(await make());
    expect(r.statusCode).toBe(503);
    expect(w.savedComplaint).toHaveLength(0); expect(w.savedSymptoms).toHaveLength(0);
  });
  it('a failure while saving is a plain error', async () => {
    w.saveFails = true;
    expect((await post(await make())).statusCode).toBeGreaterThanOrEqual(400);
  });
});
