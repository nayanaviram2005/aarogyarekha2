import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type Deps, type NewConsent, type UserReader, type UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow, VitalRow } from '../src/fhir/project.js';
import type { PatientFacts, TriageContext } from '../src/intake/input.js';
import { RuleSetUnavailable, type PersistArgs } from '../src/triage/persist.js';
import { triage } from '../src/triage/engine.js';
import { RULESET_DRAFT } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED } from '../src/triage/ruleset.proposed.js';
import { NonDiagnosticViolation } from '../src/guard/nonDiagnostic.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';

const patient: PatientRow = {
  id: P, public_ref: 'AR-0001', registered_facility_id: F, full_name: 'Test Patient', preferred_language: 'en', sex: 'male',
  birth_date: '1990-01-01', age_years_reported: null, phone: null, address_line: null, village_town: null, district: null,
  state: null, pincode: null, updated_at: '2026-10-06T10:00:00Z',
};
const encRow = (over: Partial<EncounterRow> = {}): EncounterRow => ({
  id: E, patient_id: P, facility_id: F, status: 'draft', scenario: 'opd_queue', language: 'en', chief_complaint_original: null,
  chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z', ...over,
});

interface Store {
  consent: boolean; encounters: Map<string, EncounterRow>; symptoms: unknown[]; vitals: VitalRow[]; ctx: Map<string, TriageContext>;
  infos: { fieldCode: string; status: string; answer?: string }[]; consents: NewConsent[]; assessCalls: PersistArgs[];
  facts: PatientFacts; failWrite?: DbError; assessError?: Error; audits: AuditEvent[]; auditFails: boolean; writerCalls: string[];
}
let s: Store;

const reader = (token: string): UserReader => {
  const sees = token === 'clinician';
  return {
    getPatient: async id => (sees && id === P ? patient : null),
    getIdentifiers: async () => [],
  listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null, listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null, getMe: async () => ({ displayName: 'T', memberships: [] }),
    getEncounter: async id => (sees ? s.encounters.get(id) ?? null : null),
    getVitals: async id => s.vitals.filter(v => v.encounter_id === id),
  };
};
const writer = (_t: string, _u: string): UserWriter => ({
  async registerPatient() { return { id: 'p-new', publicRef: 'AR-NEW' }; },
  async hasActiveConsent() { s.writerCalls.push('consent-check'); return s.consent; },
  async recordConsent(c) { if (s.failWrite) throw s.failWrite; s.consents.push(c); s.consent = true; return { id: 'consent-1' }; },
  async createEncounter(e) { if (s.failWrite) throw s.failWrite; const r = encRow({ patient_id: e.patientId, facility_id: e.facilityId, scenario: e.scenario, language: e.language }); s.encounters.set(r.id, r); return r; },
  async addSymptom(_e, x) { if (s.failWrite) throw s.failWrite; s.symptoms.push(x); return { id: 'sym-1' }; },
  async addVital(e, v) { if (s.failWrite) throw s.failWrite; s.vitals.push({ id: `v${s.vitals.length}`, encounter_id: e, kind: v.kind, value: v.value, unit: v.unit, measured_at: '2026-10-06T09:40:00Z' }); return { id: 'vit-1' }; },
  async patientFacts() { return s.facts; },
  async getTriageContext(id) { return s.ctx.get(id) ?? {}; },
  async setTriageContext(id, c) { if (s.failWrite) throw s.failWrite; s.ctx.set(id, c); },
  async submitEncounter(id) { const e = s.encounters.get(id)!; s.encounters.set(id, { ...e, status: 'submitted' }); },
  async listOpenInfoCodes() { return s.infos.filter(i => i.status === 'open').map(i => i.fieldCode); },
  async addInfoRequests(_e, items) { for (const i of items) s.infos.push({ fieldCode: i.fieldCode, status: 'open' }); },
  async setComplaintTranslation() {}, async createDocument() { throw new Error('unused'); }, async uploadObject() {}, async downloadObject() { return Buffer.alloc(0); }, async verifyField() {}, async createReferral() { throw new Error('unused'); }, async updateReferralDraft() {}, async cancelReferral() {},
  async dismissInfoRequests(_e, keep) { let n = 0; for (const i of s.infos) if (i.status === 'open' && !keep.includes(i.fieldCode)) { i.status = 'dismissed'; n++; } return n; },
  async answerInfoRequests(_e, answers) { for (const a of answers) for (const i of s.infos) if (i.fieldCode === a.fieldCode && i.status === 'open') { i.status = 'answered'; i.answer = a.answer; } },
});

const approved = { ...RULESET_DRAFT, status: 'approved' as const };
const make = async (over: Partial<Deps> = {}) => {
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null),
    userReader: reader,
    userWriter: writer,
    review: async () => { throw new Error('review not used in this test'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }), sendReferral: async () => { throw new Error('unused'); },
    assess: async args => {
      s.assessCalls.push(args);
      if (s.assessError) throw s.assessError;
      const decision = triage(args.input, approved);
      return { assessmentId: 'assess-1', version: 1, decision, queueUrgency: decision.urgencyCode, downgradeSuggested: false, ruleSet: approved };
    },
    audit: async e => { if (s.auditFails) throw new Error('audit down'); s.audits.push(e); },
    ...over,
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, token: string | null = 'clinician') =>
  app.inject({ method, url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  s = { consent: true, encounters: new Map([[E, encRow()]]), symptoms: [], vitals: [], ctx: new Map(), infos: [], consents: [], assessCalls: [], audits: [], auditFails: false, writerCalls: [],
        facts: { birth_date: '1990-01-01', age_years_reported: null, sex: 'male', pregnancyOngoing: false } };
});

describe('consent gate (server-side)', () => {
  it('refuses to start an encounter without consent, and creates nothing', async () => {
    s.consent = false; s.encounters.clear();
    const r = await call(await make(), 'POST', '/encounters', { patientId: P });
    expect(r.statusCode).toBe(403);
    expect(r.json().issue[0].details.text).toMatch(/consent/i);
    expect(s.encounters.size).toBe(0);
  });

  it('starts an encounter once consent exists', async () => {
    const r = await call(await make(), 'POST', '/encounters', { patientId: P, scenario: 'campus_fever', language: 'hi' });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe('draft');
    expect([...s.encounters.values()].some(e => e.scenario === 'campus_fever' && e.language === 'hi')).toBe(true);
  });

  it.each([
    ['symptoms', 'POST', { text: 'Fever' }], ['vitals', 'POST', { kind: 'temperature_c', value: 38 }],
    ['triage-inputs', 'PUT', { consciousness: 'alert' }], ['submit', 'POST', undefined], ['assess', 'POST', undefined],
  ] as const)('refuses %s without consent', async (path, method, body) => {
    s.consent = false;
    const r = await call(await make(), method, `/encounters/${E}/${path}`, body);
    expect(r.statusCode).toBe(403);
    expect(s.symptoms).toHaveLength(0); expect(s.vitals).toHaveLength(0); expect(s.assessCalls).toHaveLength(0);
  });

  it('a user who cannot see the patient gets 404 and consent is never even checked (no information leak)', async () => {
    const r = await call(await make(), 'POST', '/encounters', { patientId: P }, 'outsider');
    expect(r.statusCode).toBe(404);
    expect(s.writerCalls).toEqual([]);
  });
});

describe('recording consent', () => {
  const valid = { method: 'digital', noticeVersion: 'v1' };
  it('records consent as the caller and audits it as a consent change', async () => {
    s.consent = false;
    const r = await call(await make(), 'POST', `/patients/${P}/consents`, valid);
    expect(r.statusCode).toBe(201);
    expect(s.consents[0]).toMatchObject({ patientId: P, purpose: 'care_triage', givenBy: 'self', method: 'digital', noticeVersion: 'v1' });
    expect(s.audits[0]).toMatchObject({ action: 'consent_change', entityType: 'consent', patientId: P });
    expect(JSON.stringify(s.audits)).not.toContain('Test Patient');
  });
  it('requires a witness name for verbal consent', async () => {
    const r = await call(await make(), 'POST', `/patients/${P}/consents`, { method: 'verbal_witnessed', noticeVersion: 'v1' });
    expect(r.statusCode).toBe(400);
    expect(s.consents).toHaveLength(0);
    expect((await call(await make(), 'POST', `/patients/${P}/consents`, { method: 'verbal_witnessed', noticeVersion: 'v1', witnessName: 'A. Witness' })).statusCode).toBe(201);
  });
  it('rejects unknown fields and bad purposes', async () => {
    expect((await call(await make(), 'POST', `/patients/${P}/consents`, { ...valid, captured_by: 'someone-else' })).statusCode).toBe(400);
    expect((await call(await make(), 'POST', `/patients/${P}/consents`, { ...valid, purpose: 'sell_data' })).statusCode).toBe(400);
  });
  it('404 for a patient the caller cannot see', async () => {
    expect((await call(await make(), 'POST', `/patients/${P}/consents`, valid, 'outsider')).statusCode).toBe(404);
  });
});

describe('authentication and access', () => {
  it('401 without a token on every intake route', async () => {
    const app = await make();
    for (const [m, u] of [['POST', '/encounters'], ['POST', `/encounters/${E}/symptoms`], ['POST', `/encounters/${E}/vitals`], ['PUT', `/encounters/${E}/triage-inputs`], ['POST', `/encounters/${E}/submit`], ['POST', `/encounters/${E}/assess`], ['POST', `/patients/${P}/consents`]] as const)
      expect((await call(app, m, u, {}, null)).statusCode, `${m} ${u}`).toBe(401);
  });
  it('an encounter the caller cannot see is 404 on every encounter route', async () => {
    const app = await make();
    for (const [m, p, b] of [['POST', 'symptoms', { text: 'x' }], ['POST', 'vitals', { kind: 'pulse_bpm', value: 80 }], ['PUT', 'triage-inputs', { consciousness: 'alert' }], ['POST', 'submit', undefined], ['POST', 'assess', undefined]] as const)
      expect((await call(app, m, `/encounters/${E}/${p}`, b, 'outsider')).statusCode, p).toBe(404);
    expect(s.assessCalls).toHaveLength(0);
  });
  it('a non-UUID encounter id is 400 before anything is loaded', async () => {
    expect((await call(await make(), 'POST', '/encounters/abc/symptoms', { text: 'x' })).statusCode).toBe(400);
  });
});

describe('validation: plain errors that never echo submitted values', () => {
  it('symptoms: requires both duration fields or neither, and a 0-10 severity', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/symptoms`, { text: 'Fever', durationValue: 3 })).statusCode).toBe(400);
    expect((await call(app, 'POST', `/encounters/${E}/symptoms`, { text: 'Fever', severity: 11 })).statusCode).toBe(400);
    expect((await call(app, 'POST', `/encounters/${E}/symptoms`, { text: 'Fever', durationValue: 3, durationUnit: 'days', severity: 6 })).statusCode).toBe(201);
    expect(s.symptoms).toHaveLength(1);
  });
  it('rejects unexpected fields (strict), so a caller cannot slip in recorded_by or similar', async () => {
    expect((await call(await make(), 'POST', `/encounters/${E}/symptoms`, { text: 'Fever', recorded_by: 'someone-else' })).statusCode).toBe(400);
  });
  it('does not echo the submitted text in the error', async () => {
    const r = await call(await make(), 'POST', `/encounters/${E}/symptoms`, { text: 'SECRET-VALUE', severity: 99 });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('SECRET-VALUE');
  });
  it('vitals: the unit is decided by the server, never by the client', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'temperature_c', value: 38.6, unit: 'F' })).statusCode).toBe(400);
    expect((await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'temperature_c', value: 38.6 })).statusCode).toBe(201);
    expect(s.vitals[0]).toMatchObject({ kind: 'temperature_c', value: 38.6, unit: 'Cel' });
    await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'bp_systolic_mmhg', value: 120 });
    expect(s.vitals[1]!.unit).toBe('mm[Hg]');
  });
  it('vitals: rejects an unknown kind and a non-number', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'mood', value: 5 })).statusCode).toBe(400);
    expect((await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'pulse_bpm', value: 'fast' })).statusCode).toBe(400);
  });
  it('triage-inputs: rejects an unknown sign code and unknown top-level fields', async () => {
    const app = await make();
    expect((await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { signs: { made_up_sign: true } })).statusCode).toBe(400);
    expect((await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { tier: 1 })).statusCode).toBe(400);
    expect((await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { consciousness: 'asleep' })).statusCode).toBe(400);
  });
  it('a database rule violation becomes a plain 422 with no database internals', async () => {
    s.failWrite = new DbError('23514', 'new row for relation "vitals" violates check constraint "vitals_check" DETAIL value 9999');
    const r = await call(await make(), 'POST', `/encounters/${E}/vitals`, { kind: 'temperature_c', value: 9999 });
    expect(r.statusCode).toBe(422);
    expect(r.body).not.toMatch(/relation|constraint|9999/);
  });
  it('a row-level-security refusal becomes 403', async () => {
    s.failWrite = new DbError('42501', 'new row violates row-level security policy for table "symptom_entries"');
    const r = await call(await make(), 'POST', `/encounters/${E}/symptoms`, { text: 'Fever' });
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain('symptom_entries');
  });
});

describe('triage answers', () => {
  it('merges answers across calls instead of replacing them, and null clears a value', async () => {
    const app = await make();
    await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { signs: { central_cyanosis: false }, consciousness: 'alert' });
    await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { signs: { shock_signs: false }, onSupplementalOxygen: true });
    expect(s.ctx.get(E)).toEqual({ consciousness: 'alert', onSupplementalOxygen: true, signs: { central_cyanosis: false, shock_signs: false } });
    await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { consciousness: null });
    expect(s.ctx.get(E)!.consciousness).toBeNull();
    expect(s.ctx.get(E)!.signs).toEqual({ central_cyanosis: false, shock_signs: false });
  });
  it('marks the matching follow-up question as answered', async () => {
    s.infos.push({ fieldCode: 'sign.central_cyanosis', status: 'open' }, { fieldCode: 'sign.shock_signs', status: 'open' });
    await call(await make(), 'PUT', `/encounters/${E}/triage-inputs`, { signs: { central_cyanosis: true } });
    expect(s.infos.find(i => i.fieldCode === 'sign.central_cyanosis')).toMatchObject({ status: 'answered', answer: 'yes' });
    expect(s.infos.find(i => i.fieldCode === 'sign.shock_signs')!.status).toBe('open');
  });
  it('recording a vital answers its follow-up question', async () => {
    s.infos.push({ fieldCode: 'vital.spo2_pct', status: 'open' });
    await call(await make(), 'POST', `/encounters/${E}/vitals`, { kind: 'spo2_pct', value: 97 });
    expect(s.infos[0]).toMatchObject({ status: 'answered', answer: '97' });
  });
});

describe('encounter lifecycle', () => {
  it('submit moves draft to submitted, once', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/submit`)).statusCode).toBe(200);
    expect(s.encounters.get(E)!.status).toBe('submitted');
    const again = await call(app, 'POST', `/encounters/${E}/submit`);
    expect(again.statusCode).toBe(409);
  });
  it.each(['closed', 'cancelled', 'referred', 'reviewed'] as const)('a %s encounter cannot be edited or assessed', async status => {
    s.encounters.set(E, encRow({ status }));
    const app = await make();
    expect((await call(app, 'POST', `/encounters/${E}/symptoms`, { text: 'x' })).statusCode).toBe(409);
    expect((await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'pulse_bpm', value: 80 })).statusCode).toBe(409);
    expect((await call(app, 'POST', `/encounters/${E}/assess`)).statusCode).toBe(409);
    expect(s.symptoms).toHaveLength(0); expect(s.assessCalls).toHaveLength(0);
  });
});

describe('assessment', () => {
  beforeEach(() => {
    s.facts = { birth_date: '2023-06-01', age_years_reported: null, sex: 'male', pregnancyOngoing: false };   // a young child
  });

  it('runs the engine on the stored facts and returns the tier, the reason, and ranked follow-up questions', async () => {
    const app = await make();
    await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { signs: { vomits_everything: true } });
    await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'temperature_c', value: 39.2 });
    const r = await call(app, 'POST', `/encounters/${E}/assess`);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({ tier: 2, urgencyCode: 'orange', version: 1, vulnerable: true });
    expect(b.winning.ruleId).toBe('IMNCI-G2');
    expect(b.disclaimer).toMatch(/does not diagnose/i);
    expect(b.followUps.length).toBeGreaterThan(0);
    expect(b.followUps[0].rank).toBe(1);
    expect(s.assessCalls[0]!.input.signs).toEqual({ vomits_everything: true });
    expect(s.assessCalls[0]!.input.vitals).toEqual({ temperature_c: 39.2 });
    expect(s.assessCalls[0]!.input.ageYears).toBeGreaterThan(3);
  });

  it('saves follow-up questions once and does not duplicate them on a re-run', async () => {
    const app = await make();
    await call(app, 'POST', `/encounters/${E}/assess`);
    const first = s.infos.length;
    expect(first).toBeGreaterThan(0);
    await call(app, 'POST', `/encounters/${E}/assess`);
    expect(s.infos.length).toBe(first);
  });

  it('writes an audit record that names the tier but contains no patient data', async () => {
    await call(await make(), 'POST', `/encounters/${E}/assess`);
    const a = s.audits.find(x => x.entityType === 'triage_assessment')!;
    expect(a).toMatchObject({ action: 'create', patientId: P, facilityId: F, outcome: 'success' });
    expect(JSON.stringify(a)).not.toContain('Test Patient');
  });

  it('explains plainly when the triage rules are not approved, and stores nothing', async () => {
    s.assessError = new RuleSetUnavailable('not_approved', 'aarogyarekha-layered@0.1.1 is draft');
    const r = await call(await make(), 'POST', `/encounters/${E}/assess`);
    expect(r.statusCode).toBe(503);
    expect(r.json().issue[0].details.text).toMatch(/not approved/i);
    expect(r.body).not.toContain('aarogyarekha-layered');
    expect(s.infos).toHaveLength(0);
  });

  it('a safety-check block returns a generic 500 and no tier', async () => {
    s.assessError = new NonDiagnosticViolation([{ rule: 'D1-diagnosis-word@$.x', severity: 'block', match: 'diagnosis' }]);
    const r = await call(await make(), 'POST', `/encounters/${E}/assess`);
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('diagnosis');
    expect(r.json().tier).toBeUndefined();
  });

  it('withholds the result if the audit record cannot be written (fail closed)', async () => {
    s.auditFails = true;
    const r = await call(await make(), 'POST', `/encounters/${E}/assess`);
    expect(r.statusCode).toBe(503);
    expect(r.json().tier).toBeUndefined();
  });

  it('a failure saving follow-up questions does not hide a stored assessment', async () => {
    const app = await make({ userWriter: (t, u) => ({ ...writer(t, u), addInfoRequests: async () => { throw new Error('db hiccup'); } }) });
    const r = await call(app, 'POST', `/encounters/${E}/assess`);
    expect(r.statusCode).toBe(200);
    expect(r.json().followUpsSaved).toBe(false);
    expect(r.json().tier).toBeDefined();
  });

  it('a generic failure is a plain 502 with no internals', async () => {
    s.assessError = new Error('connection to db.secret-host refused');
    const r = await call(await make(), 'POST', `/encounters/${E}/assess`);
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('secret-host');
  });
});

describe('AI second opinion on priority', () => {
  const consent = { id: 'c-ai', purpose: 'external_ai_processing', granted_at: '2025-01-01T00:00:00Z', revoked_at: null, expires_at: null };
  const summary = { symptoms: [{ id: 's1', text_original: 'my son cries and will not drink', text_translated: null, lang: 'en', duration_value: 2, duration_unit: 'days', severity: 6, created_at: '2026-10-06T09:00:00Z' }] };
  let sent: { system: string; user: string }[]; let runs: { purpose?: string; status: string }[]; let reply: string | Error;
  beforeEach(() => {
    sent = []; runs = []; reply = JSON.stringify({ tier: 2, reason: 'A young child who will not drink and is unusually irritable should be seen soon.' });
    s.facts = { birth_date: '2023-06-01', age_years_reported: null, sex: 'male', pregnancyOngoing: false };
  });
  const withAi = (o: { consents?: unknown[]; name?: 'mock' | 'claude'; logFails?: boolean } = {}) => make({
    userReader: t => ({ ...reader(t), getConsents: async () => (o.consents ?? [consent]) as never, getEncounterSummary: async () => summary as never }),
    translator: { name: o.name ?? 'claude', model: 'm', generate: async r => { sent.push(r); if (reply instanceof Error) throw reply; return { text: reply, provider: 'claude', model: 'm' }; } },
    logExternalRun: async a => { if (o.logFails) throw new Error('log down'); runs.push(a); },
  });
  const assess = async (app: App) => { await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'temperature_c', value: 36.8 }); return call(app, 'POST', `/encounters/${E}/assess`); };

  it('raises the priority when the model sees more urgency than the rules, and says so', async () => {
    const r = await assess(await withAi()); const b = r.json();
    expect(r.statusCode).toBe(200); expect(b.tier).toBe(2);
    expect(b.aiOpinion).toMatchObject({ status: 'ok', tier: 2, relation: 'raised', machineGenerated: true, provider: 'claude' }); expect(b.aiOpinion.rulesTier).toBeGreaterThan(2);
    expect(s.assessCalls[0]!.input.externalHints).toEqual([{ code: 'ai_second_opinion', tier: 2, source: 'external_secondary' }]);
  });
  it('a model that says LOWER than the rules cannot lower the result; it is reported as lower', async () => {
    reply = JSON.stringify({ tier: 4, reason: 'Looks routine.' });
    await call(await withAi(), 'PUT', `/encounters/${E}/triage-inputs`, { signs: { vomits_everything: true } });
    const app = await withAi(); await call(app, 'PUT', `/encounters/${E}/triage-inputs`, { signs: { vomits_everything: true } });
    const b = (await assess(app)).json();
    expect(b.tier).toBe(2); expect(b.aiOpinion).toMatchObject({ tier: 4, rulesTier: 2, relation: 'lower' });
  });
  it('sends nothing without the separate AI consent, and says why', async () => {
    const b = (await assess(await withAi({ consents: [] }))).json();
    expect(sent).toEqual([]); expect(b.aiOpinion).toMatchObject({ status: 'no_consent', tier: null }); expect(s.assessCalls[0]!.input.externalHints).toBeUndefined();
  });
  it('is not used with the mock provider', async () => { const b = (await assess(await withAi({ name: 'mock' }))).json(); expect(sent).toEqual([]); expect(b.aiOpinion.status).toBe('not_set_up'); });
  it('never sends the patient name or reference, and logs the outside call', async () => {
    await assess(await withAi());
    expect(sent).toHaveLength(1); expect(sent[0]!.user).not.toMatch(/Test Patient|AR-0001/); expect(sent[0]!.user).toMatch(/Age: \d+ months|Age: \d years/); expect(sent[0]!.user).toMatch(/will not drink/);
    expect(runs).toEqual([expect.objectContaining({ purpose: 'triage_opinion', status: 'ok' })]);
  });
  it('a failing or slow service leaves the rules result alone', async () => {
    const { AiError } = await import('../src/ai/provider.js'); reply = new AiError('timeout', 'slow');
    const r = await assess(await withAi()); expect(r.statusCode).toBe(200); expect(r.json().aiOpinion).toMatchObject({ status: 'unavailable', tier: null }); expect(runs[0]).toMatchObject({ status: 'timeout' });
  });
  it('an unusable or diagnosing reply is dropped', async () => {
    reply = 'not json'; expect((await assess(await withAi())).json().aiOpinion.status).toBe('unusable');
    reply = JSON.stringify({ tier: 2, reason: 'This is dengue fever, start antibiotics.' }); const b = (await assess(await withAi())).json(); expect(b.aiOpinion.status).toBe('unusable'); expect(JSON.stringify(b)).not.toMatch(/dengue/);
    reply = JSON.stringify({ tier: 9, reason: 'x' }); expect((await assess(await withAi())).json().aiOpinion.status).toBe('unusable');
  });
  it('if the outside call cannot be recorded, the opinion is not used', async () => { const b = (await assess(await withAi({ logFails: true }))).json(); expect(b.aiOpinion.status).toBe('unavailable'); expect(s.assessCalls[0]!.input.externalHints).toBeUndefined(); });
  it('the audit record holds tiers and status only', async () => {
    await assess(await withAi()); const a = s.audits.find(x => x.entityType === 'triage_assessment')!; expect(a.details).toMatchObject({ aiStatus: 'ok', aiTier: 2 }); expect(JSON.stringify(a)).not.toMatch(/will not drink|irritable/);
  });
});

describe('questions that fit the patient', () => {
  const PROPA = { ...RULESET_PROPOSED, status: 'approved' as const };
  const consent = { id: 'c-ai', purpose: 'external_ai_processing', granted_at: '2025-01-01T00:00:00Z', revoked_at: null, expires_at: null };
  let askedCandidates: string; let reply: string; let withConsent: boolean;
  beforeEach(() => {
    askedCandidates = ''; withConsent = true;
    reply = JSON.stringify({ tier: 4, reason: 'Routine stomach pain with normal measurements.', ask: ['sudden_severe_abdominal_or_back_pain', 'persistent_vomiting', 'mental_health_crisis_NOT_A_CODE'], questions: [{ code: 'persistent_vomiting', text: 'Has the vomiting been going on since the pain started?' }, { code: 'shock_signs', text: 'Do the hands and feet feel cold, with a weak fast pulse?' }, { code: 'central_cyanosis', text: 'This is cyanosis, treat now' }] });
    s.facts = { birth_date: '1990-01-01', age_years_reported: null, sex: 'male', pregnancyOngoing: false };
    s.encounters.set(E, encRow({ chief_complaint_original: 'stomach pain since yesterday' }));
  });
  const app = (o: { ai?: boolean; rules?: boolean } = {}) => make({
    ...(o.rules === false ? {} : { loadRuleSet: async () => PROPA }),
    assess: async args => { s.assessCalls.push(args); const decision = triage(args.input, PROPA); return { assessmentId: 'a1', version: 1, decision, queueUrgency: decision.urgencyCode, downgradeSuggested: false, ruleSet: PROPA }; },
    userReader: t => ({ ...reader(t), getConsents: async () => (withConsent ? [consent] : []) as never, getEncounterSummary: async () => ({ symptoms: [{ id: 's1', text_original: 'pain in the stomach', text_translated: null, lang: 'en', duration_value: 1, duration_unit: 'days', severity: 5, created_at: '2026-10-06T09:00:00Z' }] }) as never }),
    translator: { name: o.ai === false ? 'mock' : 'claude', model: 'm', generate: async r => { askedCandidates = r.user; return { text: reply, provider: 'claude', model: 'm' }; } },
  });
  const go = async (a: App) => { await call(a, 'POST', `/encounters/${E}/vitals`, { kind: 'temperature_c', value: 36.8 }); return (await call(a, 'POST', `/encounters/${E}/assess`)).json(); };
  const codes = (b: { followUps: { fieldCode: string }[] }) => b.followUps.map(f => f.fieldCode);

  it('with the AI: core emergency signs plus only what the AI picked from the offered list, not everything', async () => {
    const b = await go(await app()); const c = codes(b);
    expect(b.questionsFrom).toBe('ai'); expect(c).toContain('sign.airway_obstructed_or_not_breathing'); expect(c).toContain('sign.sudden_severe_abdominal_or_back_pain'); expect(c).toContain('sign.persistent_vomiting');
    expect(c).not.toContain('sign.mental_health_crisis'); expect(c).not.toContain('sign.weapon_injury'); expect(c.some(x => x.includes('NOT_A_CODE'))).toBe(false);
    expect(c.filter(x => x.startsWith('sign.')).length).toBeLessThan(12);
  });
  it('the questions are worded by the AI for this patient; bad wording falls back to the rule text', async () => {
    const f = (await go(await app())).followUps as { fieldCode: string; question: string; wording: string }[];
    expect(f.find(x => x.fieldCode === 'sign.persistent_vomiting')).toMatchObject({ question: 'Has the vomiting been going on since the pain started?', wording: 'ai' });
    expect(f.find(x => x.fieldCode === 'sign.shock_signs')).toMatchObject({ question: 'Do the hands and feet feel cold, with a weak fast pulse?', wording: 'ai' });
    expect(f.find(x => x.fieldCode === 'sign.central_cyanosis')).toMatchObject({ wording: 'rules' });
  });
  it('without the AI every question is the rule text as written', async () => {
    withConsent = false; const f = (await go(await app())).followUps as { wording: string }[]; expect(f.every(x => x.wording === 'rules')).toBe(true);
  });
  it('the AI is offered the open signs to choose from, and the core ones only to word, and is told to pick only ones that fit', async () => {
    await go(await app()); expect(askedCandidates).toContain('Possible questions'); expect(askedCandidates).toContain('persistent_vomiting:'); const [always, possible] = askedCandidates.split('Possible questions'); expect(always).toContain('Always asked'); expect(always).toContain('central_cyanosis:'); expect(possible).not.toContain('central_cyanosis:'); expect(askedCandidates).toContain('stomach pain since yesterday');
  });
  it('without the AI consent it falls back to topic matching: stomach questions, no self-harm questions', async () => {
    withConsent = false; const b = await go(await app()); const c = codes(b);
    expect(b.questionsFrom).toBe('topics'); expect(c).toContain('sign.sudden_severe_abdominal_or_back_pain'); expect(c).not.toContain('sign.mental_health_crisis'); expect(c).not.toContain('sign.overdose_poisoning_or_self_harm');
  });
  it('with the mock provider it also uses topics', async () => { expect((await go(await app({ ai: false }))).questionsFrom).toBe('topics'); });
  it('with no way to load the rules it asks everything, as before', async () => {
    const b = await go(await app({ rules: false })); expect(b.questionsFrom).toBe('all'); expect(codes(b)).toContain('sign.mental_health_crisis' as never);
  });
  it('a sign answered yes that was not on the list still sets the priority', async () => {
    const a = await app(); await call(a, 'PUT', `/encounters/${E}/triage-inputs`, { signs: { overdose_poisoning_or_self_harm: true } });
    const b = await go(a); expect(b.tier).toBe(1);
  });
  it('the list is capped, and the audit says where the questions came from', async () => {
    const b = await go(await app({ rules: true })); expect(b.followUps.length).toBeLessThanOrEqual(15);
    expect(s.audits.find(x => x.entityType === 'triage_assessment')!.details).toMatchObject({ questionsFrom: 'ai' });
  });
});

describe('a new assessment supersedes old questions', () => {
  it('open questions that no longer fit are dismissed; ones still asked stay open; answered ones are untouched', async () => {
    s.facts = { birth_date: '1990-01-01', age_years_reported: null, sex: 'male', pregnancyOngoing: false };
    s.encounters.set(E, encRow({ chief_complaint_original: 'stomach pain' }));
    s.infos.push({ fieldCode: 'sign.weapon_injury', status: 'open' }, { fieldCode: 'sign.shock_signs', status: 'open' }, { fieldCode: 'sign.mental_health_crisis', status: 'answered', answer: 'no' });
    const PROPA = { ...RULESET_PROPOSED, status: 'approved' as const };
    const app = await make({ loadRuleSet: async () => PROPA, assess: async args => { const decision = triage(args.input, PROPA); return { assessmentId: 'a1', version: 1, decision, queueUrgency: decision.urgencyCode, downgradeSuggested: false, ruleSet: PROPA }; } });
    await call(app, 'POST', `/encounters/${E}/vitals`, { kind: 'temperature_c', value: 36.8 });
    await call(app, 'POST', `/encounters/${E}/assess`);
    const by = Object.fromEntries(s.infos.filter(i => i.fieldCode.startsWith('sign.')).map(i => [i.fieldCode, i.status]));
    expect(by['sign.weapon_injury']).toBe('dismissed'); expect(by['sign.shock_signs']).toBe('open'); expect(by['sign.mental_health_crisis']).toBe('answered');
  });
  it('with no rule list available nothing is dismissed', async () => {
    s.infos.push({ fieldCode: 'sign.weapon_injury', status: 'open' });
    await call(await make(), 'POST', `/encounters/${E}/assess`); expect(s.infos.find(i => i.fieldCode === 'sign.weapon_injury')!.status).toBe('open');
  });
});
