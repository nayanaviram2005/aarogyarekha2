import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, EncounterSummary, UserReader, UserWriter } from '../src/deps.js';
import { ageSexText } from '../src/handover/age.js';
import { handoverContent, pickLang, type HandoverInput } from '../src/handover/summary.js';
import { renderNotePdf } from '../src/referral/pdf.js';
import type { ContextDoc } from '../src/ocr/recordContext.js';

const NOW = new Date('2026-10-10T08:30:00Z');
const base: HandoverInput = {
  patient: { fullName: 'Asha Rao', publicRef: 'AR-0001', sex: 'female', ageText: '27 years, female' }, facilityName: 'Khordha PHC',
  encounter: { language: 'en', complaintOriginal: 'Fever for three days', complaintTranslated: null },
  assessment: { urgencyCode: 'orange', reasons: ['Severe breathing difficulty'], openQuestions: 3 },
  review: { reviewerName: 'Dr R Sen', at: '2026-10-10T08:00:00Z', fromCode: 'orange', toCode: 'orange', reason: null },
  vitals: [{ kind: 'pulse_bpm', value: 80, unit: '/min', at: '2026-10-10T07:00:00Z' }, { kind: 'pulse_bpm', value: 96, unit: '/min', at: '2026-10-10T07:30:00Z' }],
  records: [{ id: 'd', kind: 'lab_report', filename: 'cbc.pdf', createdAt: '2026-10-09', status: 'completed', fields: [{ name: 'haemoglobin', valueText: '9.1', valueNum: 9.1, unit: 'g/dL', printedFlag: 'low', verified: false }, { name: 'esr', valueText: '10', valueNum: 10, unit: 'mm/hr', printedFlag: 'normal', verified: true }] }] as ContextDoc[],
  now: NOW,
};
const text = (c: ReturnType<typeof handoverContent>) => [c.title, ...c.headerLines, ...c.sections.flatMap(s => [s.title, ...s.lines])].join('\n');

describe('handover content', () => {
  it('has the patient, complaint, priority with reasons and sign-off, latest measurements and printed report flags', () => {
    const t = text(handoverContent(base, 'en'));
    expect(t).toContain('Asha Rao'); expect(t).toContain('AR-0001'); expect(t).toContain('27 years, female'); expect(t).toContain('Khordha PHC');
    expect(t).toContain('Fever for three days'); expect(t).toContain('Level: Very urgent'); expect(t).toContain('Severe breathing difficulty');
    expect(t).toContain('Signed off by: Dr R Sen'); expect(t).toContain('Pulse: 96 /min'); expect(t).not.toContain('Pulse: 80');
    expect(t).toContain('haemoglobin 9.1 g/dL (printed LOW, not yet checked by a person)'); expect(t).not.toMatch(/esr 10/);
  });
  it('says plainly when the priority has not been signed off or there is nothing recorded', () => {
    const t = text(handoverContent({ ...base, review: null, assessment: null, vitals: [], records: [] }, 'en'));
    expect(t).toContain('Not signed off yet'); expect(t).toContain('Level: Not assessed yet'); expect(t).toContain('None recorded'); expect(t).toContain('No report results on file');
  });
  it('notes a changed priority with its reason', () => {
    const t = text(handoverContent({ ...base, review: { ...base.review!, fromCode: 'yellow', toCode: 'red', reason: 'Looks worse than the score' } }, 'en'));
    expect(t).toContain('Urgent → changed to Immediate'); expect(t).toContain('Reason: Looks worse than the score');
  });
  it('is written in Hindi or Odia on request, keeps the complaint in its own script, and flags the wording as a draft', () => {
    const hi = text(handoverContent({ ...base, encounter: { ...base.encounter, complaintOriginal: 'तीन दिन से बुखार' } }, 'hi'));
    expect(hi).toContain('हैंडओवर सारांश'); expect(hi).toContain('तीन दिन से बुखार'); expect(hi).toContain('अत्यंत ज़रूरी'); expect(hi).toContain('native-speaker review');
    const or = text(handoverContent(base, 'or')); expect(or).toContain('ହସ୍ତାନ୍ତର ସାରାଂଶ'); expect(or).toContain('ଅତି ଜରୁରୀ');
    expect(text(handoverContent(base, 'en'))).not.toContain('native-speaker');
  });
  it('never advises or diagnoses: only the disclaimer', () => { expect(text(handoverContent(base, 'en'))).toContain('does not diagnose or advise treatment'); });
  it('picks the language: requested, then the visit, then the patient, then English', () => {
    expect(pickLang('hi', 'en', 'or')).toBe('hi'); expect(pickLang(undefined, 'or', 'hi')).toBe('or'); expect(pickLang(undefined, 'xx', 'hi')).toBe('hi'); expect(pickLang(undefined, 'xx', null)).toBe('en');
  });
  it('writes age from a birth date, a reported age, or says it is not recorded', () => {
    expect(ageSexText({ birth_date: '1999-03-12', age_years_reported: null, sex: 'female' }, NOW)).toBe('27 years, female');
    expect(ageSexText({ birth_date: '2026-06-10', age_years_reported: null, sex: 'male' }, NOW)).toBe('4 months, male');
    expect(ageSexText({ birth_date: null, age_years_reported: 40, sex: 'unknown' }, NOW)).toBe('40 years');
    expect(ageSexText({ birth_date: null, age_years_reported: null, sex: 'unknown' }, NOW)).toBe('not recorded');
  });
});

describe('handover PDF', () => {
  it.each(['en', 'hi', 'or'] as const)('renders a real PDF in %s', async lang => {
    const pdf = await renderNotePdf(handoverContent({ ...base, encounter: { ...base.encounter, complaintOriginal: lang === 'or' ? 'ତିନି ଦିନ ଜ୍ୱର' : 'तीन दिन से बुखार' } }, lang), { docTitle: 'Handover summary', checksum: null });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-'); expect(pdf.length).toBeGreaterThan(5000);
  });
  it('can start the font files it needs', () => { expect(readFileSync(new URL('../assets/fonts/public-sans-latin-400-normal.woff', import.meta.url)).length).toBeGreaterThan(1000); });
});

const E = '33333333-3333-4333-8333-333333333333', P = '11111111-1111-4111-8111-111111111111', F = '22222222-2222-4222-8222-222222222222';
interface World { consent: boolean; found: boolean; audits: AuditEvent[]; summaryFails: boolean }
let w: World;
const enc = { id: E, patient_id: P, facility_id: F, status: 'in_review', scenario: 'opd_queue', language: 'en', chief_complaint_original: 'Fever', chief_complaint_translated: null };
const summary = {
  encounter: enc, patient: { id: P, public_ref: 'AR-1', full_name: 'Asha Rao', sex: 'female', birth_date: null, age_years_reported: 27, preferred_language: 'en' }, symptoms: [], vitals: [], triageContext: {},
  assessment: { id: 'a1', version: 1, created_at: '2026-10-10T07:00:00Z', urgency_code: 'yellow', note: {}, signals: [{ signal_code: 's', kind: 'x', source: 'rules', weight: null, display_text: 'Danger sign: Fever with stiff neck' }] },
  followUps: [{ field_code: 'sign.a', question_text: 'q', status: 'open', answer_text: null }], queue: null,
  reviews: [{ id: 'r1', action: 'approve', assessment_id: 'a1', reviewer_id: 'u', reviewer_name: 'Dr R Sen', from_urgency_code: 'yellow', to_urgency_code: 'yellow', reason: null, created_at: '2026-10-10T07:30:00Z' }],
} as unknown as EncounterSummary;
const make = async () => buildApp({ allowedOrigins: [] }, {
  verifyToken: async (t: string) => (t === 'u' ? { userId: 'u1' } : null),
  userReader: () => ({ getEncounter: async () => (w.found ? enc : null), getEncounterSummary: async () => { if (w.summaryFails) throw new Error('x'); return summary; }, getFacility: async () => ({ name: 'Khordha PHC' }), listDocuments: async () => [], getExtraction: async () => null }) as unknown as UserReader,
  userWriter: () => ({ hasActiveConsent: async () => w.consent }) as unknown as UserWriter,
  audit: async (e: AuditEvent) => { w.audits.push(e); },
} as unknown as Deps);
const get = async (q = '', token: string | null = 'u') => (await make()).inject({ method: 'GET', url: `/encounters/${E}/handover.pdf${q}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => { w = { consent: true, found: true, audits: [], summaryFails: false }; });

describe('GET /encounters/:id/handover.pdf', () => {
  it('returns a PDF attachment and audits an export without any content', async () => {
    const r = await get('?lang=hi'); expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf'); expect(r.headers['content-disposition']).toContain('attachment'); expect(r.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const a = w.audits.find(x => x.entityType === 'handover_summary')!; expect(a).toMatchObject({ action: 'export', patientId: P, details: { format: 'pdf', lang: 'hi', signedOff: true } });
    expect(JSON.stringify(a)).not.toMatch(/Asha|Fever/);
  });
  it('needs login, access, consent and a valid language', async () => {
    expect((await get('', null)).statusCode).toBe(401);
    w.found = false; expect((await get()).statusCode).toBe(404); w.found = true;
    w.consent = false; expect((await get()).statusCode).toBe(403); w.consent = true;
    expect((await get('?lang=fr')).statusCode).toBe(400); expect((await get('?x=1')).statusCode).toBe(400);
    w.summaryFails = true; expect((await get()).statusCode).toBe(502);
  });
});
