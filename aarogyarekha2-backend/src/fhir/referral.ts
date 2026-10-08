// Builds the FHIR R4 DOCUMENT Bundle for a referral. The first entry is a Composition (the referral note) that references
// everything else, so the receiving facility can open it without knowing anything about this system.
//
// What is deliberately absent: Condition, DiagnosticReport, CarePlan, MedicationRequest. The system is non-diagnostic and
// never recommends treatment, so nothing in the bundle states a diagnosis. The ONLY free text written by a person is the
// reviewer's reason for referral; everything else is recorded facts or rule-derived, labelled as such.
//
// Minimisation: no phone number or street address leaves the facility, only district and state.
import type { Bundle, Composition, Consent, Encounter, Observation, Organization, Patient, Practitioner, Provenance, ServiceRequest } from 'fhir/r4';
import { SYS } from './codes.js';
import { toFhirEncounter, toFhirPatient, toFhirVitals, type EncounterRow, type IdentifierRow, type PatientRow, type VitalRow } from './project.js';

export const FHIR_BASE = 'https://aarogyarekha.example/fhir';
export type ReferralPriority = 'routine' | 'urgent' | 'asap' | 'stat';
export type UrgencyCode = 'red' | 'orange' | 'yellow' | 'green';

/** Suggested FHIR request priority for a review priority. A person can change it. */
export const PRIORITY_FOR_URGENCY: Record<UrgencyCode, ReferralPriority> = { red: 'stat', orange: 'asap', yellow: 'urgent', green: 'routine' };
const TIER: Record<UrgencyCode, number> = { red: 1, orange: 2, yellow: 3, green: 4 };
const WORD: Record<UrgencyCode, string> = { red: 'Immediate', orange: 'Very urgent', yellow: 'Urgent', green: 'Routine' };

export interface FacilityBrief { id: string; name: string; type: string | null; state: string | null; district: string | null }
export interface PersonBrief { id: string; name: string | null }

export interface ReferralBuildInput {
  referralId: string;
  now: Date;
  /** Final only when a reviewer has signed off the assessment and the referral is being sent. Otherwise a preview. */
  final: boolean;
  patient: PatientRow; identifiers: IdentifierRow[];
  encounter: EncounterRow;
  from: FacilityBrief; to: FacilityBrief;
  requester: PersonBrief;
  priority: ReferralPriority;
  reasonText: string;
  symptoms: { id: string; text_original: string; text_translated: string | null; duration_value: number | string | null; duration_unit: string | null; severity: number | null }[];
  vitals: VitalRow[];
  signs: Record<string, boolean>;
  assessment: null | {
    id: string; version: number; urgency_code: UrgencyCode;
    note: { tier: number; winning: { ruleId: string; detail: string }; log: { ruleId: string; detail: string }[]; missing: { label: string }[]; ruleSet: { name: string; version: string; hash: string }; vulnerable?: boolean };
  };
  effectiveUrgency: UrgencyCode;
  /** The reviewer decision on THIS assessment, if any. */
  review: null | { reviewer: PersonBrief; at: string; action: 'approve' | 'override_urgency'; reason: string | null };
  consents: { purpose: string; granted_at: string }[];
  engineVersion: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const div = (inner: string) => ({ status: 'generated' as const, div: `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>` });
const ref = (type: string, id: string, display?: string) => ({ reference: `${type}/${id}`, ...(display ? { display } : {}) });
const entry = <T extends { resourceType: string; id?: string }>(r: T) => ({ fullUrl: `${FHIR_BASE}/${r.resourceType}/${r.id}`, resource: r });

const org = (f: FacilityBrief): Organization => ({
  resourceType: 'Organization', id: f.id, active: true, name: f.name,
  ...(f.type ? { type: [{ coding: [{ system: `${SYS.local}/facility-type`, code: f.type }] }] } : {}),
  ...(f.district || f.state ? { address: [{ ...(f.district ? { district: f.district } : {}), ...(f.state ? { state: f.state } : {}), country: 'IN' }] } : {}),
});
const practitioner = (p: PersonBrief): Practitioner => ({ resourceType: 'Practitioner', id: p.id, active: true, ...(p.name ? { name: [{ text: p.name }] } : {}) });

export function buildReferralBundle(i: ReferralBuildInput): Bundle {
  const nowIso = i.now.toISOString();

  // Minimise: no phone, no street address, no village. District and state only.
  const patient: Patient = toFhirPatient({ ...i.patient, phone: null, address_line: null, village_town: null, pincode: null }, i.identifiers);
  const encounter: Encounter = toFhirEncounter(i.encounter);
  const observations: Observation[] = toFhirVitals(i.patient.id, i.vitals);
  const fromOrg = org(i.from); const toOrg = org(i.to);

  const people = new Map<string, Practitioner>([[i.requester.id, practitioner(i.requester)]]);
  if (i.review) people.set(i.review.reviewer.id, practitioner(i.review.reviewer));

  const a = i.assessment;
  const changed = !!a && i.effectiveUrgency !== a.urgency_code;

  const serviceRequest: ServiceRequest = {
    resourceType: 'ServiceRequest', id: i.referralId,
    status: i.final ? 'active' : 'draft', intent: 'order', priority: i.priority,
    category: [{ coding: [{ system: `${SYS.local}/service-request-category`, code: 'referral', display: 'Referral to another health facility' }] }],
    code: { text: 'Referral to another health facility' },
    subject: ref('Patient', i.patient.id), encounter: ref('Encounter', i.encounter.id), authoredOn: nowIso,
    requester: ref('Practitioner', i.requester.id, i.requester.name ?? undefined),
    performer: [ref('Organization', i.to.id, i.to.name)],
    reasonCode: [{ text: i.reasonText }],
    // The priority tier has no native FHIR home; ServiceRequest.priority is the closest, so the real tier and the rules
    // behind it travel in an extension and are stated openly.
    ...(a ? {
      extension: [{
        url: `${SYS.local}/ext/triage-priority`,
        extension: [
          { url: 'tier', valueInteger: TIER[i.effectiveUrgency] },
          { url: 'tierWord', valueString: WORD[i.effectiveUrgency] },
          { url: 'rulesTier', valueInteger: a.note.tier },
          { url: 'changedByReviewer', valueBoolean: changed },
          { url: 'winningRule', valueString: a.note.winning.ruleId },
          { url: 'ruleSet', valueString: `${a.note.ruleSet.name}@${a.note.ruleSet.version}` },
          { url: 'ruleSetHash', valueString: a.note.ruleSet.hash },
        ],
      }],
    } : {}),
  };

  // ---------------------------------------------------------------- the referral note (Composition)
  const sections: NonNullable<Composition['section']> = [];
  sections.push({ title: 'Reason for referral', text: div(`<p>${esc(i.reasonText)}</p><p><em>Written by ${esc(i.requester.name ?? 'the referring reviewer')}.</em></p>`) });
  sections.push({ title: 'Reported complaint', text: div(`<p>${esc(i.encounter.chief_complaint_original ?? 'None recorded')}</p>${i.encounter.chief_complaint_translated ? `<p>In English: ${esc(i.encounter.chief_complaint_translated)}</p>` : ''}`) });
  sections.push({
    title: 'Symptoms reported',
    text: div(i.symptoms.length ? `<ul>${i.symptoms.map(s => `<li>${esc(s.text_original)}${s.text_translated ? ` (${esc(s.text_translated)})` : ''}${s.duration_value != null ? `, for ${esc(s.duration_value)} ${esc(s.duration_unit)}` : ''}${s.severity != null ? `, severity ${esc(s.severity)} of 10` : ''}</li>`).join('')}</ul>` : '<p>None recorded.</p>'),
  });
  sections.push({
    title: 'Measurements', entry: observations.map(o => ref('Observation', o.id!)),
    text: div(observations.length ? `<ul>${observations.map(o => `<li>${esc(o.code?.coding?.[0]?.display ?? o.code?.text)}: ${o.valueQuantity ? `${esc(o.valueQuantity.value)} ${esc(o.valueQuantity.unit)}` : (o.component ?? []).map(c => `${esc(c.code?.coding?.[0]?.display)} ${esc(c.valueQuantity?.value)}`).join(', ')}</li>`).join('')}</ul>` : '<p>None recorded.</p>'),
  });
  const answered = Object.entries(i.signs);
  if (answered.length) sections.push({ title: 'Danger-sign checks recorded', text: div(`<ul>${answered.map(([k, v]) => `<li>${esc(k.replace(/_/g, ' '))}: ${v ? 'yes' : 'no'}</li>`).join('')}</ul>`) });
  if (a) {
    sections.push({
      title: 'Review priority (rule-based, not a diagnosis)',
      text: div(
        `<p><strong>${esc(WORD[i.effectiveUrgency])}</strong> (tier ${TIER[i.effectiveUrgency]} of 4).</p>` +
        `<p>Rules concluded: ${esc(WORD[a.urgency_code])}. Reason: ${esc(a.note.winning.detail)} (rule ${esc(a.note.winning.ruleId)}).</p>` +
        (changed ? '<p>A reviewer changed this priority.</p>' : '') +
        `<p>Rules: ${esc(a.note.ruleSet.name)} ${esc(a.note.ruleSet.version)}.</p>`),
    });
    if (a.note.missing.length) sections.push({ title: 'Information not yet collected', text: div(`<ul>${a.note.missing.map(m => `<li>${esc(m.label)}</li>`).join('')}</ul>`) });
  }
  sections.push({ title: 'Notice', text: div('<p>Organises information for review. Does not diagnose or advise treatment.</p>') });

  const composition: Composition = {
    resourceType: 'Composition', id: i.referralId + '-note',
    status: i.final ? 'final' : 'preliminary',
    type: { coding: [{ system: SYS.loinc, code: '57133-1', display: 'Referral note' }] },
    subject: ref('Patient', i.patient.id), encounter: ref('Encounter', i.encounter.id), date: nowIso,
    author: [ref('Practitioner', i.requester.id, i.requester.name ?? undefined)],
    title: 'Referral note', confidentiality: 'R',
    ...(i.review ? { attester: [{ mode: 'professional' as const, time: i.review.at, party: ref('Practitioner', i.review.reviewer.id, i.review.reviewer.name ?? undefined) }] } : {}),
    custodian: ref('Organization', i.from.id, i.from.name),
    section: sections,
  };

  // ---------------------------------------------------------------- provenance: who produced what, and who signed it
  const provenance: Provenance = {
    resourceType: 'Provenance', id: i.referralId + '-provenance',
    target: [ref('Composition', composition.id!), ref('ServiceRequest', serviceRequest.id!)],
    recorded: nowIso,
    agent: [
      { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author', display: 'Author' }] }, who: { display: `AarogyaRekha rules engine ${i.engineVersion} (software)` } },
      ...(i.review ? [{ type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'verifier', display: 'Verifier' }] }, who: ref('Practitioner', i.review.reviewer.id, i.review.reviewer.name ?? undefined) }] : []),
      { type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author', display: 'Author' }] }, who: ref('Practitioner', i.requester.id, i.requester.name ?? undefined) },
    ],
  };

  const consents: Consent[] = i.consents.map((c, n) => ({
    resourceType: 'Consent', id: `${i.referralId}-consent-${n}`, status: 'active',
    scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
    category: [{ coding: [{ system: `${SYS.local}/consent-purpose`, code: c.purpose }] }],
    patient: ref('Patient', i.patient.id), dateTime: c.granted_at,
  }));

  return {
    resourceType: 'Bundle', type: 'document',
    identifier: { system: `${SYS.localId}/referral`, value: i.referralId },
    timestamp: nowIso,
    entry: [
      entry(composition), entry(patient), entry(encounter), entry(serviceRequest), entry(fromOrg), entry(toOrg),
      ...[...people.values()].map(entry), ...observations.map(entry), ...consents.map(entry), entry(provenance),
    ],
  };
}

/** Every `reference` inside the bundle must point at another entry, so a receiver can open it on its own. */
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
