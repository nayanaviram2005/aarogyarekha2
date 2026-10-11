import { indexStructureDefinitionBundle, validateResource } from '@medplum/core';
import { readJson } from '@medplum/definitions';
import type { Bundle } from 'fhir/r4';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReferralBundle, PRIORITY_FOR_URGENCY, unresolvedReferences } from '../src/fhir/referral.js';
import { ID, sample } from './helpers/referralInput.js';
import { checkNonDiagnostic } from '../src/guard/nonDiagnostic.js';

const types = (b: Bundle) => (b.entry ?? []).map(e => e.resource!.resourceType);
const find = <T,>(b: Bundle, t: string) => (b.entry ?? []).map(e => e.resource).filter(r => r?.resourceType === t) as T[];
const notes = (b: Bundle) => (find<{ note?: { text: string }[] }>(b, 'ServiceRequest')[0]!.note ?? []).map(n => n.text);

beforeAll(() => {
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json'));
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json'));
});

describe('structure (independent R4 validator: required fields, types, dates, invariants)', () => {
  it('the whole bundle validates', () => { expect(() => validateResource(buildReferralBundle(sample()) as never)).not.toThrow(); });
  it('a preview (not final) bundle validates too', () => { expect(() => validateResource(buildReferralBundle(sample({ final: false })) as never)).not.toThrow(); });
  it('validates with no assessment, no vitals, no symptoms and no signs', () => {
    expect(() => validateResource(buildReferralBundle(sample({ assessment: null, vitals: [], symptoms: [], signs: {} })) as never)).not.toThrow();
  });
  it('validates when the reviewer changed the priority', () => { expect(() => validateResource(buildReferralBundle(sample({ effectiveUrgency: 'green' })) as never)).not.toThrow(); });
  it('is a plain collection that starts with the patient, with no identifier, timestamp or full URLs', () => {
    const b = buildReferralBundle(sample());
    expect(b.type).toBe('collection'); expect(b.entry![0]!.resource!.resourceType).toBe('Patient');
    expect(b.identifier).toBeUndefined(); expect(b.timestamp).toBeUndefined(); expect((b.entry ?? []).every(e => e.fullUrl === undefined)).toBe(true);
  });
  it('the validator is actually capable of rejecting a broken bundle (so passing means something)', () => {
    const b = buildReferralBundle(sample());
    delete (b.entry![1]!.resource as { status?: string }).status;
    expect(() => validateResource(b as never)).toThrow();
  });
  it('every coded value we emit is from the allowed set (the validator does not check these bindings)', () => {
    const b = buildReferralBundle(sample());
    const sr = find<{ status: string; intent: string; priority: string }>(b, 'ServiceRequest')[0]!;
    expect(['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown']).toContain(sr.status);
    expect(['proposal', 'plan', 'directive', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option']).toContain(sr.intent);
    expect(['routine', 'urgent', 'asap', 'stat']).toContain(sr.priority);
    expect(['male', 'female', 'other', 'unknown']).toContain(find<{ gender: string }>(b, 'Patient')[0]!.gender);
  });
});

describe('only the patient’s health goes in', () => {
  it('has just the patient, the request and the measurements', () => {
    expect(new Set(types(buildReferralBundle(sample())))).toEqual(new Set(['Patient', 'ServiceRequest', 'Observation']));
  });
  it('has no facilities, staff, consent records, provenance, encounter, rule-set details or vendor URLs', () => {
    const json = JSON.stringify(buildReferralBundle(sample()));
    for (const s of ['Organization', 'Practitioner', 'Consent', 'Provenance', 'Composition', 'Encounter', 'fullUrl', 'extension', 'meta', 'identifier', 'communication', 'managingOrganization', 'attester', 'custodian', 'author', 'requester', 'performer',
      'aarogyarekha', 'WHO-PREG-BP', 'ruleSet', 'engine', 'terminology.hl7.org', 'unitsofmeasure', 'vital-signs', 'Nurse', 'Mehta']) expect(json, s).not.toContain(s);
  });
  it('the only web address in it is the LOINC code system the codes belong to', () => {
    const urls = [...new Set(JSON.stringify(buildReferralBundle(sample())).match(/https?:\/\/[^"]+/g) ?? [])];
    expect(urls).toEqual(['http://loinc.org']);
  });
  it('does not include the phone number, street address, village, district, state or pincode', () => {
    const json = JSON.stringify(buildReferralBundle(sample()));
    for (const secret of ['+919999900000', '12 Secret Lane', '752001', 'Odisha', 'Khordha', 'AR-0001']) expect(json).not.toContain(secret);
  });
  it('is short: well under 4 KB for a typical referral, with no repeated narrative', () => {
    const json = JSON.stringify(buildReferralBundle(sample()));
    expect(json.length).toBeLessThan(4000);
    expect(json).not.toContain('xhtml'); expect(json).not.toContain('<div');
  });
  it('carries each reading once, with the LOINC code and the unit, and no coding system for units', () => {
    const obs = find<{ id: string; code: { coding?: { system: string; code: string }[]; text?: string }; valueQuantity?: { value: number; unit: string; system?: string; code?: string } }>(buildReferralBundle(sample()), 'Observation');
    const temp = obs.find(o => o.code.coding?.[0]?.code === '8310-5')!; expect(temp.valueQuantity).toEqual({ value: 37.2, unit: '°C' });
    expect(new Set(obs.map(o => o.id)).size).toBe(obs.length);
  });
  it('a measurement with no standard code is carried as plain text, not a made-up code system', () => {
    const obs = find<{ code: { coding?: unknown; text?: string }; valueQuantity?: { value: number; unit: string } }>(buildReferralBundle(sample()), 'Observation');
    const muac = obs.find(o => o.code.text === 'Mid-upper-arm circumference')!; expect(muac.code.coding).toBeUndefined(); expect(muac.valueQuantity).toEqual({ value: 21, unit: 'cm' });
  });
  it('blood pressure is one reading with both numbers, even when the two were typed a few seconds apart', () => {
    const bp = find<{ code: { coding: { code: string }[] }; component: { valueQuantity: { value: number } }[] }>(buildReferralBundle(sample()), 'Observation').filter(o => o.code.coding?.[0]?.code === '85354-9');
    expect(bp).toHaveLength(1); expect(bp[0]!.component.map(c => c.valueQuantity.value)).toEqual([165, 104]);
  });
  it('age comes as a single age reading when there is no birth date, and as the birth date when there is', () => {
    const ages = (b: Bundle) => find<{ code: { coding?: { code: string }[] }; valueQuantity: { value: number; unit: string } }>(b, 'Observation').filter(o => o.code.coding?.[0]?.code === '30525-0');
    expect(ages(buildReferralBundle(sample()))[0]!.valueQuantity).toEqual({ value: 27, unit: 'years' });
    const b = buildReferralBundle(sample({ patient: { ...sample().patient, birth_date: '1999-03-02' } }));
    expect(ages(b)).toHaveLength(0); expect(find<{ birthDate: string }>(b, 'Patient')[0]!.birthDate).toBe('1999-03-02');
  });
  it('the patient has the name, sex and nothing else about them', () => {
    expect(find<Record<string, unknown>>(buildReferralBundle(sample()), 'Patient')[0]).toEqual({ resourceType: 'Patient', id: ID(2), name: [{ text: 'Test Patient' }], gender: 'female' });
  });
});

describe('references', () => {
  it('every reference resolves to an entry in the bundle, so the receiver needs nothing else', () => {
    expect(unresolvedReferences(buildReferralBundle(sample()))).toEqual([]);
  });
  it('the check catches a dangling reference', () => {
    const b = buildReferralBundle(sample());
    (b.entry![1]!.resource as unknown as { subject: { reference: string } }).subject.reference = 'Patient/not-in-bundle';
    expect([...new Set(unresolvedReferences(b))]).toEqual(['Patient/not-in-bundle']);
  });
});

describe('what the health notes say', () => {
  it('lists the complaint with its translation, the symptoms, the danger-sign checks, the priority with the reason, and what is still missing', () => {
    expect(notes(buildReferralBundle(sample()))).toEqual([
      'Reported complaint: सिरदर्द और पैरों में सूजन (in English: Headache and swollen feet)',
      'Symptoms reported: Headache, for 2 days, severity 5 of 10',
      'Danger-sign checks: convulsions in pregnancy: no',
      'Review priority (rule-based): Very urgent (tier 2 of 4). Reason: Blood pressure in the severe range for pregnancy (as recorded)',
      'Not yet collected: Not yet assessed: Heavy vaginal bleeding',
    ]);
  });
  it('leaves out anything that was not recorded, instead of printing “none”', () => {
    const b = buildReferralBundle(sample({ symptoms: [], signs: {}, assessment: null, encounter: { ...sample().encounter, chief_complaint_original: null, chief_complaint_translated: null } }));
    expect(find<{ note?: unknown }>(b, 'ServiceRequest')[0]!.note).toBeUndefined();
  });
  it('says so when a reviewer changed the priority, and shows the level that applies', () => {
    expect(notes(buildReferralBundle(sample({ effectiveUrgency: 'red' }))).join(' ')).toMatch(/Immediate \(tier 1 of 4\)\. Reason: .*\. A reviewer changed this priority/);
  });
  it('the reason for referral is carried as written, in the ServiceRequest', () => {
    expect(find<{ reasonCode: { text: string }[] }>(buildReferralBundle(sample()), 'ServiceRequest')[0]!.reasonCode[0]!.text).toBe('Needs assessment by an obstetrician at a higher facility.');
  });
  it('typed text is carried as plain text, never as markup', () => {
    const b = buildReferralBundle(sample({ reasonText: '<script>alert(1)</script> & "quoted"' }));
    expect(JSON.stringify(b)).not.toContain('xhtml'); expect(() => validateResource(b as never)).not.toThrow();
  });
});

describe('non-diagnostic by construction', () => {
  it('contains no Condition, DiagnosticReport, CarePlan or medication resource', () => {
    const t = types(buildReferralBundle(sample()));
    for (const banned of ['Condition', 'DiagnosticReport', 'CarePlan', 'MedicationRequest', 'MedicationStatement', 'RiskAssessment']) expect(t).not.toContain(banned);
  });
  it('all system-written notes pass the non-diagnostic guard', () => {
    for (const n of notes(buildReferralBundle(sample()))) if (!n.startsWith('Reported complaint')) expect(checkNonDiagnostic(n).allowed, n).toBe(true);
  });
});

describe('request and status', () => {
  it('maps each review priority to a FHIR request priority', () => {
    expect(PRIORITY_FOR_URGENCY).toEqual({ red: 'stat', orange: 'asap', yellow: 'urgent', green: 'routine' });
  });
  it('a sent bundle has an active request, and a preview has a draft', () => {
    expect(find<{ status: string }>(buildReferralBundle(sample()), 'ServiceRequest')[0]!.status).toBe('active');
    expect(find<{ status: string }>(buildReferralBundle(sample({ final: false })), 'ServiceRequest')[0]!.status).toBe('draft');
  });
  it('is deterministic for the same input', () => {
    expect(JSON.stringify(buildReferralBundle(sample()))).toBe(JSON.stringify(buildReferralBundle(sample())));
  });
});
