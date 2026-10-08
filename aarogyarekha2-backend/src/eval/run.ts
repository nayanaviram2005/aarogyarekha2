// Runs the evaluation cases through the real engine and summarises how it behaves. Pure: no I/O.
import { triage } from '../triage/engine.js';
import type { RuleSet, Tier, TriageDecision, TriageInput } from '../triage/types.js';
import { CASES, type CaseGroup, type EvalCase } from './cases.js';

export interface CaseResult { case: EvalCase; tier: Tier; potentialTier: Tier | null; winning: string; verdict: 'match' | 'under' | 'over'; gapNote: boolean }
export interface Summary {
  total: number; scored: number; gaps: number;
  match: number; under: number; over: number; withinOne: number;
  exactRate: number; underRate: number; overRate: number;
  confusion: Record<string, number>;                       // "expected->actual": n
  byGroup: Record<string, { n: number; match: number; under: number; over: number }>;
  results: CaseResult[];
}

/** Tiers are 1 (most urgent) to 4. "Under-triage" = the engine is LESS urgent than the label, which is the dangerous direction. */
export function evaluate(rs: RuleSet, cases: EvalCase[] = CASES): Summary {
  const results: CaseResult[] = cases.map(c => {
    const d = triage(c.input, rs);
    return { case: c, tier: d.tier, potentialTier: d.potentialTier, winning: `${d.winning.layer}:${d.winning.ruleId}`, verdict: d.tier === c.expected ? 'match' : d.tier > c.expected ? 'under' : 'over', gapNote: !!c.gap && c.fixedIn !== rs.version };
  });
  const scored = results.filter(r => !r.gapNote);
  const count = (rs2: CaseResult[], v: CaseResult['verdict']) => rs2.filter(r => r.verdict === v).length;
  const confusion: Record<string, number> = {};
  for (const r of results) { const k = `${r.case.expected}->${r.tier}`; confusion[k] = (confusion[k] ?? 0) + 1; }
  const byGroup: Summary['byGroup'] = {};
  for (const r of scored) { const g = (byGroup[r.case.group] ??= { n: 0, match: 0, under: 0, over: 0 }); g.n++; g[r.verdict]++; }
  const n = scored.length || 1;
  return {
    total: results.length, scored: scored.length, gaps: results.length - scored.length,
    match: count(scored, 'match'), under: count(scored, 'under'), over: count(scored, 'over'),
    withinOne: scored.filter(r => Math.abs(r.tier - r.case.expected) <= 1).length,
    exactRate: count(scored, 'match') / n, underRate: count(scored, 'under') / n, overRate: count(scored, 'over') / n,
    confusion, byGroup, results,
  };
}

// ------------------------------------------------------------------ invariants (properties the engine must keep for ANY input)
const SIGNS = ['airway_obstructed_or_not_breathing', 'severe_respiratory_distress', 'central_cyanosis', 'shock_signs', 'unconscious_or_convulsing_now', 'lethargic', 'convulsions_this_illness', 'vomits_everything', 'severe_pallor', 'severe_pain', 'convulsions_in_pregnancy', 'any_vaginal_bleeding', 'fever_in_pregnancy'];
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;

export function randomInput(r: () => number): TriageInput {
  const num = (lo: number, hi: number, p = 0.8) => (r() < p ? Math.round((lo + r() * (hi - lo)) * 10) / 10 : null);
  const signs: TriageInput['signs'] = {};
  for (const s of SIGNS) { const x = r(); if (x < 0.08) signs[s] = true; else if (x < 0.5) signs[s] = false; }
  return {
    ageYears: pick(r, [0.05, 0.5, 2, 4, 15, 30, 55, 80, null]), pregnant: pick(r, [true, false, false, null]),
    vitals: { temperature_c: num(34, 41), spo2_pct: num(80, 100), pulse_bpm: num(35, 170), resp_rate_pm: num(6, 40), bp_systolic_mmhg: num(70, 230), bp_diastolic_mmhg: num(40, 130) },
    consciousness: pick(r, ['alert', 'alert', 'alert', 'confusion', 'voice', 'pain', 'unresponsive', null] as const), onSupplementalOxygen: pick(r, [true, false, false, null]), signs,
  };
}

export interface InvariantReport { runs: number; failures: { invariant: string; example: TriageInput }[] }

/** Properties that must hold for every input: adding a danger sign or an outside hint never makes the result LESS urgent; the same input always gives the same answer; tier and urgency colour always agree. */
export function checkInvariants(rs: RuleSet, runs = 2000, seed = 20261007, engine: (i: TriageInput, rs: RuleSet) => TriageDecision = triage): InvariantReport {
  const triage = engine;                                   // lets a test hand in a deliberately broken engine to prove the checks can fail
  const r = rng(seed); const failures: InvariantReport['failures'] = [];
  const fail = (invariant: string, example: TriageInput) => { if (failures.length < 20) failures.push({ invariant, example }); };
  const COLOR = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green' } as const;
  for (let i = 0; i < runs; i++) {
    const input = randomInput(r); const base = triage(input, rs); const again: TriageDecision = triage(input, rs);
    if (again.tier !== base.tier || again.inputFingerprint !== base.inputFingerprint) fail('same input, same answer', input);
    if (COLOR[base.tier] !== base.urgencyCode) fail('tier and colour agree', input);
    const sign = pick(r, SIGNS); const worse = triage({ ...input, signs: { ...input.signs, [sign]: true } }, rs);
    if (worse.tier > base.tier) fail(`adding "${sign}" made it less urgent`, input);
    const hinted = triage({ ...input, externalHints: [{ code: 'x', tier: pick(r, [1, 2, 3, 4] as Tier[]), source: 'external_secondary' }] }, rs);
    if (hinted.tier > base.tier) fail('an outside hint made it less urgent', input);
    if (base.potentialTier !== null && base.potentialTier >= base.tier) fail('potential tier is not more urgent than the tier', input);
    if (base.potentialTier !== null && base.tier - base.potentialTier > 1) fail('potential tier more than one step above', input);
  }
  return { runs, failures };
}
