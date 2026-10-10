import { createHmac } from 'node:crypto';
import type { Bundle, BundleEntry, Condition, FhirResource, Observation, Practitioner, PractitionerRole } from 'fhir/r4';
import { assertClean, redact } from '../ai/redact.js';
import type { EncounterSummary } from '../deps.js';
import { toFhirEncounter, toFhirPatient, toFhirVitals, type IdentifierRow, type PatientRow, type VitalRow } from '../fhir/project.js';
import { ageYearsAt } from '../intake/input.js';
import type { ContextDoc } from '../ocr/recordContext.js';

export const TRAINING_SCHEMA = 'aarogyarekha-training-case/1';
const EPOCH = Date.UTC(2000, 0, 1);
const TIER_OF: Record<string, number> = { red: 1, orange: 2, yellow: 3, green: 4 };
const VITAL_COLUMNS = ['temperature_c', 'pulse_bpm', 'spo2_pct', 'resp_rate_pm', 'bp_systolic_mmhg', 'bp_diastolic_mmhg', 'weight_kg', 'height_cm', 'blood_glucose_mgdl', 'muac_cm'] as const;

export interface TrainingInput {
  key: string;
  patient: PatientRow;
  identifiers: IdentifierRow[];
  summary: EncounterSummary;
  records: ContextDoc[];
  facilityType: string | null;
  review: { id: string; action: string; effectiveUrgency: string; rulesUrgency: string; reviewerId: string; reviewerName: string | null; reviewerRole: string | null; reason: string | null };
}

export interface TrainingCase {
  caseId: string;
  schema: typeof TRAINING_SCHEMA;
  features: {
    ageYears: number | null; sex: string; language: string; pregnant: boolean | null; scenario: string; facilityType: string | null;
    complaint: string | null; complaintEnglish: string | null;
    symptoms: { text: string | null; textEnglish: string | null; duration: string | null; severity: number | null }[];
    vitals: Record<string, number>;
    signsAnswered: Record<string, boolean>;
    consciousness: string | null; onExtraOxygen: boolean | null;
    labResults: { name: string; value: string | null; unit: string | null; printedFlag: string | null; verified: boolean }[];
    followUpAnswers: { code: string | null; answer: string | null }[];
  };
  engine: { tier: number | null; ruleSet: string | null; winningRule: string | null; log: { layer: string; ruleId: string; tier: number }[]; extendedCheckTier: number | null };
  label: { finalTier: number | null; rulesTier: number | null; reviewAction: string; changedByReviewer: boolean; reviewerRole: string | null; reviewerId: string; reason: string | null };
  withheldFields: number;
  fhir: Bundle;
}

export const csvColumns = ['case_id', 'age_years', 'sex', 'language', 'pregnant', 'scenario', 'facility_type', 'complaint', 'complaint_english', 'symptoms', ...VITAL_COLUMNS, 'signs_answered', 'lab_results', 'engine_tier', 'winning_rule', 'extended_check_tier', 'rules_tier', 'final_tier', 'review_action', 'changed_by_reviewer', 'reviewer_role', 'reviewer_id', 'reason'] as const;

export function pseudonym(key: string, kind: string, id: string): string {
  return `${kind}-${createHmac('sha256', key).update(`${kind}:${id}`).digest('hex').slice(0, 12)}`;
}

const generaliseAge = (patient: PatientRow, now: Date): number | null => {
  const raw = patient.birth_date ? ageYearsAt(patient.birth_date, now) : patient.age_years_reported;
  if (raw == null) return null;
  return Math.min(90, raw < 2 ? Math.round(raw * 10) / 10 : Math.floor(raw));
};

export function buildTrainingCase(i: TrainingInput, now: Date = new Date()): TrainingCase {
  const { summary: s, patient, review } = i;
  const known = { names: [patient.full_name, review.reviewerName], identifiers: [patient.public_ref, patient.phone, ...i.identifiers.map(x => x.value)] };
  let withheld = 0;
  const clean = (t: string | null | undefined): string | null => {
    if (!t || !t.trim()) return null;
    const r = redact(t, known);
    const text = r.text.replace(/\[\[NAME_\d+\]\]/g, '[NAME]');
    try { assertClean(text, known); return text; } catch { withheld++; return null; }
  };

  const caseId = pseudonym(i.key, 'case', review.id);
  const pid = pseudonym(i.key, 'patient', patient.id);
  const eid = pseudonym(i.key, 'encounter', s.encounter.id);
  const fid = pseudonym(i.key, 'facility', s.encounter.facility_id);
  const clin = pseudonym(i.key, 'clinician', review.reviewerId);
  const age = generaliseAge(patient, now);
  const start = Date.parse(s.encounter.submitted_at ?? s.encounter.created_at);
  const shift = (iso: string) => new Date(EPOCH + Math.max(0, Date.parse(iso) - start)).toISOString();

  const complaint = clean(s.encounter.chief_complaint_original);
  const complaintEn = clean(s.encounter.chief_complaint_translated);
  const symptoms = s.symptoms.map(x => ({
    text: clean(x.text_original), textEnglish: clean(x.text_translated),
    duration: x.duration_value != null && x.duration_unit ? `${x.duration_value} ${x.duration_unit}` : null, severity: x.severity,
  }));

  const latest = new Map<string, VitalRow>();
  for (const v of s.vitals) { const p = latest.get(v.kind); if (!p || Date.parse(v.measured_at) >= Date.parse(p.measured_at)) latest.set(v.kind, v); }
  const vitals: Record<string, number> = {};
  for (const [k, v] of latest) { const n = Number(v.value); if (Number.isFinite(n)) vitals[k] = n; }

  const labResults = i.records.flatMap(d => d.fields).map(f => ({
    name: f.name, value: f.valueNum != null ? String(f.valueNum) : clean(f.valueText), unit: f.unit, printedFlag: f.printedFlag, verified: f.verified,
  }));
  const followUpAnswers = s.followUps.filter(f => f.status !== 'open').map(f => ({ code: f.field_code, answer: clean(f.answer_text) }));

  const note = (s.assessment?.note ?? {}) as Record<string, any>;
  const log = (Array.isArray(note.log) ? note.log : []).map((l: any) => ({ layer: String(l.layer), ruleId: String(l.ruleId), tier: Number(l.tier) }));
  const extended = log.find((l: { layer: string }) => l.layer === 'external');
  const finalTier = TIER_OF[review.effectiveUrgency] ?? null;
  const rulesTier = TIER_OF[review.rulesUrgency] ?? null;
  const reason = clean(review.reason);

  const features: TrainingCase['features'] = {
    ageYears: age, sex: patient.sex, language: patient.preferred_language, pregnant: s.triageContext.pregnant ?? null, scenario: s.encounter.scenario, facilityType: i.facilityType,
    complaint, complaintEnglish: complaintEn, symptoms, vitals, signsAnswered: { ...(s.triageContext.signs ?? {}) },
    consciousness: s.triageContext.consciousness ?? null, onExtraOxygen: s.triageContext.onSupplementalOxygen ?? null, labResults, followUpAnswers,
  };
  const engine: TrainingCase['engine'] = {
    tier: typeof note.tier === 'number' ? note.tier : null,
    ruleSet: note.ruleSet?.name ? `${note.ruleSet.name}@${note.ruleSet.version}` : null,
    winningRule: typeof note.winning?.ruleId === 'string' ? note.winning.ruleId : null,
    log, extendedCheckTier: extended ? Number(extended.tier) : null,
  };
  const label: TrainingCase['label'] = {
    finalTier, rulesTier, reviewAction: review.action, changedByReviewer: review.action === 'override_urgency', reviewerRole: review.reviewerRole, reviewerId: clin, reason,
  };

  const subject = { reference: `Patient/${pid}` };
  const encounter = { reference: `Encounter/${eid}` };
  const resources: FhirResource[] = [];
  const anonPatient: PatientRow = { ...patient, id: pid, public_ref: pid, registered_facility_id: fid, full_name: 'ANONYMISED', phone: null, address_line: null, village_town: null, district: null, state: null, pincode: null, birth_date: null, age_years_reported: age == null ? null : Math.floor(age), updated_at: new Date(EPOCH).toISOString() };
  const fhirPatient = toFhirPatient(anonPatient, []);
  delete fhirPatient.telecom; delete fhirPatient.address;
  resources.push(fhirPatient);
  resources.push(toFhirEncounter({ ...s.encounter, id: eid, patient_id: pid, facility_id: fid, chief_complaint_original: complaint, chief_complaint_translated: complaintEn, submitted_at: new Date(EPOCH).toISOString(), closed_at: null, created_at: new Date(EPOCH).toISOString(), updated_at: new Date(EPOCH).toISOString() }));
  resources.push(...toFhirVitals(pid, s.vitals.map((v, n) => ({ ...v, id: `${eid}-v${n}`, encounter_id: eid, measured_at: shift(v.measured_at) }))));

  symptoms.forEach((x, n) => {
    if (!x.text && !x.textEnglish) return;
    const c: Condition = {
      resourceType: 'Condition', id: `${eid}-s${n}`, subject, encounter,
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
      code: { text: x.textEnglish ?? x.text ?? '' },
      ...(x.severity != null ? { severity: { text: `${x.severity}/10` } } : {}),
      ...(x.duration ? { onsetString: x.duration } : {}),
    };
    resources.push(c);
  });
  labResults.forEach((f, n) => {
    const num = f.value != null && f.value.trim() !== '' && Number.isFinite(Number(f.value)) ? Number(f.value) : null;
    const o: Observation = {
      resourceType: 'Observation', id: `${eid}-l${n}`, status: f.verified ? 'final' : 'preliminary', subject, encounter,
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: { text: f.name.replace(/_/g, ' ') },
      ...(num != null ? { valueQuantity: { value: num, ...(f.unit ? { unit: f.unit } : {}) } } : f.value ? { valueString: f.value } : {}),
      ...(f.printedFlag ? { interpretation: [{ text: `printed ${f.printedFlag}` }] } : {}),
    };
    resources.push(o);
  });

  const practitioner: Practitioner = { resourceType: 'Practitioner', id: clin, name: [{ text: 'ANONYMISED CLINICIAN' }] };
  const role: PractitionerRole = { resourceType: 'PractitionerRole', id: `${clin}-role`, practitioner: { reference: `Practitioner/${clin}` }, code: [{ text: review.reviewerRole ?? 'clinician' }] };
  resources.push(practitioner, role);
  const tierObs = (id: string, text: string, tier: number | null, performer?: boolean): Observation => ({
    resourceType: 'Observation', id, status: 'final', subject, encounter, code: { text },
    ...(tier != null ? { valueInteger: tier } : {}),
    ...(performer ? { performer: [{ reference: `Practitioner/${clin}` }], ...(reason ? { note: [{ text: reason }] } : {}) } : {}),
  });
  if (engine.tier != null) resources.push(tierObs(`${eid}-engine`, 'Triage engine priority (1 immediate, 4 routine)', engine.tier));
  resources.push(tierObs(`${eid}-final`, 'Clinician-confirmed triage priority (1 immediate, 4 routine)', finalTier, true));

  const fhir: Bundle = { resourceType: 'Bundle', type: 'collection', entry: resources.map((resource): BundleEntry => ({ resource })) };
  return { caseId, schema: TRAINING_SCHEMA, features, engine, label, withheldFields: withheld, fhir };
}

const flat = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

export function csvRow(c: TrainingCase): Record<(typeof csvColumns)[number], string> {
  const f = c.features;
  const row: Record<string, string> = {
    case_id: c.caseId, age_years: f.ageYears == null ? '' : String(f.ageYears), sex: f.sex, language: f.language, pregnant: f.pregnant == null ? '' : String(f.pregnant),
    scenario: f.scenario, facility_type: f.facilityType ?? '', complaint: flat(f.complaint), complaint_english: flat(f.complaintEnglish),
    symptoms: f.symptoms.map(x => flat(x.textEnglish ?? x.text) + (x.duration ? ` (${x.duration})` : '') + (x.severity != null ? ` [${x.severity}/10]` : '')).filter(Boolean).join(' | '),
    signs_answered: Object.entries(f.signsAnswered).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join('; '),
    lab_results: f.labResults.map(x => `${x.name} ${x.value ?? '?'}${x.unit ? ` ${x.unit}` : ''}${x.printedFlag ? ` (${x.printedFlag})` : ''}`).join(' | '),
    engine_tier: c.engine.tier == null ? '' : String(c.engine.tier), winning_rule: c.engine.winningRule ?? '', extended_check_tier: c.engine.extendedCheckTier == null ? '' : String(c.engine.extendedCheckTier),
    rules_tier: c.label.rulesTier == null ? '' : String(c.label.rulesTier), final_tier: c.label.finalTier == null ? '' : String(c.label.finalTier),
    review_action: c.label.reviewAction, changed_by_reviewer: String(c.label.changedByReviewer), reviewer_role: c.label.reviewerRole ?? '', reviewer_id: c.label.reviewerId, reason: flat(c.label.reason),
  };
  for (const k of VITAL_COLUMNS) row[k] = f.vitals[k] == null ? '' : String(f.vitals[k]);
  return row as Record<(typeof csvColumns)[number], string>;
}
