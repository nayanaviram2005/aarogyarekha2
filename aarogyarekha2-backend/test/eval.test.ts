import { describe, expect, it } from 'vitest';
import { CASES } from '../src/eval/cases.js';
import { renderReport } from '../src/eval/report.js';
import { checkInvariants, evaluate, randomInput } from '../src/eval/run.js';
import { triage } from '../src/triage/engine.js';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED as PROP } from '../src/triage/ruleset.proposed.js';

const SIGN_CODES = new Set([...RS.floors, ...PROP.floors].map(f => f.sign));

describe('evaluation set', () => {
  it('has unique ids and every group is present', () => {
    expect(new Set(CASES.map(c => c.id)).size).toBe(CASES.length);
    expect(new Set(CASES.map(c => c.group))).toEqual(new Set(['adult_news2', 'adult_danger_signs', 'child', 'pregnancy', 'missing_data', 'india_scenarios']));
  });
  it('every sign a case sets is a real rule sign, so a typo cannot make a case test nothing', () => {
    for (const c of CASES) for (const k of Object.keys(c.input.signs)) expect(SIGN_CODES.has(k), `${c.id}: ${k}`).toBe(true);
  });
  it('contains no names, phone numbers or other personal details', () => {
    expect(JSON.stringify(CASES)).not.toMatch(/\b\d{10}\b|@|Aadhaar/i);
  });
  it('every known gap has a stated reason', () => {
    for (const c of CASES.filter(x => x.gap)) expect(c.source.length, c.id).toBeGreaterThan(30);
  });
});

describe('evaluate', () => {
  const s = evaluate(RS);
  it('NEVER under-triages a case outside the known gaps (the dangerous direction)', () => {
    expect(s.results.filter(r => !r.gapNote && r.verdict === 'under').map(r => r.case.id)).toEqual([]);
  });
  it('has no over-triage or disagreement outside the known gaps either', () => {
    expect(s.results.filter(r => !r.gapNote && r.verdict !== 'match').map(r => r.case.id)).toEqual([]);
  });
  it('the known gaps are exactly the ones we documented (adding or removing one is a deliberate act)', () => {
    expect(CASES.filter(c => c.gap).map(c => c.id).sort()).toEqual(['C18', 'D06', 'D07', 'D08', 'M03', 'N01', 'N02', 'N03', 'N04', 'P11', 'P12', 'P13', 'S03']);
  });
  it('every known gap is still a gap: the engine really is less urgent than the label (if one gets fixed, remove it from the list)', () => {
    expect(s.results.filter(r => r.gapNote && r.verdict === 'match').map(r => r.case.id)).toEqual([]);
  });
  it('summarises counts that add up', () => {
    expect(s.match + s.under + s.over).toBe(s.scored); expect(s.scored + s.gaps).toBe(s.total);
    expect(Object.values(s.confusion).reduce((a, b) => a + b, 0)).toBe(s.total);
    expect(Object.values(s.byGroup).reduce((a, g) => a + g.n, 0)).toBe(s.scored);
  });
  it('the potential-tier label on the missing-sign case is honoured', () => {
    const m = CASES.find(c => c.id === 'M02')!; expect(s.results.find(r => r.case.id === 'M02')!.potentialTier).toBe(m.potentialTier);
  });
});

describe('invariants on random inputs', () => {
  it('hold for 3000 random cases', () => { expect(checkInvariants(RS, 3000).failures).toEqual([]); }, 60_000);
  it('the checks can actually fail: an engine that lowers urgency when a danger sign is added is caught', () => {
    const bad = (i: Parameters<typeof triage>[0], rs: typeof RS) => { const d = triage(i, rs); const n = Object.values(i.signs).filter(Boolean).length; return n > 0 ? { ...d, tier: 4 as const, urgencyCode: 'green' as const } : d; };
    const r = checkInvariants(RS, 300, 1, bad);
    expect(r.failures.length).toBeGreaterThan(0); expect(r.failures.some(f => /less urgent|colour|agree/.test(f.invariant))).toBe(true);
  });
  it('an engine that is not deterministic is caught', () => {
    let k = 0; const flaky = (i: Parameters<typeof triage>[0], rs: typeof RS) => ({ ...triage(i, rs), inputFingerprint: String(k++) });
    expect(checkInvariants(RS, 20, 1, flaky).failures.some(f => f.invariant === 'same input, same answer')).toBe(true);
  });
  it('random inputs are deterministic for a seed', () => {
    const r1 = (() => { let s = 5; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; })(); const r2 = (() => { let s = 5; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; })();
    expect(randomInput(r1)).toEqual(randomInput(r2));
  });
});

describe('renderReport', () => {
  const md = renderReport(evaluate(RS), checkInvariants(RS, 100), [{ label: 'Engine', n: 1000, ms: 5 }], { name: 'n', version: '1', status: 'draft' }, new Date('2026-10-07T00:00:00Z'));
  it('says the labels are not clinician labels and that the rules are not validated', () => {
    expect(md).toMatch(/not a clinician/); expect(md).toMatch(/invented/); expect(md).toMatch(/does \*\*not\*\* show the rules are clinically right/);
  });
  it('lists the gaps and the properties and the speed table', () => {
    expect(md).toContain('## Known gaps for clinical review'); expect(md).toContain('D07'); expect(md).toContain('No violations'); expect(md).toContain('5 ms');
  });
});

describe('proposed v0.2.0', () => {
  const ps = evaluate(PROP);
  it('is a different version with a different hash, and is still a draft', () => { expect(PROP.version).not.toBe(RS.version); expect(PROP.status).toBe('draft'); expect(PROP.provenance).toMatch(/Not approved/); });
  it('only ADDS: every v0.1.1 sign is still there with the same tier and population', () => {
    for (const f of RS.floors) expect(PROP.floors.find(x => x.id === f.id), f.id).toEqual(f);
    expect(PROP.floors.length).toBeGreaterThan(RS.floors.length); expect(new Set(PROP.floors.map(f => f.id)).size).toBe(PROP.floors.length); expect(new Set(PROP.floors.map(f => f.sign)).size).toBe(PROP.floors.length);
  });
  it('never under-triages a scored case, and closes exactly the gaps it says it closes', () => {
    expect(ps.results.filter(r => !r.gapNote && r.verdict !== 'match').map(r => r.case.id)).toEqual([]);
    expect(ps.results.filter(r => r.gapNote).map(r => r.case.id).sort()).toEqual(['C18', 'P11', 'P12', 'P13', 'S03']);
  });
  it('is never LESS urgent than v0.1.1 on any case (it only adds)', () => {
    const base = evaluate(RS); for (const r of ps.results) expect(r.tier, r.case.id).toBeLessThanOrEqual(base.results.find(x => x.case.id === r.case.id)!.tier);
  });
  it('keeps every property on random inputs', () => { expect(checkInvariants(PROP, 2000).failures).toEqual([]); }, 60_000);
  it('an unknown age no longer hides abnormal vitals, but a known pregnancy still does not use the adult score', () => {
    const d = triage({ ageYears: null, pregnant: null, vitals: { pulse_bpm: 135 }, signs: {} }, PROP); expect(d.tier).toBe(2); expect(d.news2.applicable).toBe(true);
    expect(triage({ ageYears: null, pregnant: true, vitals: { pulse_bpm: 135 }, signs: {} }, PROP).news2.applicable).toBe(false);
    expect(triage({ ageYears: null, pregnant: null, vitals: { pulse_bpm: 135 }, signs: {} }, RS).tier).toBe(4);          // v0.1.1 unchanged
  });
  it('the report lists what the proposal changes', () => {
    const md = renderReport(evaluate(RS), checkInvariants(RS, 50), [], { name: 'n', version: RS.version, status: 'draft' }, new Date('2026-10-07'), { version: PROP.version, summary: ps, invariants: checkInvariants(PROP, 50) });
    expect(md).toContain('Proposed v0.2.0'); expect(md).toMatch(/Gaps the proposal closes \(8\)/); expect(md).toMatch(/Not in use and not approved/);
  });
});
