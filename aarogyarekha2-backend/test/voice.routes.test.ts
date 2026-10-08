import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { AiError } from '../src/ai/provider.js';
import type { Transcribe } from '../src/ai/stt.js';
import type { AuditEvent, ConsentBrief, Deps, UserReader, UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const patient = { id: P, public_ref: 'AR-0001', registered_facility_id: F, full_name: 'Anita Rao', phone: '+919876543210' } as unknown as PatientRow;
const encRow = (over: Partial<EncounterRow> = {}): EncounterRow => ({ id: E, patient_id: P, facility_id: F, status: 'draft', scenario: 'opd_queue', language: 'hi', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-07T09:00:00Z', updated_at: '2026-10-07T09:00:00Z', ...over });
const consent = (purpose: string, over: Partial<ConsentBrief> = {}): ConsentBrief => ({ id: 'c-' + purpose, purpose, granted_at: '2026-10-01T08:00:00Z', revoked_at: null, expires_at: null, ...over });
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

interface World { enc: EncounterRow; consents: ConsentBrief[]; triageConsent: boolean; transcribe: Transcribe; calls: { bytes: number; mime: string; language?: string }[]; runs: { status: string; chars: number; purpose?: string }[]; runFails: boolean; audits: AuditEvent[]; supported: boolean; noTranscriber: boolean }
let w: World;

const make = async () => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => (t === 'clinician' ? patient : null), getIdentifiers: async () => [], getEncounter: async id => (t === 'clinician' && id === E ? w.enc : null), getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
    getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => w.consents, getNames: async () => ({}),
    listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const impl: Partial<UserWriter> = { hasActiveConsent: async () => w.triageConsent };
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null), userReader: reader, userWriter: () => impl as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) },
    ...(w.noTranscriber ? {} : { transcriber: { name: 'gemini' as const, model: 'gemini-x', supported: w.supported, transcribe: async (a: Parameters<Transcribe>[0]) => { w.calls.push({ bytes: a.bytes.length, mime: a.mime, language: a.language }); return w.transcribe(a); } } }),
    saveSymptomTranslations: async () => {}, logExternalRun: async a => { if (w.runFails) throw new Error('db down'); w.runs.push({ status: a.status, chars: a.chars, purpose: a.purpose }); },
    readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    audit: async e => { w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;

const BOUNDARY = 'XBOUNDARYX';
function form(file: Buffer | null, fields: Record<string, string> = {}): { payload: Buffer; headers: Record<string, string> } {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) { parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="audio"; filename="a.webm"\r\nContent-Type: audio/webm\r\n\r\n`)); parts.push(file); parts.push(Buffer.from('\r\n')); }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` } };
}
const post = (app: App, file: Buffer | null = WEBM, fields: Record<string, string> = {}, token: string | null = 'clinician') => {
  const f = form(file, fields);
  return app.inject({ method: 'POST', url: `/encounters/${E}/transcribe`, payload: f.payload, headers: { ...f.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
};

beforeEach(() => {
  w = { enc: encRow(), consents: [consent('care_triage'), consent('external_ai_processing')], triageConsent: true, transcribe: async () => ({ text: 'bukhar teen din se', language: 'hi', provider: 'gemini', model: 'gemini-x' }),
    calls: [], runs: [], runFails: false, audits: [], supported: true, noTranscriber: false };
});

describe('consent and access', () => {
  it('without the patient\'s consent to outside AI the recording is never sent', async () => {
    w.consents = [consent('care_triage')];
    const r = await post(await make());
    expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/hearing their voice/);
    expect(w.calls).toHaveLength(0);
  });
  it.each([['revoked', { revoked_at: '2026-10-07T08:30:00Z' }], ['expired', { expires_at: '2026-10-02T00:00:00Z' }]])('a %s consent does not count', async (_n, over) => {
    w.consents = [consent('external_ai_processing', over)];
    expect((await post(await make())).statusCode).toBe(403); expect(w.calls).toHaveLength(0);
  });
  it('needs triage consent too; a stranger gets 404; no login gets 401', async () => {
    const app = await make();
    w.triageConsent = false; expect((await post(app)).statusCode).toBe(403); w.triageConsent = true;
    expect((await post(app, WEBM, {}, 'outsider')).statusCode).toBe(404);
    expect((await post(app, WEBM, {}, null)).statusCode).toBe(401);
    expect(w.calls).toHaveLength(0);
  });
  it('a closed encounter cannot take new input', async () => {
    w.enc = encRow({ status: 'closed' });
    expect((await post(await make())).statusCode).toBe(409); expect(w.calls).toHaveLength(0);
  });
});

describe('the recording', () => {
  it('sends real audio with the chosen language, returns a draft transcript marked as machine output, and logs size only', async () => {
    const r = await post(await make(), WEBM, { language: 'hi' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ text: 'bukhar teen din se', language: 'hi', provider: 'gemini', model: 'gemini-x', machineTranscript: true });
    expect(w.calls).toEqual([{ bytes: WEBM.length, mime: 'audio/webm', language: 'hi' }]);
    expect(w.runs).toEqual([{ status: 'ok', chars: WEBM.length, purpose: 'transcription' }]);
    const a = w.audits.find(x => x.entityType === 'transcription')!;
    expect(JSON.stringify(a)).not.toContain('bukhar');
  });
  it('refuses anything that is not audio, whatever the browser claimed', async () => {
    const r = await post(await make(), Buffer.from('%PDF-1.4 not audio'));
    expect(r.statusCode).toBe(400); expect(r.json().issue[0].details.text).toMatch(/not a supported audio/);
    expect(w.calls).toHaveLength(0);
  });
  it('refuses an empty upload, a missing file and an unknown language', async () => {
    const app = await make();
    expect((await post(app, null)).statusCode).toBe(400);
    expect((await post(app, WEBM, { language: 'fr' })).statusCode).toBe(400);
    expect(w.calls).toHaveLength(0);
  });
  it('refuses a recording over 2 MB', async () => {
    const big = Buffer.concat([WEBM, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const r = await post(await make(), big);
    expect(r.statusCode).toBe(413); expect(w.calls).toHaveLength(0);
  });
  it('wants multipart', async () => {
    const r = await (await make()).inject({ method: 'POST', url: `/encounters/${E}/transcribe`, payload: {}, headers: { authorization: 'Bearer clinician' } });
    expect(r.statusCode).toBe(415);
  });
});

describe('failures are plain and leave nothing behind', () => {
  it('not set up: no transcriber, or a provider that cannot hear', async () => {
    w.noTranscriber = true; expect((await post(await make())).statusCode).toBe(503);
    w.noTranscriber = false; w.supported = false; expect((await post(await make())).statusCode).toBe(503);
    expect(w.calls).toHaveLength(0);
  });
  it.each([['timeout', 'timeout'], ['rejected', 'rejected'], ['network', 'error'], ['bad_response', 'error']] as const)('a %s failure is logged as %s and says to type instead', async (kind, logged) => {
    w.transcribe = async () => { throw new AiError(kind, 'x'); };
    const r = await post(await make());
    expect(r.statusCode).toBe(502); expect(r.json().issue[0].details.text).toMatch(/Type the complaint/);
    expect(w.runs).toEqual([{ status: logged, chars: WEBM.length, purpose: 'transcription' }]);
  });
  it('not_configured from the provider is 503 and is not logged as a call', async () => {
    w.transcribe = async () => { throw new AiError('not_configured', 'x'); };
    expect((await post(await make())).statusCode).toBe(503); expect(w.runs).toHaveLength(0);
  });
  it('if the outside call cannot be logged the transcript is dropped, not returned', async () => {
    w.runFails = true;
    const r = await post(await make());
    expect(r.statusCode).toBe(503); expect(JSON.stringify(r.json())).not.toContain('bukhar');
  });
});
