import { describe, expect, it } from 'vitest';
import { checkNonDiagnostic } from '../src/guard/nonDiagnostic.js';
import { hashRuleSet, triage } from '../src/triage/engine.js';
import { AGE_LIMITS, BANK_FLOORS, EXCLUDED_BY, FIRST_ASK, metaOf, SYSTEM_CUES, systemOf, type System } from '../src/triage/questionBank.js';
import { RULESET_EXPANDED } from '../src/triage/ruleset.expanded.js';
import { RULESET_PROPOSED } from '../src/triage/ruleset.proposed.js';

const all = RULESET_EXPANDED.floors;
const signs = new Set(all.map(f => f.sign));

describe('the widened question list', () => {
  it('keeps every earlier question and adds well over a hundred new ones', () => {
    const before = new Set(RULESET_PROPOSED.floors.map(f => f.sign));
    for (const s of before) expect(signs.has(s), s).toBe(true);
    expect(BANK_FLOORS.length).toBeGreaterThanOrEqual(150); expect(all.length).toBeGreaterThanOrEqual(230);
    for (const f of BANK_FLOORS) expect(before.has(f.sign), `${f.sign} repeats an older question`).toBe(false);
  });
  it('has no repeated sign or id', () => {
    expect(new Set(all.map(f => f.sign)).size).toBe(all.length); expect(new Set(all.map(f => f.id)).size).toBe(all.length);
  });
  it('every new question is one short sentence, and says it is a local addition that needs review', () => {
    for (const f of BANK_FLOORS) {
      expect(f.question.endsWith('?'), f.sign).toBe(true); expect((f.question.match(/\?/g) ?? []).length, f.sign).toBe(1);
      expect(f.question.length, f.sign).toBeLessThanOrEqual(220); expect(f.label.length, f.sign).toBeLessThanOrEqual(120); expect(f.source).toMatch(/needs clinical review/);
      expect([1, 2, 3, 4]).toContain(f.tier); expect(['any', 'child', 'child_under_5', 'adult', 'pregnant']).toContain(f.population);
    }
  });
  it('no new question or label trips the diagnosis and treatment guard', () => {
    for (const f of BANK_FLOORS) for (const t of [f.label, f.question]) expect(checkNonDiagnostic(t).allowed, `${f.sign}: ${t}`).toBe(true);
  });
  it('never names a disease in a new question', () => {
    const diseases = /\b(dengue|malaria|typhoid|tuberculosis|pneumonia|appendicitis|meningitis|sepsis|stroke|cholera|eclampsia)\b/i;
    for (const f of BANK_FLOORS) expect(diseases.test(`${f.label} ${f.question}`), f.sign).toBe(false);
  });
  it('every question belongs to a body system with words that bring it up', () => {
    for (const f of all) expect(metaOf(f.sign), `${f.sign} has no system`).toBeDefined();
    const systems = new Set(all.map(f => systemOf(f.sign)));
    for (const s of Object.keys(SYSTEM_CUES) as System[]) {
      expect(systems.has(s), `${s} has no questions`).toBe(true);
      expect(all.filter(f => systemOf(f.sign) === s).length, s).toBeGreaterThanOrEqual(2);
    }
  });
  it('the helper tables only name real questions', () => {
    for (const list of Object.values(FIRST_ASK)) for (const s of list ?? []) expect(signs.has(s), s).toBe(true);
    for (const s of [...Object.keys(AGE_LIMITS), ...Object.keys(EXCLUDED_BY)]) expect(signs.has(s), s).toBe(true);
    for (const [s, lim] of Object.entries(AGE_LIMITS)) { expect(lim.min != null || lim.max != null, s).toBe(true); }
    for (const [sys, list] of Object.entries(FIRST_ASK)) for (const s of list ?? []) expect(systemOf(s), `${s} listed under ${sys}`).toBe(sys);
  });
  it('urgent new questions raise the priority and the rest do not lower it', () => {
    const base = { ageYears: 34, pregnant: false, vitals: { temperature_c: 36.8 }, signs: {} } as never;
    for (const f of BANK_FLOORS.filter(x => x.population === 'any')) {
      const d = triage({ ...(base as object), signs: { [f.sign]: true } } as never, { ...RULESET_EXPANDED, status: 'approved' });
      expect(d.tier, f.sign).toBeLessThanOrEqual(f.tier);
    }
  });
  it('has a stable fingerprint, so a stored copy can be checked', () => {
    expect(hashRuleSet(RULESET_EXPANDED)).toBe(hashRuleSet({ ...RULESET_EXPANDED })); expect(hashRuleSet(RULESET_EXPANDED)).not.toBe(hashRuleSet(RULESET_PROPOSED));
    expect(RULESET_EXPANDED.version).toBe('0.3.0'); expect(RULESET_EXPANDED.provenance).toMatch(/not been reviewed by a clinician/);
  });
});
