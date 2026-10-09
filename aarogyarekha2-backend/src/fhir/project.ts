import type { Patient, Encounter, Observation, OperationOutcome } from 'fhir/r4';
import {
  SYS, VITALS, BP_PANEL, BP_SYSTOLIC, BP_DIASTOLIC, MMHG, ENCOUNTER_STATUS, SEX_TO_GENDER, type VitalKind,
} from './codes.js';

export interface PatientRow {
  id: string; public_ref: string; registered_facility_id: string; full_name: string;
  preferred_language: string; sex: keyof typeof SEX_TO_GENDER; birth_date: string | null;
  age_years_reported: number | null; phone: string | null; address_line: string | null;
  village_town: string | null; district: string | null; state: string | null; pincode: string | null;
  updated_at: string;
}
export interface IdentifierRow { system: string; value: string }

const IDENTIFIER_SYSTEM: Record<string, string> = {
  abha_number: SYS.abhaNumber, abha_address: SYS.abhaAddress,
  facility_mrn: `${SYS.localId}/facility-mrn`, employee_id: `${SYS.localId}/employee-id`,
  student_id: `${SYS.localId}/student-id`, other: `${SYS.localId}/other`,
};

export function toFhirPatient(p: PatientRow, identifiers: IdentifierRow[] = []): Patient {
  const address = [p.address_line, p.village_town, p.district, p.state, p.pincode].some(Boolean)
    ? [{
        use: 'home' as const,
        line: p.address_line ? [p.address_line] : undefined,
        city: p.village_town ?? undefined, district: p.district ?? undefined,
        state: p.state ?? undefined, postalCode: p.pincode ?? undefined, country: 'IN',
      }]
    : undefined;
  return {
    resourceType: 'Patient',
    id: p.id,
    meta: { lastUpdated: p.updated_at },
    identifier: [
      { system: `${SYS.localId}/public-ref`, value: p.public_ref },
      ...identifiers.map(i => ({ system: IDENTIFIER_SYSTEM[i.system] ?? IDENTIFIER_SYSTEM.other!, value: i.value })),
    ],
    name: [{ use: 'official', text: p.full_name }],
    gender: SEX_TO_GENDER[p.sex],
    ...(p.birth_date ? { birthDate: p.birth_date } : {}),
    ...(!p.birth_date && p.age_years_reported != null
      ? { extension: [{ url: `${SYS.local}/ext/age-years-reported`, valueInteger: p.age_years_reported }] }
      : {}),
    ...(p.phone ? { telecom: [{ system: 'phone' as const, value: p.phone, use: 'mobile' as const }] } : {}),
    ...(address ? { address } : {}),
    communication: [{ language: { coding: [{ system: 'urn:ietf:bcp:47', code: p.preferred_language }] }, preferred: true }],
    managingOrganization: { reference: `Organization/${p.registered_facility_id}` },
  };
}

export interface EncounterRow {
  id: string; patient_id: string; facility_id: string; status: keyof typeof ENCOUNTER_STATUS;
  scenario: string; language: string; chief_complaint_original: string | null;
  chief_complaint_translated: string | null; submitted_at: string | null; closed_at: string | null;
  created_at: string; updated_at: string;
}

export function toFhirEncounter(e: EncounterRow): Encounter {
  const start = e.submitted_at ?? e.created_at;
  return {
    resourceType: 'Encounter',
    id: e.id,
    meta: { lastUpdated: e.updated_at },
    status: ENCOUNTER_STATUS[e.status],
    class: { system: SYS.v3ActCode, code: 'AMB', display: 'ambulatory' },
    type: [{ coding: [{ system: `${SYS.local}/encounter-scenario`, code: e.scenario }] }],
    subject: { reference: `Patient/${e.patient_id}` },
    period: { start, ...(e.closed_at ? { end: e.closed_at } : {}) },
    ...(e.chief_complaint_original
      ? { reasonCode: [{
          text: e.chief_complaint_original,
          ...(e.chief_complaint_translated
            ? { extension: [{ url: `${SYS.local}/ext/translation`, valueString: e.chief_complaint_translated }] }
            : {}),
        }] }
      : {}),
    serviceProvider: { reference: `Organization/${e.facility_id}` },
  };
}

export interface VitalRow { id: string; encounter_id: string; kind: VitalKind; value: number | string; unit: string; measured_at: string }

const num = (v: number | string) => (typeof v === 'string' ? Number(v) : v);

export function toFhirVitals(patientId: string, vitals: VitalRow[]): Observation[] {
  const base = (v: VitalRow) => ({
    resourceType: 'Observation' as const,
    status: 'final' as const,
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${v.encounter_id}` },
    effectiveDateTime: v.measured_at,
  });
  const out: Observation[] = [];
  const systolic = new Map<string, VitalRow>();
  const diastolic = new Map<string, VitalRow>();
  for (const v of vitals) {
    if (v.kind === 'bp_systolic_mmhg') systolic.set(`${v.encounter_id}|${v.measured_at}`, v);
    else if (v.kind === 'bp_diastolic_mmhg') diastolic.set(`${v.encounter_id}|${v.measured_at}`, v);
    else {
      const m = VITALS[v.kind];
      out.push({
        ...base(v), id: v.id,
        category: [{ coding: [{ system: SYS.observationCategory, code: m.category }] }],
        code: { coding: [{ system: m.system, code: m.code, display: m.display }] },
        valueQuantity: { value: num(v.value), unit: m.ucumDisplay, system: SYS.ucum, code: m.ucum },
      });
    }
  }
  const keys = new Set([...systolic.keys(), ...diastolic.keys()]);
  for (const k of keys) {
    const s = systolic.get(k); const d = diastolic.get(k); const any = (s ?? d)!;
    const comp = (c: typeof BP_SYSTOLIC, v: VitalRow) => ({
      code: { coding: [{ system: c.system, code: c.code, display: c.display }] },
      valueQuantity: { value: num(v.value), unit: MMHG.display, system: SYS.ucum, code: MMHG.ucum },
    });
    out.push({
      ...base(any), id: (s ?? d)!.id,
      category: [{ coding: [{ system: SYS.observationCategory, code: 'vital-signs' }] }],
      code: { coding: [{ system: BP_PANEL.system, code: BP_PANEL.code, display: BP_PANEL.display }] },
      component: [...(s ? [comp(BP_SYSTOLIC, s)] : []), ...(d ? [comp(BP_DIASTOLIC, d)] : [])],
    });
  }
  return out;
}

export function operationOutcome(severity: 'error' | 'warning' | 'information', code: OperationOutcome['issue'][number]['code'], text: string): OperationOutcome {
  return { resourceType: 'OperationOutcome', issue: [{ severity, code, details: { text } }] };
}
