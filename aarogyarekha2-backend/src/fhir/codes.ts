// Code systems and mappings used by the FHIR R4 projection. One place, so unverified items are easy to audit.
//
// VERIFY BEFORE PRODUCTION (flagged OPEN in docs/00-decisions.md):
//  * ABHA identifier system URIs: confirm against the current NRCeS / ABDM FHIR implementation guide.
//  * SNOMED CT is only emitted when symptom_entries.code_system says so (licence pending). Never invented here.

export const SYS = {
  loinc: 'http://loinc.org',
  ucum: 'http://unitsofmeasure.org',
  snomed: 'http://snomed.info/sct',
  observationCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  v3ActCode: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  // Project-local systems (example.org style placeholders until a canonical base URL is registered).
  local: 'https://aarogyarekha.example/fhir/CodeSystem',
  localId: 'https://aarogyarekha.example/fhir/identifier',
  // ABDM identifiers  [OPEN: confirm URIs against the NRCeS IG]
  abhaNumber: 'https://healthid.ndhm.gov.in',
  abhaAddress: 'https://healthid.ndhm.gov.in/address',
} as const;

export type VitalKind =
  | 'temperature_c' | 'spo2_pct' | 'pulse_bpm' | 'resp_rate_pm' | 'bp_systolic_mmhg'
  | 'bp_diastolic_mmhg' | 'weight_kg' | 'height_cm' | 'blood_glucose_mgdl' | 'muac_cm';

export interface VitalMap {
  system: string; code: string; display: string;
  ucum: string; ucumDisplay: string;
  category: 'vital-signs' | 'laboratory' | 'exam';
}

export const VITALS: Record<Exclude<VitalKind, 'bp_systolic_mmhg' | 'bp_diastolic_mmhg'>, VitalMap> = {
  temperature_c:      { system: SYS.loinc, code: '8310-5',  display: 'Body temperature',                          ucum: 'Cel',   ucumDisplay: '°C',    category: 'vital-signs' },
  spo2_pct:           { system: SYS.loinc, code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry', ucum: '%', ucumDisplay: '%', category: 'vital-signs' },
  pulse_bpm:          { system: SYS.loinc, code: '8867-4',  display: 'Heart rate',                                ucum: '/min',  ucumDisplay: '/min',  category: 'vital-signs' },
  resp_rate_pm:       { system: SYS.loinc, code: '9279-1',  display: 'Respiratory rate',                          ucum: '/min',  ucumDisplay: '/min',  category: 'vital-signs' },
  weight_kg:          { system: SYS.loinc, code: '29463-7', display: 'Body weight',                               ucum: 'kg',    ucumDisplay: 'kg',    category: 'vital-signs' },
  height_cm:          { system: SYS.loinc, code: '8302-2',  display: 'Body height',                               ucum: 'cm',    ucumDisplay: 'cm',    category: 'vital-signs' },
  blood_glucose_mgdl: { system: SYS.loinc, code: '2339-0',  display: 'Glucose [Mass/volume] in Blood',            ucum: 'mg/dL', ucumDisplay: 'mg/dL', category: 'laboratory' },
  // MUAC: local code on purpose (not confident of the right LOINC concept; do not guess terminology).
  muac_cm:            { system: SYS.local + '/vitals', code: 'muac', display: 'Mid-upper-arm circumference',    ucum: 'cm',    ucumDisplay: 'cm',    category: 'exam' },
};

export const BP_PANEL = { system: SYS.loinc, code: '85354-9', display: 'Blood pressure panel with all children optional' };
export const BP_SYSTOLIC = { system: SYS.loinc, code: '8480-6', display: 'Systolic blood pressure' };
export const BP_DIASTOLIC = { system: SYS.loinc, code: '8462-4', display: 'Diastolic blood pressure' };
export const MMHG = { ucum: 'mm[Hg]', display: 'mmHg' };

// Encounter lifecycle. Documented mapping (our statuses are review-workflow states, FHIR's are visit states).
export const ENCOUNTER_STATUS = {
  draft: 'planned',
  submitted: 'arrived',
  in_review: 'triaged',
  reviewed: 'in-progress',
  referred: 'finished',
  closed: 'finished',
  cancelled: 'cancelled',
} as const;

export const SEX_TO_GENDER = { female: 'female', male: 'male', other: 'other', unknown: 'unknown' } as const;
