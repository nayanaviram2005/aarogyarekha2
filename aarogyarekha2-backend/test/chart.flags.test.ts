import { describe, expect, it } from 'vitest';
import { triage } from '../src/triage/engine.js';
import { CHART_FLAGS } from '../src/triage/ruleset.chart.js';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED as PROP } from '../src/triage/ruleset.proposed.js';
import type { FloorRule, TriageInput } from '../src/triage/types.js';

const who = (pop: FloorRule['population']): Pick<TriageInput, 'ageYears' | 'pregnant'> => pop === 'child_under_5' ? { ageYears: 2, pregnant: false } : pop === 'pregnant' ? { ageYears: 28, pregnant: true } : { ageYears: 30, pregnant: false };
const run = (f: FloorRule, p: Pick<TriageInput, 'ageYears' | 'pregnant'>, rs = PROP) => triage({ ...p, vitals: {}, signs: { [f.sign]: true } }, rs);

describe('flags from the GP triage chart (proposed v0.2.1)', () => {
  it('there are 50, with unique ids and signs, each with a question, a source and a valid tier', () => {
    expect(CHART_FLAGS).toHaveLength(50); expect(new Set(CHART_FLAGS.map(f => f.id)).size).toBe(50); expect(new Set(CHART_FLAGS.map(f => f.sign)).size).toBe(50);
    for (const f of CHART_FLAGS) { expect([1, 2, 3]).toContain(f.tier); expect(f.question.endsWith('?')).toBe(true); expect(f.source).toMatch(/needs clinical review/); }
  });
  it.each(CHART_FLAGS.map(f => [f.id, f] as const))('%s gives its tier for the people it applies to', (_id, f) => {
    const d = run(f, who(f.population)); expect(d.tier).toBe(f.tier); expect(d.winning.ruleId).toBe(f.id);
  });
  it('an "any age" flag also works for a child and a pregnant patient', () => {
    for (const f of CHART_FLAGS.filter(x => x.population === 'any')) for (const p of [who('child_under_5'), who('pregnant')]) expect(run(f, p).tier, f.id).toBeLessThanOrEqual(f.tier);
  });
  it('a flag for one group does not fire for the others', () => {
    for (const f of CHART_FLAGS.filter(x => x.population === 'child_under_5')) expect(run(f, who('any')).tier, f.id).toBe(4);
    for (const f of CHART_FLAGS.filter(x => x.population === 'pregnant')) expect(run(f, { ageYears: 30, pregnant: false }).tier, f.id).toBe(4);
  });
  it('an answer of "no" or "not asked" never raises anything', () => {
    for (const f of CHART_FLAGS) { const d = triage({ ...who(f.population), vitals: { temperature_c: 36.8 }, signs: { [f.sign]: false } }, PROP); expect(d.tier, f.id).toBe(4); }
  });
  it('the live v0.1.1 rules are untouched, so none of these sign names exist there', () => {
    const live = new Set(RS.floors.map(f => f.sign)); for (const f of CHART_FLAGS) expect(live.has(f.sign), f.sign).toBe(false);
  });
  it('the combined list stays escalate-only: two flags give the more urgent', () => {
    const a = CHART_FLAGS.find(f => f.tier === 3 && f.population === 'any')!, b = CHART_FLAGS.find(f => f.tier === 1)!;
    expect(triage({ ageYears: 30, pregnant: false, vitals: {}, signs: { [a.sign]: true, [b.sign]: true } }, PROP).tier).toBe(1);
  });
});
