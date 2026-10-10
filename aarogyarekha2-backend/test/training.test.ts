import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { EncounterSummary } from '../src/deps.js';
import type { PatientRow } from '../src/fhir/project.js';
import { buildTrainingCase, csvColumns, csvRow, type TrainingInput } from '../src/training/deidentify.js';
import { captureTrainingCase } from '../src/training/capture.js';
import { toCsv, toJsonl } from '../src/training/format.js';
import { makeDbStore, type TrainingStore } from '../src/training/store.js';
import { makeDb } from './helpers/pg.js';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const ENC_ID = '22222222-2222-4222-8222-222222222222';
const FAC_ID = '33333333-3333-4333-8333-333333333333';
const DOC_ID = '44444444-4444-4444-8444-444444444444';

const patient: PatientRow = {
  id: PATIENT_ID, public_ref: 'ARC3B6BEDAE1', registered_facility_id: FAC_ID, full_name: 'Asha Rao', preferred_language: 'hi', sex: 'female', birth_date: '2019-03-04',
  age_years_reported: null, phone: '+919876543210', address_line: '12 Temple Road', village_town: 'Khordha', district: 'Khordha', state: 'Odisha', pincode: '752055', updated_at: '2026-10-09T10:00:00.000Z',
};
const summary = (): EncounterSummary => ({
  encounter: { id: ENC_ID, patient_id: PATIENT_ID, facility_id: FAC_ID, status: 'submitted', scenario: 'opd_queue', language: 'hi', chief_complaint_original: 'Asha Rao ko saans ki takleef hai, call 9876543210', chief_complaint_translated: 'Asha Rao has trouble breathing', submitted_at: '2026-10-10T09:00:00.000Z', closed_at: null, created_at: '2026-10-10T08:58:00.000Z', updated_at: '2026-10-10T09:30:00.000Z' },
  patient: { id: PATIENT_ID, public_ref: 'ARC3B6BEDAE1', full_name: 'Asha Rao', sex: 'female', birth_date: '2019-03-04', age_years_reported: null, preferred_language: 'hi' },
  symptoms: [{ id: 's1', text_original: 'Cough since morning', text_translated: null, lang: 'en', duration_value: 1, duration_unit: 'days', severity: 6, created_at: '2026-10-10T09:01:00.000Z' }],
  vitals: [{ id: 'v1', encounter_id: ENC_ID, kind: 'spo2_pct', value: 90, unit: '%', measured_at: '2026-10-10T09:05:00.000Z' }, { id: 'v2', encounter_id: ENC_ID, kind: 'pulse_bpm', value: 130, unit: '/min', measured_at: '2026-10-10T09:05:00.000Z' }],
  triageContext: { pregnant: false, consciousness: 'alert', onSupplementalOxygen: false, signs: { severe_respiratory_distress: false } },
  assessment: { id: 'a1', version: 1, created_at: '2026-10-10T09:10:00.000Z', urgency_code: 'orange', signals: [], note: { tier: 2, winning: { ruleId: 'PAED-VITALS' }, ruleSet: { name: 'aarogyarekha-layered', version: '0.1.2' }, log: [{ layer: 'paed_vitals', ruleId: 'PAED-VITALS', tier: 2, detail: 'x' }, { layer: 'external', ruleId: 'EXT-ai_second_opinion', tier: 2, detail: 'y' }] } },
  followUps: [{ field_code: 'sign.lethargic', question_text: 'Is the child unusually sleepy?', status: 'answered', answer_text: 'No, Dr Meera Nair checked' }],
  queue: null,
  reviews: [],
});
const input = (): TrainingInput => ({
  key: 'test-key', patient, identifiers: [{ system: 'facility_mrn', value: 'MRN-884421' }], summary: summary(), facilityType: 'phc',
  records: [{ id: DOC_ID, kind: 'lab_report', filename: 'Asha Rao CBC.pdf', createdAt: '2026-10-10T09:02:00.000Z', status: 'completed', fields: [{ name: 'haemoglobin', valueText: null, valueNum: 9.1, unit: 'g/dL', printedFlag: 'low', verified: true }] }],
  review: { id: '55555555-5555-4555-8555-555555555555', action: 'override_urgency', effectiveUrgency: 'red', rulesUrgency: 'orange', reviewerId: '66666666-6666-4666-8666-666666666666', reviewerName: 'Dr Meera Nair', reviewerRole: 'doctor', reason: '[clinical_judgement] Dr Meera Nair saw blue lips on Asha Rao' },
});

describe('anonymised training case', () => {
  const c = buildTrainingCase(input(), new Date('2026-10-10T10:00:00.000Z'));
  const text = JSON.stringify(c);

  it('has no name, phone, reference, address, id, date or clinician name anywhere, including inside the FHIR bundle', () => {
    for (const secret of ['Asha', 'Rao', 'Meera', 'Nair', '9876543210', 'ARC3B6BEDAE1', 'MRN-884421', 'Temple Road', 'Khordha', '752055', PATIENT_ID, ENC_ID, FAC_ID, DOC_ID, '66666666', '2019-03-04', '2026-10-10', '2026-10-09']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('holds back Hindi and Odia script text, which could carry a name written in that script, and keeps the English version', () => {
    const i = input();
    i.summary.encounter.chief_complaint_original = 'आशा राव को सांस की तकलीफ';
    i.summary.symptoms[0]!.text_original = 'ଜ୍ୱର';
    i.summary.symptoms[0]!.text_translated = 'Fever';
    const held = buildTrainingCase(i, new Date('2026-10-10T10:00:00.000Z'));
    expect(held.features.complaint).toBeNull();
    expect(held.features.complaintEnglish).toBe('[NAME] has trouble breathing');
    expect(held.features.symptoms[0]).toMatchObject({ text: null, textEnglish: 'Fever' });
    expect(held.withheldFields).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(held)).not.toMatch(/[ऀ-ॿ଀-୿]/);
  });

  it('keeps what a model needs: the case, the engine output and the clinician-confirmed priority', () => {
    expect(c.features).toMatchObject({ ageYears: 7, sex: 'female', language: 'hi', pregnant: false, facilityType: 'phc', vitals: { spo2_pct: 90, pulse_bpm: 130 } });
    expect(c.features.symptoms[0]).toMatchObject({ text: 'Cough since morning', duration: '1 days', severity: 6 });
    expect(c.features.labResults).toEqual([{ name: 'haemoglobin', value: '9.1', unit: 'g/dL', printedFlag: 'low', verified: true }]);
    expect(c.engine).toMatchObject({ tier: 2, winningRule: 'PAED-VITALS', ruleSet: 'aarogyarekha-layered@0.1.2', extendedCheckTier: 2 });
    expect(c.label).toMatchObject({ finalTier: 1, rulesTier: 2, reviewAction: 'override_urgency', changedByReviewer: true, reviewerRole: 'doctor' });
    expect(c.label.reason).toContain('blue lips');
  });

  it('replaces people and ids with stable pseudonyms', () => {
    expect(c.caseId).toMatch(/^case-[0-9a-f]{12}$/);
    expect(c.label.reviewerId).toMatch(/^clinician-[0-9a-f]{12}$/);
    expect(buildTrainingCase(input()).caseId).toBe(c.caseId);
    expect(buildTrainingCase({ ...input(), key: 'another-key' }).caseId).not.toBe(c.caseId);
  });

  it('is a FHIR bundle of the whole case with the clinician anonymised', () => {
    const types = c.fhir.entry!.map(e => e.resource!.resourceType);
    expect(types).toEqual(expect.arrayContaining(['Patient', 'Encounter', 'Observation', 'Condition', 'Practitioner', 'PractitionerRole']));
    expect(c.fhir.entry!.find(e => e.resource!.resourceType === 'Practitioner')!.resource).toMatchObject({ name: [{ text: 'ANONYMISED CLINICIAN' }] });
    const patientRes = c.fhir.entry!.find(e => e.resource!.resourceType === 'Patient')!.resource as unknown as { name: { text: string }[]; telecom?: unknown; address?: unknown };
    expect(patientRes.name[0]!.text).toBe('ANONYMISED');
    expect(patientRes.telecom).toBeUndefined(); expect(patientRes.address).toBeUndefined();
  });

  it('moves times to a fixed date and keeps only the gaps between them', () => {
    const obs = c.fhir.entry!.map(e => e.resource!).filter(r => r.resourceType === 'Observation' && (r as { effectiveDateTime?: string }).effectiveDateTime) as unknown as { effectiveDateTime: string }[];
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) expect(o.effectiveDateTime.startsWith('2000-01-01T00:05:00')).toBe(true);
  });

  it('gives a flat CSV row with every column', () => {
    const row = csvRow(c);
    expect(Object.keys(row).sort()).toEqual([...csvColumns].sort());
    expect(row.final_tier).toBe('1'); expect(row.spo2_pct).toBe('90'); expect(row.lab_results).toContain('haemoglobin 9.1 g/dL');
  });
});

describe('export formats', () => {
  const c = buildTrainingCase(input(), new Date('2026-10-10T10:00:00.000Z'));

  it('writes one CSV row per case under a single header', () => {
    const lines = toCsv([c, { ...c, caseId: 'case-second' }]).trim().split('\n');
    expect(lines[0]).toBe(csvColumns.join(',')); expect(lines).toHaveLength(3);
  });

  it('writes one JSON line per case, with the FHIR bundle', () => {
    const lines = toJsonl([c, c]).trim().split('\n');
    expect(lines).toHaveLength(2); expect(JSON.parse(lines[0]!).fhir.resourceType).toBe('Bundle');
    expect(toJsonl([])).toBe('');
  });

  it('stops a patient’s own words from running as a spreadsheet formula', () => {
    const hostile = { ...c, features: { ...c.features, complaint: '=HYPERLINK("http://x","click")', symptoms: [{ text: '+cmd|calc', textEnglish: null, duration: null, severity: null }] } };
    const csv = toCsv([hostile]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csv).toContain(`"'+cmd|calc"`);
  });
});

describe('the database store', () => {
  let db: PGlite; let store: TrainingStore;
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
  const mk = (id: string) => ({ ...buildTrainingCase({ ...input(), key: store.key }), caseId: id });
  beforeAll(async () => { db = await makeDb(); store = makeDbStore({ query: (sql, p) => db.query(sql, p as any[]) as never }, 'k'.repeat(40)); });

  it('keeps a case and gives it back unchanged, with its FHIR bundle', async () => {
    const a = mk('case-aaaaaaaaaaaa'); await store.write(a);
    expect(await store.list(10)).toEqual([JSON.parse(JSON.stringify(a))]);
  });

  it('counts the cases, and a case written twice is kept once', async () => {
    await store.write(mk('case-aaaaaaaaaaaa')); await store.write(mk('case-bbbbbbbbbbbb'));
    const s = await store.summary();
    expect(s.count).toBe(2); expect(typeof s.latestAt).toBe('string');
    expect(await store.list(1)).toHaveLength(1);
  });

  it('reports nothing yet for an empty table', async () => {
    const fresh = await makeDb();
    expect(await makeDbStore({ query: (sql, p) => fresh.query(sql, p as any[]) as never }, 'k'.repeat(40)).summary()).toEqual({ count: 0, latestAt: null });
  });

  it('has no link to a patient, an encounter, a facility or a user', async () => {
    expect((await q(`select count(*)::int n from pg_constraint where conrelid = 'public.training_cases'::regclass and contype = 'f'`))[0].n).toBe(0);
    const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'training_cases'`)).map(r => r.column_name);
    expect(cols.filter(x => /patient|encounter|facility|user|reviewer|doctor/.test(x))).toEqual([]);
  });

  it('cannot be edited, and cannot be read or written from the app, only by the server', async () => {
    await expect(db.query(`update public.training_cases set withheld_fields = 1`)).rejects.toThrow();
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) expect((await q(`select has_table_privilege('${role}', 'public.training_cases', '${priv}') ok`))[0].ok, `${role} ${priv}`).toBe(false);
    }
    expect((await q(`select has_table_privilege('service_role', 'public.training_cases', 'select') s, has_table_privilege('service_role', 'public.training_cases', 'insert') i`))[0]).toEqual({ s: true, i: true });
  });
});

describe('capturing a case when a clinician signs off', () => {
  const reader = (consents: { purpose: string; granted_at: string; revoked_at: string | null; expires_at: string | null }[]) => ({
    getConsents: async () => consents, getPatient: async () => patient, getIdentifiers: async () => [], getEncounterSummary: async () => summary(),
    getMe: async () => ({ displayName: 'Dr Meera Nair', memberships: [{ facilityId: FAC_ID, facilityName: 'Khordha PHC', facilityType: 'phc', role: 'doctor' }] }), listDocuments: async () => [], getExtraction: async () => null,
  });
  const req = (r: ReturnType<typeof reader>) => ({ reader: r, user: { userId: '66666666-6666-4666-8666-666666666666' }, log: { warn: () => {} }, id: 'r1' }) as never;
  const result = { reviewId: '55555555-5555-4555-8555-555555555555', action: 'approve' as const, fromUrgency: 'orange', effectiveUrgency: 'orange', rulesUrgency: 'orange', downgrade: false, belowRuleFloor: false, facilityId: FAC_ID, patientId: PATIENT_ID };
  const enc = summary().encounter;
  const fakeStore = () => { const written: unknown[] = []; return { written, store: { key: 'k'.repeat(40), write: async (c: unknown) => { written.push(c); }, summary: async () => ({ count: 0, latestAt: null }), list: async () => [] } as unknown as TrainingStore }; };
  const yes = { purpose: 'research_deidentified', granted_at: '2026-10-01T00:00:00.000Z', revoked_at: null, expires_at: null };

  it('writes nothing without the patient\'s separate agreement to the anonymous training copy', async () => {
    const { written, store } = fakeStore();
    expect(await captureTrainingCase({ trainingStore: store }, req(reader([{ ...yes, purpose: 'care_triage' }])), { enc, result, reason: null })).toBe('no_consent');
    expect(written).toHaveLength(0);
  });
  it('writes nothing when the agreement was withdrawn', async () => {
    const { written, store } = fakeStore();
    expect(await captureTrainingCase({ trainingStore: store }, req(reader([{ ...yes, revoked_at: '2026-10-05T00:00:00.000Z' }])), { enc, result, reason: null })).toBe('no_consent');
    expect(written).toHaveLength(0);
  });
  it('writes one case when the patient agreed', async () => {
    const { written, store } = fakeStore();
    expect(await captureTrainingCase({ trainingStore: store }, req(reader([yes])), { enc, result, reason: null })).toBe('written');
    expect(written).toHaveLength(1);
    expect(JSON.stringify(written[0])).not.toContain('Asha');
  });
  it('does nothing when the export is off, and never throws when saving fails', async () => {
    expect(await captureTrainingCase({}, req(reader([yes])), { enc, result, reason: null })).toBe('not_enabled');
    const broken = { key: 'k'.repeat(40), write: async () => { throw new Error('database down'); }, summary: async () => ({ count: 0, latestAt: null }), list: async () => [] } as unknown as TrainingStore;
    expect(await captureTrainingCase({ trainingStore: broken }, req(reader([yes])), { enc, result, reason: null })).toBe('failed');
  });
});
