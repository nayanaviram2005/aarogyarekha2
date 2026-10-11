import type { Bundle, Observation, Patient, ServiceRequest } from 'fhir/r4';
import { SEX_TO_GENDER, SYS } from './codes.js';
import { toFhirVitals, type EncounterRow, type PatientRow, type VitalRow } from './project.js';

export type ReferralPriority = 'routine' | 'urgent' | 'asap' | 'stat';
export type UrgencyCode = 'red' | 'orange' | 'yellow' | 'green';

export const PRIORITY_FOR_URGENCY: Record<UrgencyCode, ReferralPriority> = { red: 'stat', orange: 'asap', yellow: 'urgent', green: 'routine' };
const TIER: Record<UrgencyCode, number> = { red: 1, orange: 2, yellow: 3, green: 4 };
const WORD: Record<UrgencyCode, string> = { red: 'Immediate', orange: 'Very urgent', yellow: 'Urgent', green: 'Routine' };

export interface ReferralBuildInput {
  referralId: string;
  final: boolean;
  patient: PatientRow;
  encounter: EncounterRow;
  priority: ReferralPriority;
  reasonText: string;
  symptoms: { id: string; text_original: string; text_translated: string | null; duration_value: number | string | null; duration_unit: string | null; severity: number | null }[];
  vitals: VitalRow[];
  signs: Record<string, boolean>;
  assessment: null | {
    urgency_code: UrgencyCode;
    note: { winning: { detail: string }; missing: { label: string }[] };
  };
  effectiveUrgency: UrgencyCode;
}

const lean = (o: Observation): Observation => {
  const coding = o.code.coding?.[0];
  return {
    resourceType: 'Observation', id: o.id, status: o.status,
    code: coding?.system === SYS.loinc ? o.code : { text: coding?.display ?? o.code.text },
    subject: o.subject, effectiveDateTime: o.effectiveDateTime,
    ...(o.valueQuantity ? { valueQuantity: { value: o.valueQuantity.value, unit: o.valueQuantity.unit } } : {}),
    ...(o.component ? { component: o.component.map(c => ({ code: c.code, valueQuantity: { value: c.valueQuantity?.value, unit: c.valueQuantity?.unit } })) } : {}),
  };
};

export function buildReferralBundle(i: ReferralBuildInput): Bundle {
  const subject = { reference: `Patient/${i.patient.id}` };
  const patient: Patient = {
    resourceType: 'Patient', id: i.patient.id, name: [{ text: i.patient.full_name }], gender: SEX_TO_GENDER[i.patient.sex],
    ...(i.patient.birth_date ? { birthDate: i.patient.birth_date } : {}),
  };
  const age: Observation[] = !i.patient.birth_date && i.patient.age_years_reported != null
    ? [{ resourceType: 'Observation', id: `${i.referralId}-age`, status: 'final', code: { coding: [{ system: SYS.loinc, code: '30525-0', display: 'Age' }] }, subject, valueQuantity: { value: i.patient.age_years_reported, unit: 'years' } }]
    : [];
  const observations = [...age, ...toFhirVitals(i.patient.id, i.vitals).map(lean)];

  const a = i.assessment;
  const changed = !!a && i.effectiveUrgency !== a.urgency_code;
  const notes: string[] = [];
  const complaint = i.encounter.chief_complaint_original?.trim();
  if (complaint) notes.push(`Reported complaint: ${complaint}${i.encounter.chief_complaint_translated ? ` (in English: ${i.encounter.chief_complaint_translated.trim()})` : ''}`);
  if (i.symptoms.length) {
    notes.push(`Symptoms reported: ${i.symptoms.map(s => `${s.text_original}${s.text_translated ? ` (${s.text_translated})` : ''}${s.duration_value != null ? `, for ${s.duration_value} ${s.duration_unit}` : ''}${s.severity != null ? `, severity ${s.severity} of 10` : ''}`).join('; ')}`);
  }
  const answered = Object.entries(i.signs);
  if (answered.length) notes.push(`Danger-sign checks: ${answered.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v ? 'yes' : 'no'}`).join('; ')}`);
  if (a) {
    notes.push(`Review priority (rule-based): ${WORD[i.effectiveUrgency]} (tier ${TIER[i.effectiveUrgency]} of 4). Reason: ${a.note.winning.detail}${changed ? '. A reviewer changed this priority' : ''}`);
    if (a.note.missing.length) notes.push(`Not yet collected: ${a.note.missing.map(m => m.label).join('; ')}`);
  }

  const serviceRequest: ServiceRequest = {
    resourceType: 'ServiceRequest', id: i.referralId, status: i.final ? 'active' : 'draft', intent: 'order', priority: i.priority,
    subject, reasonCode: [{ text: i.reasonText }],
    ...(notes.length ? { note: notes.map(text => ({ text })) } : {}),
  };

  return { resourceType: 'Bundle', type: 'collection', entry: [{ resource: patient }, { resource: serviceRequest }, ...observations.map(resource => ({ resource }))] };
}

export function unresolvedReferences(bundle: Bundle): string[] {
  const have = new Set((bundle.entry ?? []).map(e => `${e.resource?.resourceType}/${e.resource?.id}`));
  const missing: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'reference' && typeof x === 'string' && !have.has(x)) missing.push(x);
        else walk(x);
      }
    }
  };
  (bundle.entry ?? []).forEach(e => walk(e.resource));
  return missing;
}
