// DEVELOPMENT-ONLY demo data source. Everything here is synthetic and lives in memory. It exists so the screens can be
// built and shown without a login, a database or an approved rule set. It is loaded only when import.meta.env.DEV is true
// (see src/api-provider.tsx), so it is not part of a production build. The UI shows a visible DEMO flag whenever it is active.
import { ApiError } from '../lib/api';
import type { Api, DoneEntry, MemberView, ReviewerNote, HistoryEntry, BoardReferral, ReferralStatus, Followup, DocumentMeta, ExtractedField, Extraction, AssessResponse, FhirBundle, ReferralMeta, ReferralView, DecisionLogEntry, EncounterSummary, FollowUp, PatientBrief, QueueEntry, Tier, TriageContext, UrgencyCode } from '../lib/types';

const TIER: Record<UrgencyCode, Tier> = { red: 1, orange: 2, yellow: 3, green: 4 };
const URG: Record<Tier, UrgencyCode> = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green' };
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const years = (y: number) => new Date(Date.now() - y * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);

const person = (n: number, name: string, sex: PatientBrief['sex'], age: number, lang: string): PatientBrief =>
  ({ id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, public_ref: `AR-${String(n).padStart(4, '0')}`, full_name: name, sex, birth_date: years(age), age_years_reported: null, preferred_language: lang });

const P = {
  p1: person(1, 'Seed Patient 01', 'female', 34, 'or'), p2: person(2, 'Seed Patient 02', 'male', 8, 'hi'),
  p3: person(3, 'Seed Patient 03', 'female', 27, 'en'), p4: person(4, 'Seed Patient 04', 'male', 58, 'en'),
  p7: person(7, 'Seed Patient 07', 'male', 62, 'en'),
};

interface Rec { summary: EncounterSummary; followUps: FollowUp[] }

const note = (tier: Tier, winning: DecisionLogEntry, over: Partial<NonNullable<EncounterSummary['assessment']>['note']> = {}) => ({
  disclaimer: 'Organises information for review. Does not diagnose or advise treatment.', tier, potentialTier: null as Tier | null, winning,
  log: [winning, { layer: 'default', ruleId: 'DEFAULT', tier: 4 as Tier, detail: 'No urgency signal found in the information recorded so far' }],
  missing: [] as { code: string; label: string; potentialTier: Tier | null }[], news2: { applicable: false, score: null as number | null },
  vulnerable: false, insufficientData: false, ruleSet: { name: 'aarogyarekha-layered', version: '0.1.1', status: 'approved', hash: 'demo' }, ...over,
});

function seed(): Rec[] {
  const base = (n: number, p: PatientBrief, scenario: string, complaint: string, translated: string | null, mins: number): EncounterSummary => ({
    encounter: { id: `10000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, patient_id: p.id, facility_id: 'f1', status: 'submitted', scenario, language: p.preferred_language, chief_complaint_original: complaint, chief_complaint_translated: translated, submitted_at: ago(mins), closed_at: null, created_at: ago(mins + 5), updated_at: ago(mins) },
    patient: p, symptoms: [], vitals: [], triageContext: {}, assessment: null, followUps: [], queue: null, consentActive: true, reviews: [],
  });
  const vit = (e: EncounterSummary, kind: string, value: number, unit: string) => e.vitals.push({ id: `${e.encounter.id}-${kind}`, encounter_id: e.encounter.id, kind, value, unit, measured_at: ago(10) });
  const assessed = (e: EncounterSummary, tier: Tier, n: ReturnType<typeof note>) => {
    e.assessment = { id: `a-${e.encounter.id}`, version: 1, created_at: ago(8), urgency_code: URG[tier], note: n, signals: [] };
    e.queue = { urgency_code: URG[tier], status: 'waiting', entered_at: e.encounter.submitted_at! };
  };

  const e7 = base(7, P.p7, 'opd_queue', 'Breathless since morning, cannot finish a sentence', null, 6);
  e7.symptoms.push({ id: 's7', text_original: 'Breathlessness', text_translated: null, lang: 'en', duration_value: 1, duration_unit: 'days', severity: 9, created_at: ago(9) });
  vit(e7, 'spo2_pct', 86, '%'); vit(e7, 'resp_rate_pm', 28, '/min'); vit(e7, 'pulse_bpm', 118, '/min');
  e7.triageContext = { signs: { central_cyanosis: true, airway_obstructed_or_not_breathing: false } };
  assessed(e7, 1, note(1, { layer: 'floor', ruleId: 'ETAT-E3', tier: 1, detail: 'Blue or grey lips or tongue' }, { news2: { applicable: true, score: 9 } }));

  const e3 = base(3, P.p3, 'maternal_followup', 'Headache and swelling of feet, 34 weeks pregnant', null, 22);
  e3.symptoms.push({ id: 's3', text_original: 'Headache', text_translated: null, lang: 'en', duration_value: 2, duration_unit: 'days', severity: 5, created_at: ago(20) });
  vit(e3, 'bp_systolic_mmhg', 165, 'mm[Hg]'); vit(e3, 'bp_diastolic_mmhg', 104, 'mm[Hg]');
  e3.triageContext = { pregnant: true, signs: { convulsions_in_pregnancy: false, heavy_vaginal_bleeding: false } };
  assessed(e3, 2, note(2, { layer: 'pregnancy_bp', ruleId: 'WHO-PREG-BP', tier: 2, detail: 'Blood pressure in the severe range for pregnancy (as recorded)' }, { vulnerable: true }));

  const e2 = base(2, P.p2, 'campus_fever', 'तीन दिन से बुखार और सिरदर्द', 'Fever and headache for three days', 38);
  e2.symptoms.push({ id: 's2', text_original: 'Fever', text_translated: null, lang: 'en', duration_value: 3, duration_unit: 'days', severity: 7, created_at: ago(35) });
  vit(e2, 'temperature_c', 39.2, 'Cel');
  e2.triageContext = { signs: { vomits_everything: false } };
  const fu2: FollowUp[] = [
    { fieldCode: 'sign.unconscious_or_convulsing_now', audience: 'health_worker', question: 'Is the patient unconscious, or having a convulsion right now?', lang: 'en', potentialTier: 2, rank: 1 },
    { fieldCode: 'sign.unable_to_drink_or_breastfeed', audience: 'health_worker', question: 'Is the child unable to drink or breastfeed?', lang: 'en', potentialTier: 2, rank: 2 },
    { fieldCode: 'sign.lethargic', audience: 'health_worker', question: 'Is the child unusually sleepy or hard to wake?', lang: 'en', potentialTier: 2, rank: 3 },
    { fieldCode: 'sign.central_cyanosis', audience: 'health_worker', question: 'Are the lips or tongue blue or grey?', lang: 'en', potentialTier: 2, rank: 4 },
  ];
  assessed(e2, 3, note(3, { layer: 'floor', ruleId: 'ETAT-P2', tier: 3, detail: 'Very high fever (as judged by the health worker)' }, { aiOpinion: { tier: 3, reason: 'A young child with a high fever who is still drinking can usually be seen within the hour, but should be checked again if drinking stops.', provider: 'demo', model: 'demo', machineGenerated: true, rulesTier: 3, relation: 'agrees' }, potentialTier: 2, vulnerable: true, missing: fu2.map(f => ({ code: f.fieldCode, label: f.question, potentialTier: f.potentialTier })) }));
  e2.followUps = fu2.map(f => ({ field_code: f.fieldCode, question_text: f.question, status: 'open', answer_text: null }));

  const e1 = base(1, P.p1, 'opd_queue', 'ଜ୍ୱର ତିନି ଦିନ ଧରି, କାଶ ମଧ୍ୟ ଅଛି', 'Fever for three days, also has cough', 45);
  e1.symptoms.push({ id: 's1', text_original: 'ଜ୍ୱର', text_translated: 'Fever', lang: 'or', duration_value: 3, duration_unit: 'days', severity: 6, created_at: ago(44) });
  vit(e1, 'temperature_c', 38.6, 'Cel'); vit(e1, 'pulse_bpm', 104, '/min'); vit(e1, 'spo2_pct', 96, '%');

  const e4 = base(4, P.p4, 'chronic_checkin', 'Routine check-in, feeling tired for two weeks', null, 70);
  e4.symptoms.push({ id: 's4', text_original: 'Tiredness', text_translated: null, lang: 'en', duration_value: 2, duration_unit: 'weeks', severity: 3, created_at: ago(68) });
  vit(e4, 'blood_glucose_mgdl', 212, 'mg/dL'); vit(e4, 'bp_systolic_mmhg', 136, 'mm[Hg]'); vit(e4, 'bp_diastolic_mmhg', 86, 'mm[Hg]');
  e4.triageContext = { consciousness: 'alert', onSupplementalOxygen: false, signs: { airway_obstructed_or_not_breathing: false, severe_respiratory_distress: false, central_cyanosis: false, shock_signs: false, unconscious_or_convulsing_now: false } };
  assessed(e4, 4, note(4, { layer: 'default', ruleId: 'DEFAULT', tier: 4, detail: 'No urgency signal found in the information recorded so far' }, { news2: { applicable: true, score: 0 } }));

  return [e7, e3, e2, e1, e4].map(s => ({ summary: s, followUps: [] }));
}

const esc = (x: unknown) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const div = (inner: string) => ({ status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>` });
const WORDS: Record<string, string> = { red: 'Immediate', orange: 'Very urgent', yellow: 'Urgent', green: 'Routine' };

function demoBundle(s: EncounterSummary, r: ReferralMeta, final: boolean): FhirBundle {
  const a = s.assessment; const eff = (s.queue?.urgency_code ?? a?.urgency_code ?? 'green') as UrgencyCode;
  const rv = a ? [...s.reviews].reverse().find(x => x.assessment_id === a.id) : undefined;
  const meas = s.vitals.map(v => `<li>${esc(v.kind.replace(/_/g, ' '))}: ${esc(v.value)}</li>`).join('');
  return { resourceType: 'Bundle', type: 'document', timestamp: new Date().toISOString(), entry: [
    { resource: { resourceType: 'Composition', id: r.id + '-note', status: final ? 'final' : 'preliminary', title: 'Referral note', custodian: { reference: 'Organization/from' },
      ...(rv ? { attester: [{ mode: 'professional', time: rv.created_at, party: { reference: 'Practitioner/rv', display: rv.reviewer_name } }] } : {}),
      section: [
        { title: 'Reason for referral', text: div(`<p>${esc(r.reasonText)}</p>`) },
        { title: 'Reported complaint', text: div(`<p>${esc(s.encounter.chief_complaint_original ?? 'None recorded')}</p>${s.encounter.chief_complaint_translated ? `<p>In English: ${esc(s.encounter.chief_complaint_translated)}</p>` : ''}`) },
        { title: 'Symptoms reported', text: div(s.symptoms.length ? `<ul>${s.symptoms.map(x => `<li>${esc(x.text_original)}${x.duration_value != null ? `, for ${esc(x.duration_value)} ${esc(x.duration_unit)}` : ''}</li>`).join('')}</ul>` : '<p>None recorded.</p>') },
        { title: 'Measurements', text: div(meas ? `<ul>${meas}</ul>` : '<p>None recorded.</p>') },
        ...(a ? [{ title: 'Review priority (rule-based, not a diagnosis)', text: div(`<p><strong>${esc(WORDS[eff])}</strong>.</p><p>Rules concluded: ${esc(WORDS[a.urgency_code])}. Reason: ${esc(a.note.winning.detail)} (rule ${esc(a.note.winning.ruleId)}).</p>`) }] : []),
        { title: 'Notice', text: div('<p>Organises information for review. Does not diagnose or advise treatment.</p>') },
      ] } },
    { resource: { resourceType: 'Patient', id: s.patient.id, name: [{ text: s.patient.full_name }], gender: s.patient.sex, birthDate: s.patient.birth_date ?? undefined, identifier: [{ system: 'https://aarogyarekha.example/fhir/identifier/public-ref', value: s.patient.public_ref }], communication: [{ language: { coding: [{ code: s.patient.preferred_language }] } }] } },
    { resource: { resourceType: 'ServiceRequest', id: r.id, priority: r.priority, performer: [{ reference: 'Organization/to' }], extension: [{ url: 'x/triage-priority', extension: [{ url: 'tier', valueInteger: { red: 1, orange: 2, yellow: 3, green: 4 }[eff] }, { url: 'changedByReviewer', valueBoolean: !!a && eff !== a.urgency_code }] }] } },
    { resource: { resourceType: 'Organization', id: 'from', name: 'Seed PHC Khordha' } },
    { resource: { resourceType: 'Organization', id: 'to', name: r.toFacility?.name ?? 'Receiving facility' } },
  ] };
}

export function createDemoApi(opts: { rulesApproved: boolean }): Api {
  const recs = seed();
  const patients: PatientBrief[] = Object.values(P);
  const referrals = new Map<string, ReferralMeta>();
  const docsByEnc = new Map<string, DocumentMeta[]>();
  const extractions = new Map<string, Extraction>();
  const SAMPLE_ROWS: [string, number, string, string, 'low' | 'high' | null][] = [
    ['haemoglobin', 9.1, 'g/dL', '12.0 - 15.5', 'low'], ['wbc_count', 11200, '/cumm', '4000 - 11000', 'high'], ['platelet_count', 2.4, 'lakh/cumm', '1.5 - 4.5', null], ['esr', 38, 'mm/hr', '0 - 20', 'high'],
  ];
  const sharingConsent = new Set<string>();
  const FACS = [{ id: 'f2', name: 'Seed District Hospital', type: 'district_hospital', state: 'Odisha', district: 'Khordha', capabilities: ['general_medicine', 'paediatrics', 'obstetrics', 'emergency'] }, { id: 'f3', name: 'Seed Medical College Hospital', type: 'medical_college', state: 'Odisha', district: 'Cuttack', capabilities: ['cardiology', 'neonatal_care'] }];
  const encOf = (id: string) => recs.find(x => x.summary.encounter.id === id)!.summary;
  const signedOff = (s: EncounterSummary) => !!s.assessment && s.reviews.some(r => r.assessment_id === s.assessment!.id);
  const open = (encId: string) => [...referrals.values()].find(r => r.encounterId === encId && ['draft', 'requested', 'accepted', 'in_progress'].includes(r.status));
  const demoDone: DoneEntry[] = [{ encounterId: 'done-1', facilityId: 'f1', patientRef: 'AR-0090', patientName: 'Seed Patient 90', sex: 'male', urgencyCode: 'green', outcome: 'treated_here', finishedAt: ago(45), by: 'Demo Nurse', waitedMinutes: 35 }, { encounterId: 'done-2', facilityId: 'f1', patientRef: 'AR-0091', patientName: 'Seed Patient 91', sex: 'female', urgencyCode: 'orange', outcome: 'referred', finishedAt: ago(100), by: null, waitedMinutes: 12 }];
  const demoMembers: MemberView[] = [
    { userId: 'm-self', facilityId: 'f1', role: 'facility_admin', active: true, since: ago(90000), name: 'Demo Admin', email: 'admin@demo.test', isSelf: true, canChange: false },
    { userId: 'm1', facilityId: 'f1', role: 'nurse', active: true, since: ago(60000), name: 'Demo Nurse', email: 'nurse@demo.test', isSelf: false, canChange: true },
    { userId: 'm2', facilityId: 'f1', role: 'doctor', active: true, since: ago(50000), name: 'Dr. Rao', email: 'rao@demo.test', isSelf: false, canChange: true },
  ];
  const wait = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 150));
  const fups: Record<string, Followup[]> = {};
  const hist: Record<string, HistoryEntry[]> = {};
  const notes: Record<string, ReviewerNote[]> = {};
  const inbox: BoardReferral[] = [
    { id: 'rf1', encounterId: 'x1', patientId: 'x1', status: 'requested', statusReason: null, priority: 'urgent', reasonText: 'Needs an ultrasound and an obstetrician review today', sentAt: ago(25), updatedAt: ago(25), from: { id: 'f1', name: 'Seed PHC Khordha' }, to: { id: 'f2', name: 'Seed District Hospital' }, patient: { id: 'x1', publicRef: 'AR-0201', fullName: 'Kavita Mohanty (demo)', sex: 'female', birthDate: null, ageYears: 26, language: 'or' } },
    { id: 'rf2', encounterId: 'x2', patientId: 'x2', status: 'accepted', statusReason: null, priority: 'routine', reasonText: 'Follow-up of blood pressure with a physician', sentAt: ago(300), updatedAt: ago(120), from: { id: 'f1', name: 'Seed PHC Khordha' }, to: { id: 'f2', name: 'Seed District Hospital' }, patient: { id: 'x2', publicRef: 'AR-0202', fullName: 'Ramesh Sahoo (demo)', sex: 'male', birthDate: null, ageYears: 58, language: 'or' } },
  ];
  const find = (id: string) => { const r = recs.find(x => x.summary.encounter.id === id); if (!r) throw new ApiError(404, 'No such encounter, or you do not have access.'); return r; };

  const toEntry = (s: EncounterSummary): QueueEntry => {
    const n = s.assessment?.note;
    return {
      encounterId: s.encounter.id, patient: s.patient, scenario: s.encounter.scenario, chiefComplaint: s.encounter.chief_complaint_original, chiefComplaintTranslated: s.encounter.chief_complaint_translated,
      assessed: !!s.assessment, urgencyCode: s.queue?.urgency_code ?? null, tier: s.queue ? TIER[s.queue.urgency_code] : n?.tier ?? null, engineTier: n?.tier ?? null, reviewed: !!s.assessment && s.reviews.some(r => r.assessment_id === s.assessment!.id), potentialTier: n?.potentialTier ?? null, missingCount: n?.missing.length ?? 0,
      winningLabel: n?.winning.detail ?? null, vulnerable: n?.vulnerable ?? false, queueStatus: s.queue?.status ?? null, waitingSince: s.encounter.submitted_at, assessmentVersion: s.assessment?.version ?? null,
    };
  };
  const sortKey = (e: QueueEntry) => (e.assessed && e.tier ? e.tier : 3);
  const questions: Record<string, string> = {
    'sign.airway_obstructed_or_not_breathing': 'Is the airway blocked, or has breathing stopped?', 'sign.severe_respiratory_distress': 'Is the patient struggling severely to breathe (gasping, very fast, or chest drawing in hard)?',
    'sign.central_cyanosis': 'Are the lips or tongue blue or grey?', 'sign.shock_signs': 'Are the hands and feet cold, with a weak fast pulse or slow capillary refill?', 'sign.unconscious_or_convulsing_now': 'Is the patient unconscious, or having a convulsion right now?',
    'vital.consciousness': 'How responsive is the patient: alert, confused, responds to voice, responds to pain only, or unresponsive?', 'vital.oxygen': 'Is the patient on supplemental oxygen?',
    'vital.resp_rate_pm': 'Count and record the breathing rate (breaths per minute).', 'vital.bp_systolic_mmhg': 'Record the blood pressure.', 'vital.pulse_bpm': 'Record the pulse rate (beats per minute).',
  };

  return {
    health: async () => true,
    translate: async id => { const s = encOf(id); if (!s.encounter.chief_complaint_translated && s.encounter.chief_complaint_original) { s.encounter.chief_complaint_translated = 'Fever for three days (demo translation)'; return wait({ translated: 1, rejected: 0, provider: 'demo', model: 'demo', machineTranslation: true as const }); } return wait({ translated: 0, rejected: 0, nothingToDo: true, provider: 'demo', model: 'demo', machineTranslation: true as const }); },
    facilities: () => wait(FACS),
    documents: async id => wait(docsByEnc.get(id) ?? []),
    incomingReferrals: async s => wait(inbox.filter(r => (s ?? ['requested', 'accepted', 'in_progress']).includes(r.status))),
    sentReferrals: async () => wait([] as BoardReferral[]),
    respondToReferral: async (id, action, note) => {
      const r = inbox.find(x => x.id === id); if (!r) throw new ApiError(404, 'No such referral, or you do not have access.');
      const to = { accept: 'accepted', reject: 'rejected', start: 'in_progress', complete: 'completed' }[action] as ReferralStatus;
      const from = { accept: 'requested', reject: 'requested', start: 'accepted', complete: 'in_progress' }[action];
      if (r.status !== from) throw new ApiError(409, `This referral is ${r.status.replace(/_/g, ' ')}, so it cannot be ${action === 'accept' ? 'accepted' : action === 'reject' ? 'declined' : action === 'start' ? 'marked as arrived' : 'completed'}.`);
      r.status = to; r.statusReason = note ?? null; r.updatedAt = new Date().toISOString(); return wait({ id, status: to });
    },
    auditFlags: async hours => wait({ hours: hours ?? 24, examined: 312, rulesValidated: false, flags: [{ kind: 'emergency_access' as const, severity: 'info' as const, who: { actorId: 'u', ip: null, name: 'Demo Nurse' }, count: 1, firstAt: ago(90), lastAt: ago(90), text: 'Used emergency access 1 time. Check the reasons in the emergency access list.' }] }),
    auditChain: async () => wait({ intact: true, checked: 312, brokenIds: [], checkedAt: new Date().toISOString() }),
    callIn: async id => { const s = encOf(id); if (!s.queue) throw new ApiError(409, 'This patient is no longer in the queue, or has not been assessed yet.'); s.queue.status = 'in_review'; s.encounter.status = 'in_review'; return wait({ encounterId: id, status: 'in_review' }); },
    completeVisit: async (id, outcome) => {
      const s = encOf(id); if (!s.queue) throw new ApiError(409, 'This patient is no longer in the queue, or has not been assessed yet.');
      if (outcome !== 'did_not_wait' && !s.reviews.some(r => r.assessment_id === s.assessment?.id)) throw new ApiError(409, 'A nurse or doctor must review the priority before the visit is completed.');
      s.encounter.status = 'closed'; s.encounter.closed_at = new Date().toISOString(); s.queue.status = outcome === 'treated_here' ? 'seen' : outcome === 'sent_home' ? 'closed' : 'no_show';
      demoDone.unshift({ encounterId: id, facilityId: s.encounter.facility_id, patientRef: s.patient.public_ref, patientName: s.patient.full_name, sex: s.patient.sex, urgencyCode: s.queue.urgency_code, outcome, finishedAt: s.encounter.closed_at, by: 'Demo Nurse', waitedMinutes: 20 });
      return wait({ encounterId: id, outcome, queueStatus: s.queue.status });
    },
    queueDone: async () => wait(demoDone.map(d => ({ ...d }))),
    members: async () => wait(demoMembers.map(m => ({ ...m }))),
    memberChanges: async () => wait([{ at: ago(120), facilityId: 'f1', op: 'set_role', role: 'doctor', previous: 'none', actor: 'Demo Admin', target: 'Dr. Rao' }]),
    addMember: async b => { demoMembers.push({ userId: 'm' + demoMembers.length, facilityId: 'f1', role: b.role, active: true, since: new Date().toISOString(), name: b.email.split('@')[0]!, email: b.email, isSelf: false, canChange: true }); return wait({ userId: 'm', role: b.role, previous: 'none' }); },
    setMemberRole: async (id, role) => { const m = demoMembers.find(x => x.userId === id); if (m) { m.role = role; m.active = true; } return wait({ userId: id, role, previous: 'nurse' }); },
    // Demo mode has no platform administrator, so these are never reached from the screen.
    platformFacilities: async () => wait([]),
    createFacility: async () => wait({ id: 'demo-facility' }),
    setFacilityActive: async (id, active) => wait({ id, active }),
    appointFacilityAdmin: async () => wait({ userId: 'demo-admin' }),
    removeFacilityAdmin: async (_f, userId) => wait({ userId, removed: true as const }),
    removeMember: async id => { const m = demoMembers.find(x => x.userId === id); if (m) m.active = false; return wait({ userId: id, removed: true as const }); },
    breakGlassList: async () => wait([{ id: 'bg1', who: 'Demo Nurse', userId: 'u', patientRef: 'AR-0042', facilityId: 'f1', reason: 'Unconscious on arrival, relatives not found', createdAt: ago(90), expiresAt: ago(30), reviewedAt: null, reviewed: false }]),
    reviewBreakGlass: async id => wait({ id, reviewed: true as const }),
    requestBreakGlass: async b => wait({ id: 'bg2', patientId: P.p1.id, patientRef: b.publicRef.toUpperCase(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    patientEncounters: async () => wait({ patientRef: 'AR-0001', encounters: [] }),
    trends: async () => wait([{ kind: 'bp_systolic_mmhg', value: 138, unit: 'mm[Hg]', at: ago(60 * 24 * 60), encounterId: 'x' }, { kind: 'bp_systolic_mmhg', value: 146, unit: 'mm[Hg]', at: ago(60 * 24 * 30), encounterId: 'x' }, { kind: 'bp_systolic_mmhg', value: 158, unit: 'mm[Hg]', at: ago(60), encounterId: 'x' }]),
    notes: async id => wait(notes[id] ?? []),
    addNote: async (id, b) => { (notes[id] ??= []).push({ id: 'n-' + Math.random().toString(36).slice(2, 8), kind: b.kind, body: b.body ?? null, assessmentId: b.assessmentId ?? null, author: 'Demo Reviewer', at: new Date().toISOString() }); return wait({ id: 'n' }); },
    analytics: async days => wait({ days, encounters: 128, submitted: 121, assessed: 118, reviewed: 96, byScenario: [{ scenario: 'opd_queue', n: 90 }, { scenario: 'campus_fever', n: 24 }, { scenario: 'health_camp', n: 14 }], byUrgency: [{ urgency: 'green', n: 51 }, { urgency: 'yellow', n: 40 }, { urgency: 'orange', n: 20 }, { urgency: 'red', n: 7 }], secondsToAssessment: { n: 118, median: 1.4, p90: 3.8 }, minutesToReview: { n: 96, median: 14.2, p90: 52 }, review: { approved: 81, changed: 15, loweredBelowRules: 2, agreementRate: 0.844 }, feedback: { helpful: 22, notHelpful: 3 }, note: 'Demo figures (synthetic).' }),
    history: async pid => wait(hist[pid] ?? []),
    addHistory: async (pid, b) => { (hist[pid] ??= []).unshift({ id: 'h-' + Math.random().toString(36).slice(2, 8), kind: b.kind, text: b.text, lang: b.lang ?? null, source: 'health_worker', createdAt: new Date().toISOString(), confirmed: false, confirmedAt: null, confirmedBy: null }); return wait({ id: 'h' }); },
    confirmHistory: async id => { for (const l of Object.values(hist)) for (const r of l) if (r.id === id) { r.confirmed = true; r.confirmedAt = new Date().toISOString(); r.confirmedBy = 'Demo Reviewer'; } return wait({ id, confirmed: true as const }); },
    followups: async id => wait(fups[id] ?? []),
    createFollowup: async (id, b) => {
      const f: Followup = { id: 'fu-' + Math.random().toString(36).slice(2, 8), kind: b.kind, cadenceDays: b.cadenceDays ?? null, nextDueAt: new Date(Date.now() + b.firstDueInDays * 86_400_000).toISOString(), active: true, createdAt: new Date().toISOString(), reminders: [] };
      (fups[id] ??= []).unshift(f); return wait({ id: f.id, nextDueAt: f.nextDueAt! });
    },
    scheduleReminder: async (fid, b) => {
      const f = Object.values(fups).flat().find(x => x.id === fid); if (!f) throw new ApiError(404, 'No such follow-up, or you do not have access.');
      const due = b.dueAt ?? f.nextDueAt ?? new Date().toISOString();
      f.reminders.push({ id: 'rm-' + Math.random().toString(36).slice(2, 8), due_at: due, channel: b.channel, status: 'scheduled', sent_at: null });
      return wait({ id: 'rm', dueAt: due, channel: b.channel, status: 'scheduled' });
    },
    stopFollowup: async fid => { const f = Object.values(fups).flat().find(x => x.id === fid); if (f) f.active = false; return wait({ id: fid, active: false as const }); },
    transcribe: async (_id, _audio, language) => wait({ text: language === 'hi' ? 'Bukhar teen din se, khansi bhi hai (demo)' : 'Fever for three days with a cough (demo)', language: language ?? 'en', provider: 'demo', model: 'demo', machineTranscript: true as const }),
    uploadDocument: async (id, file, kind) => {
      if (file.size > 10 * 1024 * 1024) throw new ApiError(413, 'The file is larger than 10 MB.');
      if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) throw new ApiError(400, 'Only PDF, JPEG and PNG files are accepted.');
      const d: DocumentMeta = { id: 'doc-' + Math.random().toString(36).slice(2, 8), encounterId: id, kind, mimeType: /pdf$/i.test(file.name) ? 'application/pdf' : /png$/i.test(file.name) ? 'image/png' : 'image/jpeg', sizeBytes: file.size, filename: file.name, status: 'clean', createdAt: new Date().toISOString() };
      docsByEnc.set(id, [...(docsByEnc.get(id) ?? []), d]);
      return wait({ id: d.id, metadataBytesRemoved: d.mimeType === 'image/jpeg' ? 2048 : 0 });
    },
    readRecord: async file => {
      if (!/.(pdf|jpe?g|png)$/i.test(file.name)) throw new ApiError(400, 'Only PDF, JPEG and PNG files are accepted.');
      // Demo mode cannot read files, and never invents a patient from one.
      return wait({ identity: {}, rows: 0, readable: false, note: 'Demo mode does not read files. Sign in to the real system to read records.', averageConfidence: null });
    },
    recordContext: async id => {
      const docs = (docsByEnc.get(id) ?? []).filter(d => d.status === 'clean').map(d => {
        const x = extractions.get(d.id);
        return { id: d.id, kind: d.kind, filename: d.filename, createdAt: d.createdAt, status: x ? x.status : 'none', rows: (x?.fields ?? []).map(f => ({ name: f.name, valueText: f.valueText, valueNum: f.valueNum, unit: f.unit, printedFlag: f.printedFlag, verified: f.verified })) };
      });
      const all = docs.flatMap(d => d.rows), flagged = all.filter(r => r.printedFlag && r.printedFlag !== 'normal');
      return wait({ summary: { documents: docs.length, read: docs.filter(d => d.rows.length > 0).length, notRead: docs.filter(d => d.rows.length === 0).length, rows: all.length, verified: all.filter(r => r.verified).length, flagged: flagged.length,
        lines: flagged.slice(0, 12).map(r => `${r.name.replace(/_/g, ' ')} ${r.valueText ?? r.valueNum ?? '?'}${r.unit ? ' ' + r.unit : ''} (printed ${String(r.printedFlag).toUpperCase()}${r.verified ? '' : ', not yet checked by a person'})`) }, documents: docs });
    },
    documentFile: async () => wait({ blob: new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))], { type: 'image/png' }), filename: 'document.png' }),
    extractDocument: async id => {
      const fields: ExtractedField[] = SAMPLE_ROWS.map(([name, v, unit, range, flag], i) => ({ id: id + '-f' + i, name, printedLine: `${name.replace(/_/g, ' ')} ${v} ${unit} ${range}${flag ? ' ' + flag.charAt(0).toUpperCase() : ''}`, valueText: String(v), valueNum: v, unit, referenceRange: range, printedFlag: flag, confidence: i === 3 ? 0.55 : 0.91, verified: false, verifiedAt: null }));
      fields.forEach((f, i) => { if (i === 3) { f.agreement = 'differ'; f.secondRead = String((f.valueNum ?? 0) + 8); } else { f.agreement = 'agree'; f.secondRead = String(f.valueNum); } });      // demo: a second reader
      const x: Extraction = { id: 'ex-' + id, documentId: id, engine: 'demo reader', status: 'completed', language: 'en', averageConfidence: 0.85, error: null, createdAt: new Date().toISOString(), fields };
      extractions.set(id, x); return wait(x);
    },
    extraction: async id => wait(extractions.get(id) ?? null),
    verifyField: async (docId, fieldId, b) => { const f = extractions.get(docId)?.fields.find(x => x.id === fieldId); if (!f) throw new ApiError(404, 'No such row in this document.'); if (b.valueNum != null) { f.valueNum = b.valueNum; f.valueText = String(b.valueNum); } if (b.unit !== undefined) f.unit = b.unit; f.verified = true; f.verifiedAt = new Date().toISOString(); return wait({ ok: true }); },
    referralsFor: async id => wait([...referrals.values()].filter(r => r.encounterId === id)),
    createReferral: async (id, b) => {
      const s = encOf(id);
      if (!signedOff(s)) throw new ApiError(409, 'A reviewer must sign off the triage priority before a referral can be sent.');
      if (open(id)) throw new ApiError(409, 'A referral is already open for this encounter.');
      const f = FACS.find(x => x.id === b.toFacilityId); if (!f) throw new ApiError(404, 'No such facility.');
      const r: ReferralMeta = { id: 'ref-' + (referrals.size + 1), encounterId: id, patientId: s.patient.id, status: 'draft', priority: b.priority ?? 'urgent', reasonText: b.reasonText, toFacility: { id: f.id, name: f.name }, sentAt: null, createdAt: new Date().toISOString(), bundleSha256: null };
      referrals.set(r.id, r); return wait(r);
    },
    referral: async id => {
      const r = referrals.get(id); if (!r) throw new ApiError(404, 'No such referral, or you do not have access.');
      const s = encOf(r.encounterId); const sent = r.status !== 'draft' && r.status !== 'cancelled';
      const v: ReferralView = { referral: r, preview: !sent, bundle: demoBundle(s, r, sent), readiness: { signedOff: signedOff(s), sharingConsent: sharingConsent.has(s.patient.id), hasReceiver: !!r.toFacility, hasReason: (r.reasonText ?? '').trim().length >= 10 } };
      return wait(v);
    },
    updateReferral: async (id, b) => {
      const r = referrals.get(id)!; if (r.status !== 'draft') throw new ApiError(409, 'This referral has been sent and can no longer be edited.');
      if (b.priority) r.priority = b.priority; if (b.reasonText) r.reasonText = b.reasonText;
      if (b.toFacilityId) { const f = FACS.find(x => x.id === b.toFacilityId); if (f) r.toFacility = { id: f.id, name: f.name }; }
      return wait({ ok: true });
    },
    cancelReferral: async id => { const r = referrals.get(id)!; if (r.status !== 'draft') throw new ApiError(409, 'Only a draft referral can be cancelled here.'); r.status = 'cancelled'; return wait({ ok: true }); },
    sendReferral: async id => {
      const r = referrals.get(id)!; const s = encOf(r.encounterId);
      if (r.status !== 'draft') throw new ApiError(409, 'This referral has already been sent or closed.');
      if (!signedOff(s)) throw new ApiError(409, 'A reviewer must sign off the triage priority before a referral can be sent.');
      if (!sharingConsent.has(s.patient.id)) throw new ApiError(409, 'The patient has not consented to sharing this referral. Record their consent for referral sharing first.');
      r.status = 'requested'; r.sentAt = new Date().toISOString(); r.bundleSha256 = 'd3m0'.repeat(16);
      s.encounter.status = 'referred'; if (s.queue) s.queue.status = 'referred';
      return wait({ id, status: 'requested', sentAt: r.sentAt, bundleSha256: r.bundleSha256 });
    },
    downloadReferralPdf: async id => { const r = referrals.get(id)!; if (r.status === 'draft') throw new ApiError(409, 'This referral has not been sent yet. Preview it instead.'); return wait({ filename: 'referral-demo.pdf', blob: new Blob(['%PDF-1.4 demo'], { type: 'application/pdf' }) }); },
    downloadReferral: async id => { const r = referrals.get(id)!; if (r.status === 'draft') throw new ApiError(409, 'This referral has not been sent yet. Preview it instead.'); return wait({ filename: 'referral-' + id + '.json', text: JSON.stringify(demoBundle(encOf(r.encounterId), r, true), null, 2) }); },
    review: async (id, b) => {
      const s = find(id).summary;
      if (!s.assessment) throw new ApiError(409, 'This encounter has no assessment to review, or it can no longer be reviewed.');
      if (b.assessmentId !== s.assessment.id) throw new ApiError(409, 'The assessment changed while you were reviewing. Open the latest assessment and review that one.');
      const cur = (s.queue?.urgency_code ?? s.assessment.urgency_code) as UrgencyCode;
      const base = { id: 'rv-' + Math.random(), assessment_id: s.assessment.id, reviewer_id: 'demo-user', reviewer_name: 'Demo Nurse', created_at: new Date().toISOString(), from_urgency_code: cur };
      if (b.action === 'approve') {
        if (s.reviews.some(r => r.assessment_id === s.assessment!.id)) throw new ApiError(409, 'This assessment has already been reviewed.');
        s.reviews.push({ ...base, action: 'approve', to_urgency_code: cur, reason: null });
      } else {
        if (b.toUrgency === cur) throw new ApiError(400, 'The review could not be recorded. Check the priority and the reason.');
        const lower = TIER[b.toUrgency] > TIER[s.assessment.urgency_code];
        if (lower && !b.confirmDowngrade) throw new ApiError(409, 'Making the case less urgent than the rules set needs your explicit confirmation.');
        s.reviews.push({ ...base, action: 'override_urgency', to_urgency_code: b.toUrgency, reason: '[' + b.reasonCode + '] ' + b.reason });
        s.queue = { urgency_code: b.toUrgency, status: 'in_review', entered_at: s.queue?.entered_at ?? new Date().toISOString() };
      }
      if (s.queue) s.queue.status = 'in_review';
      s.encounter.status = 'in_review';
      return wait({ reviewId: 'demo', action: b.action, effectiveUrgency: (s.queue?.urgency_code ?? cur) as UrgencyCode, rulesUrgency: s.assessment.urgency_code, downgrade: false, belowRuleFloor: false, sms: { status: 'skipped', reason: 'no_consent', language: 'en' } });
    },
    me: () => wait({ userId: 'demo-user', displayName: 'Demo Nurse', memberships: [{ facilityId: 'f1', facilityName: 'Seed PHC Khordha', facilityType: 'phc', role: 'nurse' }] }),
    queue: () => wait({ generatedAt: new Date().toISOString(), entries: recs.filter(r => ['submitted', 'in_review'].includes(r.summary.encounter.status)).map(r => toEntry(r.summary)).sort((a, b) => sortKey(a) - sortKey(b) || Number(a.assessed) - Number(b.assessed) || Number(b.vulnerable) - Number(a.vulnerable) || Date.parse(a.waitingSince!) - Date.parse(b.waitingSince!)) }),
    registerPatient: async b => {
      const same = patients.filter(p => p.full_name.toLowerCase() === b.fullName.trim().toLowerCase());
      if (same.length && !b.confirmNotDuplicate) throw new ApiError(409, 'Someone with the same name and age is already registered. Check the list, or confirm this is a different person.', same.map(p => ({ id: p.id, publicRef: p.public_ref, fullName: p.full_name, sex: p.sex, birthDate: p.birth_date, ageYears: p.age_years_reported })));
      const n = patients.length + 1;
      const p: PatientBrief = { id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, public_ref: `AR-${String(n).padStart(4, '0')}`, full_name: b.fullName.trim(), sex: b.sex, birth_date: b.birthDate ?? null, age_years_reported: b.birthDate ? null : b.ageYears ?? null, preferred_language: b.preferredLanguage };
      patients.push(p); return wait({ id: p.id, publicRef: p.public_ref });
    },
    patients: q => wait(patients.filter(p => !q || p.full_name.toLowerCase().includes(q.toLowerCase()) || p.public_ref.toLowerCase().includes(q.toLowerCase()))),
    summary: id => wait(structuredClone(find(id).summary)),
    recordConsent: async (patientId, b) => { if (b.purpose === 'referral_sharing') sharingConsent.add(patientId); return wait({ id: 'demo-consent' }); },
    createEncounter: async b => {
      const p = patients.find(x => x.id === b.patientId); if (!p) throw new ApiError(404, 'No such patient, or you do not have access.');
      const id = `10000000-0000-4000-8000-00000000${String(recs.length + 90)}`;
      recs.push({ followUps: [], summary: { encounter: { id, patient_id: p.id, facility_id: 'f1', status: 'draft', scenario: b.scenario, language: b.language, chief_complaint_original: b.chiefComplaint ?? null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, patient: p, symptoms: [], vitals: [], triageContext: {}, assessment: null, followUps: [], queue: null, consentActive: true, reviews: [] } });
      return wait({ id, status: 'draft' });
    },
    addSymptom: async (id, b) => { find(id).summary.symptoms.push({ id: `s-${Math.random()}`, text_original: b.text, text_translated: null, lang: b.lang ?? null, duration_value: b.durationValue ?? null, duration_unit: b.durationUnit ?? null, severity: b.severity ?? null, created_at: new Date().toISOString() }); return wait({ id: 'demo' }); },
    addVital: async (id, b) => { const s = find(id).summary; s.vitals.push({ id: `v-${Math.random()}`, encounter_id: id, kind: b.kind, value: b.value, unit: '', measured_at: new Date().toISOString() }); const f = s.followUps.find(x => x.field_code === `vital.${b.kind}` && x.status === 'open'); if (f) { f.status = 'answered'; f.answer_text = String(b.value); } return wait({ id: 'demo' }); },
    saveInputs: async (id, b) => {
      const s = find(id).summary; const c: TriageContext = s.triageContext;
      if (b.consciousness !== undefined) c.consciousness = b.consciousness; if (b.onSupplementalOxygen !== undefined) c.onSupplementalOxygen = b.onSupplementalOxygen; if (b.pregnant !== undefined) c.pregnant = b.pregnant;
      c.signs = { ...(c.signs ?? {}), ...(b.signs ?? {}) };
      const mark = (code: string, ans: string) => { const f = s.followUps.find(x => x.field_code === code && x.status === 'open'); if (f) { f.status = 'answered'; f.answer_text = ans; } };
      for (const [k, v] of Object.entries(b.signs ?? {})) mark(`sign.${k}`, v ? 'yes' : 'no');
      if (b.consciousness) mark('vital.consciousness', b.consciousness); if (typeof b.onSupplementalOxygen === 'boolean') mark('vital.oxygen', b.onSupplementalOxygen ? 'yes' : 'no');
      return wait({ ok: true });
    },
    submit: async id => { find(id).summary.encounter.status = 'submitted'; find(id).summary.encounter.submitted_at = new Date().toISOString(); return wait({ id, status: 'submitted' }); },
    assess: async id => {
      if (!opts.rulesApproved) throw new ApiError(503, 'Triage rules are not approved yet, so no assessment was stored. A qualified reviewer must approve the rule set first.');
      const s = find(id).summary; const signs = s.triageContext.signs ?? {};
      const hit = Object.entries(signs).find(([, v]) => v === true);
      const answered = Object.keys(signs).length; const insufficient = !s.vitals.length && !answered;
      let tier: Tier = hit ? 1 : insufficient ? 3 : s.vitals.some(v => v.kind === 'temperature_c' && Number(v.value) >= 39) ? 3 : 4;
      const winning: DecisionLogEntry = hit ? { layer: 'floor', ruleId: 'DEMO', tier: 1, detail: 'A danger sign was marked present' } : insufficient ? { layer: 'insufficient_data', ruleId: 'INSUFFICIENT', tier: 3, detail: 'No vitals or danger-sign answers recorded yet' } : { layer: 'default', ruleId: 'DEFAULT', tier, detail: tier === 3 ? 'Temperature recorded as high' : 'No urgency signal found in the information recorded so far' };
      const unasked = Object.keys(questions).filter(k => k.startsWith('sign.') && !(k.slice(5) in signs));
      const followUps: FollowUp[] = unasked.slice(0, 5).map((k, i) => ({ fieldCode: k, audience: 'health_worker', question: questions[k]!, lang: 'en', potentialTier: (tier > 1 ? tier - 1 : null) as Tier | null, rank: i + 1 }));
      const prev = s.assessment?.version ?? 0;
      s.assessment = { id: `a-${id}-${prev + 1}`, version: prev + 1, created_at: new Date().toISOString(), urgency_code: URG[tier], note: note(tier, winning, { potentialTier: followUps.length && tier > 1 ? ((tier - 1) as Tier) : null, insufficientData: insufficient, missing: followUps.map(f => ({ code: f.fieldCode, label: f.question, potentialTier: f.potentialTier })) }), signals: [] };
      s.queue = { urgency_code: URG[tier], status: 'waiting', entered_at: s.encounter.submitted_at ?? new Date().toISOString() };
      for (const f of followUps) if (!s.followUps.some(x => x.field_code === f.fieldCode)) s.followUps.push({ field_code: f.fieldCode, question_text: f.question, status: 'open', answer_text: null });
      const res: AssessResponse = { disclaimer: s.assessment.note.disclaimer!, assessmentId: s.assessment.id, version: s.assessment.version, tier, urgencyCode: URG[tier], potentialTier: s.assessment.note.potentialTier, winning, log: s.assessment.note.log, vulnerable: false, insufficientData: insufficient, news2: { applicable: false, score: null }, queue: { urgency: URG[tier], downgradeSuggested: false }, followUps, followUpsSaved: true, ruleSet: s.assessment.note.ruleSet };
      tier = tier; return wait(res);
    },
  };
}
