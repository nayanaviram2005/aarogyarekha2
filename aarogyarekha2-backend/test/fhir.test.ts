import { describe, expect, it } from 'vitest';
import { toFhirEncounter, toFhirPatient, toFhirVitals, type EncounterRow, type PatientRow, type VitalRow } from '../src/fhir/project.js';
import { ENCOUNTER_STATUS } from '../src/fhir/codes.js';

const patient: PatientRow = {
  id: '11111111-1111-4111-8111-111111111111', public_ref: 'AR-0001', registered_facility_id: '22222222-2222-4222-8222-222222222222',
  full_name: 'Test Patient', preferred_language: 'or', sex: 'female', birth_date: null, age_years_reported: 34,
  phone: '+919999900000', address_line: null, village_town: 'Khordha', district: 'Khordha', state: 'Odisha', pincode: '752001',
  updated_at: '2026-10-06T10:00:00Z',
};

const encounter: EncounterRow = {
  id: '33333333-3333-4333-8333-333333333333', patient_id: patient.id, facility_id: patient.registered_facility_id,
  status: 'in_review', scenario: 'opd_queue', language: 'or',
  chief_complaint_original: 'ଜ୍ୱର ତିନି ଦିନ', chief_complaint_translated: 'Fever for three days',
  submitted_at: '2026-10-06T09:30:00Z', closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T10:00:00Z',
};

describe('Patient projection', () => {
  const p = toFhirPatient(patient, [{ system: 'abha_number', value: '91-1234-5678-9012' }]);

  it('maps core fields', () => {
    expect(p.resourceType).toBe('Patient');
    expect(p.gender).toBe('female');
    expect(p.name?.[0]?.text).toBe('Test Patient');
    expect(p.communication?.[0]?.language.coding?.[0]?.code).toBe('or');
    expect(p.address?.[0]).toMatchObject({ city: 'Khordha', state: 'Odisha', postalCode: '752001', country: 'IN' });
  });

  it('never fabricates a birth date; records reported age as an explicit extension', () => {
    expect(p.birthDate).toBeUndefined();
    expect(p.extension?.[0]).toMatchObject({ valueInteger: 34 });
  });

  it('emits the public ref and ABHA as identifiers', () => {
    expect(p.identifier?.map(i => i.value)).toEqual(['AR-0001', '91-1234-5678-9012']);
  });

  it('omits telecom and address entirely when absent', () => {
    const bare = toFhirPatient({ ...patient, phone: null, village_town: null, district: null, state: null, pincode: null });
    expect(bare.telecom).toBeUndefined();
    expect(bare.address).toBeUndefined();
  });

  it('uses the birth date and no age extension when the birth date is known', () => {
    const withDob = toFhirPatient({ ...patient, birth_date: '1992-04-01' });
    expect(withDob.birthDate).toBe('1992-04-01');
    expect(withDob.extension).toBeUndefined();
  });
});

describe('Encounter projection', () => {
  it('maps every internal status to a valid FHIR Encounter.status', () => {
    const valid = new Set(['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown']);
    for (const [internal, fhir] of Object.entries(ENCOUNTER_STATUS)) expect(valid.has(fhir), internal).toBe(true);
    expect(Object.keys(ENCOUNTER_STATUS).sort()).toEqual(['cancelled', 'closed', 'draft', 'in_review', 'referred', 'reviewed', 'submitted'].sort());
  });

  it('keeps the original-language complaint primary and the translation as an extension', () => {
    const e = toFhirEncounter(encounter);
    expect(e.status).toBe('triaged');
    expect(e.reasonCode?.[0]?.text).toBe('ଜ୍ୱର ତିନି ଦିନ');
    expect(e.reasonCode?.[0]?.extension?.[0]).toMatchObject({ valueString: 'Fever for three days' });
    expect(e.period).toEqual({ start: '2026-10-06T09:30:00Z' });
  });

  it('contains no diagnosis-bearing element', () => {
    const json = JSON.stringify(toFhirEncounter(encounter));
    expect(json).not.toMatch(/"diagnosis"/);
  });
});

describe('Vitals projection', () => {
  const v = (kind: VitalRow['kind'], value: number | string, at = '2026-10-06T09:40:00Z', id: string = kind): VitalRow =>
    ({ id, encounter_id: encounter.id, kind, value, unit: 'x', measured_at: at });

  it('maps temperature to LOINC with UCUM units, coercing numeric strings from Postgres', () => {
    const [o] = toFhirVitals(patient.id, [v('temperature_c', '38.6')]);
    expect(o?.code?.coding?.[0]).toMatchObject({ system: 'http://loinc.org', code: '8310-5' });
    expect(o?.valueQuantity).toMatchObject({ value: 38.6, system: 'http://unitsofmeasure.org', code: 'Cel' });
    expect(o?.category?.[0]?.coding?.[0]?.code).toBe('vital-signs');
  });

  it('combines a same-time systolic and diastolic reading into ONE blood pressure panel', () => {
    const obs = toFhirVitals(patient.id, [v('bp_systolic_mmhg', 120, undefined, 's'), v('bp_diastolic_mmhg', 80, undefined, 'd')]);
    expect(obs).toHaveLength(1);
    expect(obs[0]?.code?.coding?.[0]?.code).toBe('85354-9');
    expect(obs[0]?.component?.map(c => c.code?.coding?.[0]?.code)).toEqual(['8480-6', '8462-4']);
    expect(obs[0]?.component?.map(c => c.valueQuantity?.value)).toEqual([120, 80]);
  });

  it('keeps readings from different times as separate panels', () => {
    const obs = toFhirVitals(patient.id, [
      v('bp_systolic_mmhg', 120, '2026-10-06T09:40:00Z', 's1'), v('bp_diastolic_mmhg', 80, '2026-10-06T09:40:00Z', 'd1'),
      v('bp_systolic_mmhg', 150, '2026-10-06T10:10:00Z', 's2'), v('bp_diastolic_mmhg', 95, '2026-10-06T10:10:00Z', 'd2'),
    ]);
    expect(obs).toHaveLength(2);
  });

  it('a lone systolic reading becomes a one-component panel rather than being dropped', () => {
    const obs = toFhirVitals(patient.id, [v('bp_systolic_mmhg', 130)]);
    expect(obs).toHaveLength(1);
    expect(obs[0]?.component).toHaveLength(1);
  });

  it('uses a project-local code for MUAC rather than guessing a LOINC code', () => {
    const [o] = toFhirVitals(patient.id, [v('muac_cm', 11.5)]);
    expect(o?.code?.coding?.[0]?.system).not.toBe('http://loinc.org');
    expect(o?.code?.coding?.[0]?.code).toBe('muac');
  });

  it('links every observation to the patient and encounter', () => {
    const [o] = toFhirVitals(patient.id, [v('pulse_bpm', 96)]);
    expect(o?.subject?.reference).toBe(`Patient/${patient.id}`);
    expect(o?.encounter?.reference).toBe(`Encounter/${encounter.id}`);
  });
});
