import { indexStructureDefinitionBundle, validateResource } from '@medplum/core';
import { readJson } from '@medplum/definitions';
import type { Bundle } from 'fhir/r4';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildReferralBundle, PRIORITY_FOR_URGENCY, unresolvedReferences, type ReferralBuildInput } from '../src/fhir/referral.js';
import { checkNonDiagnostic } from '../src/guard/nonDiagnostic.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = (over: Partial<ReferralBuildInput> = {}): ReferralBuildInput => ({
  referralId: ID(1), now: new Date('2026-10-06T12:00:00Z'), final: true,
  patient: { id: ID(2), public_ref: 'AR-0001', registered_facility_id: ID(10), full_name: 'Test Patient', preferred_language: 'hi', sex: 'female', birth_date: null, age_years_reported: 27,
    phone: '+919999900000', address_line: '12 Secret Lane', village_town: 'Khordha', district: 'Khordha', state: 'Odisha', pincode: '752001', updated_at: '2026-10-06T10:00:00Z' },
  identifiers: [{ system: 'abha_number', value: '91-1234-5678-9012' }],
  encounter: { id: ID(3), patient_id: ID(2), facility_id: ID(10), status: 'in_review', scenario: 'maternal_followup', language: 'hi', chief_complaint_original: 'सिरदर्द और पैरों में सूजन', chief_complaint_translated: 'Headache and swollen feet',
    submitted_at: '2026-10-06T09:30:00Z', closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T10:00:00Z' },
  from: { id: ID(10), name: 'Seed PHC Khordha', type: 'phc', state: 'Odisha', district: 'Khordha' },
  to: { id: ID(11), name: 'Seed District Hospital', type: 'district_hospital', state: 'Odisha', district: 'Khordha' },
  requester: { id: ID(20), name: 'Nurse Rao' }, priority: 'asap', reasonText: 'Needs assessment by an obstetrician at a higher facility.',
  symptoms: [{ id: ID(30), text_original: 'Headache', text_translated: null, duration_value: 2, duration_unit: 'days', severity: 5 }],
  vitals: [
    { id: ID(40), encounter_id: ID(3), kind: 'bp_systolic_mmhg', value: '165', unit: 'mm[Hg]', measured_at: '2026-10-06T09:40:00Z' },
    { id: ID(41), encounter_id: ID(3), kind: 'bp_diastolic_mmhg', value: '104', unit: 'mm[Hg]', measured_at: '2026-10-06T09:40:00Z' },
    { id: ID(42), encounter_id: ID(3), kind: 'temperature_c', value: '37.2', unit: 'Cel', measured_at: '2026-10-06T09:41:00Z' },
  ],
  signs: { convulsions_in_pregnancy: false },
  assessment: { id: ID(50), version: 1, urgency_code: 'orange', note: { tier: 2, winning: { ruleId: 'WHO-PREG-BP', detail: 'Blood pressure in the severe range for pregnancy (as recorded)' }, log: [], missing: [{ label: 'Not yet assessed: Heavy vaginal bleeding' }], ruleSet: { name: 'aarogyarekha-layered', version: '0.1.1', hash: 'abc123' }, vulnerable: true } },
  effectiveUrgency: 'orange',
  review: { reviewer: { id: ID(21), name: 'Dr Mehta' }, at: '2026-10-06T11:00:00Z', action: 'approve', reason: null },
  consents: [{ purpose: 'care_triage', granted_at: '2026-10-06T08:55:00Z' }, { purpose: 'referral_sharing', granted_at: '2026-10-06T11:05:00Z' }],
  engineVersion: 'aarogyarekha-engine/0.1.0',
  ...over,
});
const types = (b: Bundle) => (b.entry ?? []).map(e => e.resource!.resourceType);
const find = <T,>(b: Bundle, t: string) => (b.entry ?? []).map(e => e.resource).filter(r => r?.resourceType === t) as T[];

beforeAll(() => {
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json'));
  indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json'));
});

describe('structure (independent R4 validator: required fields, types, dates, invariants)', () => {
  it('the whole document bundle validates', () => { expect(() => validateResource(buildReferralBundle(input()) as never)).not.toThrow(); });
  it('a preview (not final) bundle validates too', () => { expect(() => validateResource(buildReferralBundle(input({ final: false })) as never)).not.toThrow(); });
  it('validates with no assessment, no review and no vitals', () => {
    expect(() => validateResource(buildReferralBundle(input({ assessment: null, review: null, vitals: [], symptoms: [], signs: {}, consents: [] })) as never)).not.toThrow();
  });
  it('validates when the reviewer changed the priority', () => {
    const b = buildReferralBundle(input({ effectiveUrgency: 'green', review: { reviewer: { id: ID(21), name: 'Dr Mehta' }, at: '2026-10-06T11:00:00Z', action: 'override_urgency', reason: '[other] x' } }));
    expect(() => validateResource(b as never)).not.toThrow();
  });
  it('is a document: the first entry is the Composition and the bundle has an identifier', () => {
    const b = buildReferralBundle(input());
    expect(b.type).toBe('document');
    expect(b.entry![0]!.resource!.resourceType).toBe('Composition');
    expect(b.identifier).toMatchObject({ value: ID(1) });
  });
  it('the validator is actually capable of rejecting a broken bundle (so passing means something)', () => {
    const b = buildReferralBundle(input());
    delete (b.entry![0]!.resource as { status?: string }).status;
    expect(() => validateResource(b as never)).toThrow();
  });
  it('every coded value we emit is from the allowed set (the validator does not check these bindings)', () => {
    const b = buildReferralBundle(input());
    const sr = find<{ status: string; intent: string; priority: string }>(b, 'ServiceRequest')[0]!;
    expect(['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown']).toContain(sr.status);
    expect(['proposal', 'plan', 'directive', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option']).toContain(sr.intent);
    expect(['routine', 'urgent', 'asap', 'stat']).toContain(sr.priority);
    expect(['preliminary', 'final', 'amended', 'entered-in-error']).toContain(find<{ status: string }>(b, 'Composition')[0]!.status);
    expect(['male', 'female', 'other', 'unknown']).toContain(find<{ gender: string }>(b, 'Patient')[0]!.gender);
  });
});

describe('references', () => {
  it('every reference resolves to an entry in the bundle, so the receiver needs nothing else', () => {
    expect(unresolvedReferences(buildReferralBundle(input()))).toEqual([]);
  });
  it('the check catches a dangling reference', () => {
    const b = buildReferralBundle(input());
    (b.entry![0]!.resource as unknown as { subject: { reference: string } }).subject.reference = 'Patient/not-in-bundle';
    expect(unresolvedReferences(b)).toEqual(['Patient/not-in-bundle']);
  });
  it('contains the expected resources', () => {
    expect(new Set(types(buildReferralBundle(input())))).toEqual(new Set(['Composition', 'Patient', 'Encounter', 'ServiceRequest', 'Organization', 'Practitioner', 'Observation', 'Consent', 'Provenance']));
  });
});

describe('non-diagnostic by construction', () => {
  it('contains no Condition, DiagnosticReport, CarePlan or medication resource', () => {
    const t = types(buildReferralBundle(input()));
    for (const banned of ['Condition', 'DiagnosticReport', 'CarePlan', 'MedicationRequest', 'MedicationStatement', 'RiskAssessment']) expect(t).not.toContain(banned);
  });
  it('all system-written narrative passes the non-diagnostic guard (only the reviewer reason is human text)', () => {
    const b = buildReferralBundle(input());
    const comp = find<{ section: { title: string; text: { div: string } }[] }>(b, 'Composition')[0]!;
    for (const s of comp.section.filter(x => x.title !== 'Reason for referral')) {
      const text = s.text.div.replace(/<[^>]+>/g, ' ');
      if (s.title === 'Notice') continue;
      expect(checkNonDiagnostic(text).allowed, `${s.title}: ${text}`).toBe(true);
    }
  });
  it('states the notice in the document itself', () => {
    expect(JSON.stringify(buildReferralBundle(input()))).toContain('Does not diagnose or advise treatment.');
  });
});

describe('privacy', () => {
  const json = JSON.stringify(buildReferralBundle(input()));
  it('does not include the phone number, street address, village or pincode', () => {
    for (const secret of ['+919999900000', '12 Secret Lane', '752001']) expect(json).not.toContain(secret);
    expect(find<{ telecom?: unknown }>(buildReferralBundle(input()), 'Patient')[0]!.telecom).toBeUndefined();
  });
  it('keeps district and state, which the receiver needs', () => {
    expect(json).toContain('Odisha');
  });
  it('escapes markup in anything a person typed, so it cannot inject into the narrative', () => {
    const b = buildReferralBundle(input({ reasonText: '<script>alert(1)</script> & "quoted"', symptoms: [{ id: ID(30), text_original: '<img src=x onerror=alert(1)>', text_translated: null, duration_value: null, duration_unit: null, severity: null }] }));
    const comp = JSON.stringify(find(b, 'Composition')[0]);
    expect(comp).not.toContain('<script>');
    expect(comp).not.toContain('<img');
    expect(comp).toContain('&lt;script&gt;');
    expect(() => validateResource(b as never)).not.toThrow();
  });
  it('the reason text is carried as written, in the ServiceRequest', () => {
    expect(find<{ reasonCode: { text: string }[] }>(buildReferralBundle(input()), 'ServiceRequest')[0]!.reasonCode[0]!.text).toBe('Needs assessment by an obstetrician at a higher facility.');
  });
});

describe('priority, review and provenance', () => {
  it('maps each review priority to a FHIR request priority', () => {
    expect(PRIORITY_FOR_URGENCY).toEqual({ red: 'stat', orange: 'asap', yellow: 'urgent', green: 'routine' });
  });
  it('carries the real tier and the rules behind it in an extension, openly', () => {
    const sr = find<{ extension: { extension: { url: string; valueInteger?: number; valueString?: string; valueBoolean?: boolean }[] }[] }>(buildReferralBundle(input()), 'ServiceRequest')[0]!;
    const x = Object.fromEntries(sr.extension[0]!.extension.map(e => [e.url, e.valueInteger ?? e.valueString ?? e.valueBoolean]));
    expect(x).toMatchObject({ tier: 2, tierWord: 'Very urgent', rulesTier: 2, changedByReviewer: false, winningRule: 'WHO-PREG-BP', ruleSet: 'aarogyarekha-layered@0.1.1' });
  });
  it('records when a reviewer changed the priority, and shows both levels', () => {
    const b = buildReferralBundle(input({ effectiveUrgency: 'red' }));
    const x = find<{ extension: { extension: { url: string; valueBoolean?: boolean; valueInteger?: number }[] }[] }>(b, 'ServiceRequest')[0]!.extension[0]!.extension;
    expect(x.find(e => e.url === 'changedByReviewer')!.valueBoolean).toBe(true);
    expect(x.find(e => e.url === 'tier')!.valueInteger).toBe(1);
    expect(x.find(e => e.url === 'rulesTier')!.valueInteger).toBe(2);
    expect(JSON.stringify(b)).toContain('A reviewer changed this priority.');
  });
  it('a sent bundle is final, attested by the reviewer, and the ServiceRequest is active', () => {
    const b = buildReferralBundle(input());
    const comp = find<{ status: string; attester: { party: { reference: string } }[] }>(b, 'Composition')[0]!;
    expect(comp.status).toBe('final');
    expect(comp.attester[0]!.party.reference).toBe(`Practitioner/${ID(21)}`);
    expect(find<{ status: string }>(b, 'ServiceRequest')[0]!.status).toBe('active');
  });
  it('a preview is preliminary and the ServiceRequest is a draft', () => {
    const b = buildReferralBundle(input({ final: false }));
    expect(find<{ status: string }>(b, 'Composition')[0]!.status).toBe('preliminary');
    expect(find<{ status: string }>(b, 'ServiceRequest')[0]!.status).toBe('draft');
  });
  it('provenance names the software as author, the reviewer as verifier and the requester', () => {
    const p = find<{ agent: { type: { coding: { code: string }[] }; who: { display?: string; reference?: string } }[] }>(buildReferralBundle(input()), 'Provenance')[0]!;
    expect(p.agent.some(a => a.type.coding[0]!.code === 'author' && /rules engine.*software/i.test(a.who.display ?? ''))).toBe(true);
    expect(p.agent.some(a => a.type.coding[0]!.code === 'verifier' && a.who.reference === `Practitioner/${ID(21)}`)).toBe(true);
  });
  it('without a review there is no attester or verifier', () => {
    const b = buildReferralBundle(input({ review: null }));
    expect(find<{ attester?: unknown }>(b, 'Composition')[0]!.attester).toBeUndefined();
    expect(JSON.stringify(find(b, 'Provenance'))).not.toContain('verifier');
  });
  it('is deterministic for the same input', () => {
    expect(JSON.stringify(buildReferralBundle(input()))).toBe(JSON.stringify(buildReferralBundle(input())));
  });
  it('the same person as requester and reviewer appears once', () => {
    const b = buildReferralBundle(input({ review: { reviewer: { id: ID(20), name: 'Nurse Rao' }, at: '2026-10-06T11:00:00Z', action: 'approve', reason: null } }));
    expect(find(b, 'Practitioner')).toHaveLength(1);
  });
});
