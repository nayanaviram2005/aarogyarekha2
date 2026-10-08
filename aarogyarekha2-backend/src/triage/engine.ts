// AarogyaRekha triage engine. Layered, deterministic, explainable, ESCALATE-ONLY.
//
//   1. Danger-sign floors (ETAT / IMNCI / NHM)      -> tier
//   2. Physiological score (NEWS2, adults only)      -> tier
//   3. Pregnancy severe-range blood pressure         -> tier
//   4. External/model hints                          -> can only RAISE urgency
//   final tier = the MOST URGENT of all layers (smallest number). Nothing can lower it.
//
// Missing data never reads as "normal": unassessed signs and unrecorded vitals produce a `potentialTier` and
// follow-up items instead of silently lowering priority. If nothing at all was assessed, the rule set's
// insufficientDataTier applies rather than the lowest tier.
//
// Output is a review-priority label for a qualified person. It is not a diagnosis and not advice on treatment.
import { createHash } from 'node:crypto';
import type {
  DecisionLogEntry, FloorRule, Population, RuleSet, ScoreBand, Signal, Tier, TriageDecision, TriageInput,
} from './types.js';
import { TIER_TO_URGENCY } from './types.js';

export const ENGINE_VERSION = 'aarogyarekha-engine/0.1.0';

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : 1).map(([k, x]) => [k, sortKeys(x)]))
  : v;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const canonicalJson = (v: unknown) => JSON.stringify(sortKeys(v));
/** Integrity hash of a rule set. Stamp it on every decision so a silent edit is detectable. */
/** Covers behaviour only (thresholds, signs, tier maps). `status` and `provenance` are excluded so approving a set does not change its hash. */
export const hashRuleSet = (r: RuleSet) => { const { status: _s, provenance: _p, integrityHash: _h, ...behaviour } = r as RuleSet & { integrityHash?: string }; return sha256(canonicalJson(behaviour)); };

const LAYER_ORDER: DecisionLogEntry['layer'][] = ['floor', 'pregnancy_bp', 'news2', 'external', 'insufficient_data', 'default'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function bandScore(bands: ScoreBand[], value: number): number {
  for (const b of bands) if (b.upTo === undefined || value <= b.upTo) return b.score;
  return bands[bands.length - 1]!.score;
}

/** true / false / 'unknown' (age or pregnancy status not known). */
function inPopulation(pop: Population, i: TriageInput, rs: RuleSet): boolean | 'unknown' {
  switch (pop) {
    case 'any': return true;
    case 'child_under_5': return i.ageYears == null ? 'unknown' : i.ageYears < 5;
    case 'adult': return i.ageYears == null ? 'unknown' : i.ageYears >= rs.news2.minAgeYears && i.pregnant !== true;
    case 'pregnant': return i.pregnant == null ? 'unknown' : i.pregnant;
  }
}

const code = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function news2Tier(rs: RuleSet, aggregate: number, anySingleRed: boolean): Tier {
  const m = rs.news2.tierMap;
  if (aggregate >= m.aggregateHighMin) return m.aggregateHighTier;
  if (aggregate >= m.aggregateMediumMin || anySingleRed) return Math.min(m.aggregateMediumTier, m.singleRedTier) as Tier;
  if (aggregate >= m.lowMin) return m.lowTier;
  return m.zeroTier;
}

export function triage(input: TriageInput, rs: RuleSet): TriageDecision {
  const log: DecisionLogEntry[] = [];
  const signals: Signal[] = [];
  const unassessed: { floor: FloorRule }[] = [];
  const missing: TriageDecision['missing'] = [];
  const unknownCtx: string[] = [];

  if (input.ageYears == null) unknownCtx.push('age');
  if (input.pregnant == null) unknownCtx.push('pregnancy_status');

  // ---------------------------------------------------------------- 1. danger-sign floors
  for (const f of rs.floors) {
    const pop = inPopulation(f.population, input, rs);
    if (pop === false) continue;
    const v = input.signs[f.sign];
    if (v === true) {
      log.push({ layer: 'floor', ruleId: f.id, tier: f.tier, detail: f.label });
      signals.push({ signal_code: `red_flag.${code(f.id)}`, kind: 'red_flag', source: 'rule', weight: null, display_text: f.label, evidence: { rule: f.id, sign: f.sign, source: f.source } });
    } else if (v == null && pop === true) {
      unassessed.push({ floor: f });          // asked nothing yet: absence of an answer is NOT "no"
    }
  }

  // ---------------------------------------------------------------- 2. NEWS2 (adults)
  const n = rs.news2;
  const news2Applicable = (input.ageYears != null ? input.ageYears >= n.minAgeYears : n.applyWhenAgeUnknown === true) && input.pregnant !== true;
  const knownParams: string[] = []; const missingParams: string[] = [];
  let score = 0; let anyRed = false;
  const v = input.vitals;
  const scoreParam = (name: keyof typeof n.bands, value: number | null | undefined, label: string, unit: string) => {
    if (!isNum(value)) { missingParams.push(name); return; }
    const s = bandScore(n.bands[name], value);
    knownParams.push(name); score += s; if (s >= n.tierMap.singleRedScore) anyRed = true;
    if (s > 0) signals.push({ signal_code: `vital.${name}`, kind: 'abnormal_vital', source: 'rule', weight: s, display_text: `${label} ${value}${unit} (early-warning points: ${s})`, evidence: { param: name, value, points: s, source: n.source } });
  };
  if (news2Applicable) {
    scoreParam('resp_rate_pm', v.resp_rate_pm, 'Respiratory rate', ' per minute');
    scoreParam('spo2_pct', v.spo2_pct, 'Oxygen saturation', '%');
    scoreParam('bp_systolic_mmhg', v.bp_systolic_mmhg, 'Systolic blood pressure', ' mmHg');
    scoreParam('pulse_bpm', v.pulse_bpm, 'Pulse', ' per minute');
    scoreParam('temperature_c', v.temperature_c, 'Temperature', ' °C');
    if (input.consciousness == null) missingParams.push('consciousness');
    else {
      knownParams.push('consciousness');
      if (input.consciousness !== 'alert') {
        score += n.consciousnessNotAlert; anyRed = anyRed || n.consciousnessNotAlert >= n.tierMap.singleRedScore;
        signals.push({ signal_code: 'vital.consciousness', kind: 'abnormal_vital', source: 'rule', weight: n.consciousnessNotAlert, display_text: `Level of consciousness recorded as ${input.consciousness} (early-warning points: ${n.consciousnessNotAlert})`, evidence: { param: 'consciousness', value: input.consciousness, points: n.consciousnessNotAlert, source: n.source } });
      }
    }
    if (input.onSupplementalOxygen == null) missingParams.push('oxygen');
    else { knownParams.push('oxygen'); if (input.onSupplementalOxygen) { score += n.supplementalOxygen; signals.push({ signal_code: 'vital.supplemental_oxygen', kind: 'abnormal_vital', source: 'rule', weight: n.supplementalOxygen, display_text: `On supplemental oxygen (early-warning points: ${n.supplementalOxygen})`, evidence: { param: 'oxygen', points: n.supplementalOxygen, source: n.source } }); } }
    if (knownParams.length > 0) {
      const tier = news2Tier(rs, score, anyRed);
      log.push({ layer: 'news2', ruleId: 'NEWS2', tier, detail: `Early-warning score ${score} from ${knownParams.length} of 7 parameters${anyRed ? ', one parameter in the highest band' : ''}` });
    }
  }

  // ---------------------------------------------------------------- 3. pregnancy severe-range BP
  const pb = rs.pregnancyHypertension;
  if (input.pregnant === true) {
    const hi = (isNum(v.bp_systolic_mmhg) && v.bp_systolic_mmhg >= pb.sbp) || (isNum(v.bp_diastolic_mmhg) && v.bp_diastolic_mmhg >= pb.dbp);
    if (hi) {
      log.push({ layer: 'pregnancy_bp', ruleId: pb.id, tier: pb.tier, detail: pb.label });
      signals.push({ signal_code: `red_flag.${code(pb.id)}`, kind: 'red_flag', source: 'rule', weight: null, display_text: pb.label, evidence: { rule: pb.id, systolic: v.bp_systolic_mmhg ?? null, diastolic: v.bp_diastolic_mmhg ?? null, source: pb.source } });
    }
  }

  // ---------------------------------------------------------------- 4. external hints: escalate-only
  for (const h of input.externalHints ?? []) {
    if (!(Number.isInteger(h.tier) && h.tier >= 1 && h.tier <= 4)) continue;          // a hint with a tier outside 1 to 4 is malformed: ignore it, never let it set the result
    log.push({ layer: 'external', ruleId: `EXT-${code(h.code)}`, tier: h.tier, detail: `External suggestion: ${h.code}` });
    signals.push({ signal_code: `external.${code(h.code)}`, kind: 'external_hint', source: h.source, weight: null, display_text: `External suggestion: ${h.code}`, evidence: { code: h.code, tier: h.tier } });
  }

  // ---------------------------------------------------------------- nothing assessed at all -> never the lowest tier
  const anyVital = Object.values(v).some(isNum) || input.consciousness != null || input.onSupplementalOxygen != null;
  const anySignAnswered = Object.values(input.signs).some(x => typeof x === 'boolean');
  const insufficientData = !anyVital && !anySignAnswered && (input.externalHints ?? []).length === 0;
  if (insufficientData) {
    log.push({ layer: 'insufficient_data', ruleId: 'INSUFFICIENT', tier: rs.insufficientDataTier, detail: 'No vitals or danger-sign answers recorded yet' });
    signals.push({ signal_code: 'missing.nothing_assessed', kind: 'missing_information', source: 'missing_data', weight: null, display_text: 'No vitals or danger-sign answers recorded yet', evidence: {} });
  }

  log.push({ layer: 'default', ruleId: 'DEFAULT', tier: 4, detail: 'No urgency signal found in the information recorded so far' });

  // ---------------------------------------------------------------- combine: most urgent wins (ties: layer order)
  const sorted = [...log].sort((a, b) => a.tier - b.tier || LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
  const winning = sorted[0]!;
  const tier = winning.tier;

  // ---------------------------------------------------------------- missing information and the potential tier
  // A potential tier is never more than `potentialTierCap` tiers more urgent than the confirmed tier.
  const capped = (pt: number): Tier | null => (pt < tier ? (Math.max(pt, tier - rs.potentialTierCap, 1) as Tier) : null);
  const relevant = input.relevantSigns ? new Set(input.relevantSigns) : null;
  for (const { floor } of unassessed) {
    if (relevant && !relevant.has(floor.sign)) continue;                 // not worth asking for this patient (see relevance.ts)
    const pt = capped(floor.tier);
    missing.push({ code: `sign.${floor.sign}`, label: `Not yet assessed: ${floor.label}`, potentialTier: pt });
  }
  if (news2Applicable) {
    const base = score; const baseRed = anyRed;
    for (const p of missingParams) {
      const key = p === 'consciousness' ? 'consciousness' : p === 'oxygen' ? 'oxygen' : p as keyof typeof n.maxPerParam;
      const mx = n.maxPerParam[key];
      const pt = news2Tier(rs, base + mx, baseRed || mx >= n.tierMap.singleRedScore);
      missing.push({ code: `vital.${p}`, label: `Not yet recorded: ${p.replace(/_/g, ' ')}`, potentialTier: capped(pt) });
    }
  }
  if (input.pregnant === true && !isNum(v.bp_systolic_mmhg) && !isNum(v.bp_diastolic_mmhg))
    missing.push({ code: 'vital.bp_pregnancy', label: 'Not yet recorded: blood pressure (pregnancy)', potentialTier: capped(pb.tier) });
  for (const k of unknownCtx) missing.push({ code: `context.${k}`, label: k === 'age' ? 'Age not recorded' : 'Pregnancy status not recorded', potentialTier: null });
  for (const m of missing) if (m.code.startsWith('context.'))
    signals.push({ signal_code: `missing.${code(m.code)}`, kind: 'missing_information', source: 'missing_data', weight: null, display_text: m.label, evidence: {} });

  // Potential tier: how urgent it COULD be if missing answers came back worst-case, bounded by the cap.
  const best = missing.reduce<number>((acc, m) => (m.potentialTier != null && m.potentialTier < acc ? m.potentialTier : acc), 99);
  // Combined worst case for NEWS2 (all missing at once) is also bounded by the same cap.
  let combined = 99;
  if (news2Applicable && missingParams.length > 0) {
    const worst = score + missingParams.reduce((s, p) => s + n.maxPerParam[p as keyof typeof n.maxPerParam], 0);
    const red = anyRed || missingParams.some(p => n.maxPerParam[p as keyof typeof n.maxPerParam] >= n.tierMap.singleRedScore);
    combined = news2Tier(rs, worst, red);
  }
  const rawPotential = Math.min(best, combined);
  const potentialTier = capped(rawPotential);

  // ---------------------------------------------------------------- context
  const age = input.ageYears;
  const vulnerable = (age != null && (age < rs.vulnerable.ageUnder || age >= rs.vulnerable.ageOver)) || input.pregnant === true;
  if (vulnerable) signals.push({ signal_code: 'context.vulnerable', kind: 'risk_context', source: 'rule', weight: null, display_text: input.pregnant === true ? 'Pregnant' : age != null && age < rs.vulnerable.ageUnder ? 'Young child' : 'Older adult', evidence: { ageYears: age, pregnant: input.pregnant } });

  return {
    tier, urgencyCode: TIER_TO_URGENCY[tier], potentialTier,
    winning, log: sorted, signals,
    news2: { applicable: news2Applicable, score: news2Applicable && knownParams.length > 0 ? score : null, knownParams, missingParams },
    missing, vulnerable, insufficientData,
    engineVersion: ENGINE_VERSION,
    ruleSet: { name: rs.name, version: rs.version, status: rs.status, hash: hashRuleSet(rs) },
    inputFingerprint: sha256(canonicalJson(input)),
  };
}
