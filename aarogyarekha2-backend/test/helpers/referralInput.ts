import type { ReferralBuildInput } from '../../src/fhir/referral.js';

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const sample = (over: Partial<ReferralBuildInput> = {}): ReferralBuildInput => ({
  referralId: ID(1), final: true,
  patient: { id: ID(2), public_ref: 'AR-0001', registered_facility_id: ID(10), full_name: 'Test Patient', preferred_language: 'hi', sex: 'female', birth_date: null, age_years_reported: 27,
    phone: '+919999900000', address_line: '12 Secret Lane', village_town: 'Khordha', district: 'Khordha', state: 'Odisha', pincode: '752001', updated_at: '2026-10-06T10:00:00Z' },
  encounter: { id: ID(3), patient_id: ID(2), facility_id: ID(10), status: 'in_review', scenario: 'maternal_followup', language: 'hi', chief_complaint_original: 'सिरदर्द और पैरों में सूजन', chief_complaint_translated: 'Headache and swollen feet',
    submitted_at: '2026-10-06T09:30:00Z', closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T10:00:00Z' },
  priority: 'asap', reasonText: 'Needs assessment by an obstetrician at a higher facility.',
  symptoms: [{ id: ID(30), text_original: 'Headache', text_translated: null, duration_value: 2, duration_unit: 'days', severity: 5 }],
  vitals: [
    { id: ID(40), encounter_id: ID(3), kind: 'bp_systolic_mmhg', value: '165', unit: 'mm[Hg]', measured_at: '2026-10-06T09:40:00Z' },
    { id: ID(41), encounter_id: ID(3), kind: 'bp_diastolic_mmhg', value: '104', unit: 'mm[Hg]', measured_at: '2026-10-06T09:40:03Z' },
    { id: ID(42), encounter_id: ID(3), kind: 'temperature_c', value: '37.2', unit: 'Cel', measured_at: '2026-10-06T09:41:00Z' },
    { id: ID(43), encounter_id: ID(3), kind: 'muac_cm', value: '21', unit: 'cm', measured_at: '2026-10-06T09:42:00Z' },
  ],
  signs: { convulsions_in_pregnancy: false },
  assessment: { urgency_code: 'orange', note: { winning: { detail: 'Blood pressure in the severe range for pregnancy (as recorded)' }, missing: [{ label: 'Not yet assessed: Heavy vaginal bleeding' }] } },
  effectiveUrgency: 'orange',
  ...over,
});
