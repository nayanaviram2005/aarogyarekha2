import { describe, expect, it } from 'vitest';
import { ageYearsAt, buildTriageInput, type PatientFacts } from '../src/intake/input.js';
import { buildFollowUps } from '../src/intake/followups.js';
import { isConsentActive } from '../src/intake/consent.js';
import { triage } from '../src/triage/engine.js';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import { checkNonDiagnostic } from '../src/guard/nonDiagnostic.js';
import type { VitalRow } from '../src/fhir/project.js';

const NOW = new Date('2026-10-06T12:00:00Z');
const facts = (over: Partial<PatientFacts> = {}): PatientFacts => ({ birth_date: '1990-01-01', age_years_reported: null, sex: 'female', pregnancyOngoing: false, ...over });
const vital = (kind: VitalRow['kind'], value: number | string, at: string, id = `${kind}-${at}`): VitalRow => ({ id, encounter_id: 'e', kind, value, unit: 'x', measured_at: at });

describe('age', () => {
  it('is fractional for infants, so a 3-month-old is a child and not zero', () => {
    const a = ageYearsAt('2026-07-06', NOW)!;
    expect(a).toBeGreaterThan(0.2); expect(a).toBeLessThan(0.3);
  });
  it('is never negative and rejects garbage dates', () => {
    expect(ageYearsAt('2030-01-01', NOW)).toBe(0);
    expect(ageYearsAt('not a date', NOW)).toBeNull();
  });
  it('falls back to the age reported at a camp when there is no birth date', () => {
    expect(buildTriageInput(facts({ birth_date: null, age_years_reported: 34 }), [], {}, NOW).ageYears).toBe(34);
  });
  it('is unknown (null), not zero, when neither is recorded', () => {
    expect(buildTriageInput(facts({ birth_date: null, age_years_reported: null }), [], {}, NOW).ageYears).toBeNull();
  });
});

describe('pregnancy status', () => {
  it('an explicit answer wins over everything else', () => {
    expect(buildTriageInput(facts({ sex: 'male' }), [], { pregnant: true }, NOW).pregnant).toBe(true);
    expect(buildTriageInput(facts({ pregnancyOngoing: true }), [], { pregnant: false }, NOW).pregnant).toBe(false);
  });
  it('a recorded ongoing pregnancy means pregnant', () => {
    expect(buildTriageInput(facts({ pregnancyOngoing: true }), [], {}, NOW).pregnant).toBe(true);
  });
  it('a male patient is not pregnant', () => {
    expect(buildTriageInput(facts({ sex: 'male' }), [], {}, NOW).pregnant).toBe(false);
  });
  it('a small girl is not asked (question suppression only)', () => {
    expect(buildTriageInput(facts({ birth_date: '2023-01-01' }), [], {}, NOW).pregnant).toBe(false);
  });
  it('an adult woman with nothing recorded is UNKNOWN, never assumed "no"', () => {
    expect(buildTriageInput(facts(), [], {}, NOW).pregnant).toBeNull();
    expect(buildTriageInput(facts({ sex: 'unknown' }), [], {}, NOW).pregnant).toBeNull();
  });
});

describe('vitals and answers', () => {
  it('uses the LATEST reading per kind and coerces numeric strings from Postgres', () => {
    const i = buildTriageInput(facts(), [
      vital('temperature_c', '37.0', '2026-10-06T09:00:00Z'), vital('temperature_c', '39.2', '2026-10-06T10:00:00Z'),
      vital('pulse_bpm', 88, '2026-10-06T09:30:00Z'),
    ], {}, NOW);
    expect(i.vitals).toEqual({ temperature_c: 39.2, pulse_bpm: 88 });
  });
  it('ignores vitals the engine does not score', () => {
    const i = buildTriageInput(facts(), [vital('weight_kg', 60, '2026-10-06T09:00:00Z')], {}, NOW);
    expect(i.vitals).toEqual({});
  });
  it('carries danger-sign answers, consciousness and oxygen status; unanswered stays unanswered', () => {
    const i = buildTriageInput(facts(), [], { signs: { central_cyanosis: false }, consciousness: 'voice' }, NOW);
    expect(i.signs).toEqual({ central_cyanosis: false });
    expect(i.consciousness).toBe('voice');
    expect(i.onSupplementalOxygen).toBeNull();
  });
});

describe('consent validity', () => {
  const live = { revoked_at: null, expires_at: null, granted_at: '2026-10-01T00:00:00Z' };
  it('an unrevoked, unexpired consent is active', () => expect(isConsentActive([live], NOW)).toBe(true));
  it('no consent at all is not active', () => expect(isConsentActive([], NOW)).toBe(false));
  it('a revoked consent is not active', () => expect(isConsentActive([{ ...live, revoked_at: '2026-10-02T00:00:00Z' }], NOW)).toBe(false));
  it('an expired consent is not active', () => expect(isConsentActive([{ ...live, expires_at: '2026-10-05T00:00:00Z' }], NOW)).toBe(false));
  it('a consent that expires exactly now is not active', () => expect(isConsentActive([{ ...live, expires_at: NOW.toISOString() }], NOW)).toBe(false));
  it('a consent that has not started yet is not active', () => expect(isConsentActive([{ ...live, granted_at: '2026-10-07T00:00:00Z' }], NOW)).toBe(false));
  it('one active consent is enough even if an older one was revoked', () =>
    expect(isConsentActive([{ ...live, revoked_at: '2026-10-02T00:00:00Z' }, live], NOW)).toBe(true));
});

describe('follow-up questions', () => {
  const child = { ageYears: 3, pregnant: false, vitals: { temperature_c: 37 }, signs: { vomits_everything: false } as Record<string, boolean> };
  const d = triage(child, RS);
  const fu = buildFollowUps(d.missing, RS);

  it('asks about every unassessed sign, and skips the ones already answered', () => {
    const codes = fu.map(f => f.fieldCode);
    expect(codes).toContain('sign.central_cyanosis');
    expect(codes).not.toContain('sign.vomits_everything');
  });
  it('puts the questions that could change the tier most first, and ranks from 1', () => {
    expect(fu[0]!.rank).toBe(1);
    const pts = fu.map(f => f.potentialTier ?? 9);
    expect(pts).toEqual([...pts].sort((a, b) => a - b));
    expect(fu[0]!.potentialTier).not.toBeNull();
  });
  it('uses the question text stored in the rule', () => {
    expect(fu.find(f => f.fieldCode === 'sign.central_cyanosis')?.question).toBe('Are the lips or tongue blue or grey?');
  });
  it('asks for missing vitals, age and pregnancy status in plain words', () => {
    const adult = triage({ ageYears: null, pregnant: null, vitals: { temperature_c: 37 }, signs: {} }, RS);
    const q = buildFollowUps(adult.missing, RS).map(f => f.question);
    expect(q).toContain("What is the patient's age?");
    expect(q).toContain('Is the patient pregnant?');
  });
  it('asks for an unrecorded SpO2 by name', () => {
    const a = triage({ ageYears: 40, pregnant: false, vitals: { temperature_c: 37 }, signs: { central_cyanosis: false }, consciousness: 'alert', onSupplementalOxygen: false }, RS);
    expect(buildFollowUps(a.missing, RS).map(f => f.question)).toContain('Record oxygen saturation (SpO2), if a pulse oximeter is available.');
  });
  it('never repeats a field', () => {
    const codes = fu.map(f => f.fieldCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it('every question text in the rule set, and every generic question, passes the non-diagnostic guard', () => {
    for (const f of RS.floors) { expect(f.question.length, f.id).toBeGreaterThan(5); expect(checkNonDiagnostic(f.question).allowed, `${f.id}: ${f.question}`).toBe(true); }
    const everything = triage({ ageYears: null, pregnant: null, vitals: {}, signs: {} }, RS);
    for (const f of buildFollowUps(everything.missing, RS)) expect(checkNonDiagnostic(f.question).allowed, f.question).toBe(true);
  });
  it('every question is phrased as a question or an instruction to record, never a conclusion', () => {
    for (const f of buildFollowUps(triage({ ageYears: 28, pregnant: true, vitals: {}, signs: {} }, RS).missing, RS))
      expect(/\?$|^(Record|Count)/.test(f.question), f.question).toBe(true);
  });
});

describe('end to end: stored facts -> engine input -> decision', () => {
  it('a 3-year-old with a recorded temperature and an answered danger sign is a child, with child-only questions', () => {
    const input = buildTriageInput(facts({ birth_date: '2023-06-01' }), [vital('temperature_c', 39.2, '2026-10-06T10:00:00Z')], { signs: { vomits_everything: true } }, NOW);
    const d = triage(input, RS);
    expect(input.ageYears).toBeCloseTo(3.35, 1);
    expect(d.tier).toBe(2);
    expect(d.news2.applicable).toBe(false);
    expect(d.winning.ruleId).toBe('IMNCI-G2');
  });
});
