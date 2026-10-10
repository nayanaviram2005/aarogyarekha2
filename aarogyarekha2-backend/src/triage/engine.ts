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
export const hashRuleSet = (r: RuleSet) => { const { status: _s, provenance: _p, integrityHash: _h, ...behaviour } = r as RuleSet & { integrityHash?: string }; return sha256(canonicalJson(behaviour)); };

const LAYER_ORDER: DecisionLogEntry['layer'][] = ['floor', 'pregnancy_bp', 'news2', 'paed_vitals', 'external', 'insufficient_data', 'default'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function bandScore(bands: ScoreBand[], value: number): number {
  for (const b of bands) if (b.upTo === undefined || value <= b.upTo) return b.score;
  return bands[bands.length - 1]!.score;
}

function inPopulation(pop: Population, i: TriageInput, rs: RuleSet): boolean | 'unknown' {
  switch (pop) {
    case 'any': return true;
    case 'child': return i.ageYears == null ? 'unknown' : i.ageYears < rs.news2.minAgeYears;
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

  for (const f of rs.floors) {
    const pop = inPopulation(f.population, input, rs);
    if (pop === false) continue;
    const v = input.signs[f.sign];
    if (v === true) {
      log.push({ layer: 'floor', ruleId: f.id, tier: f.tier, detail: f.label, source: f.source, why: `Marked Yes for: "${f.question}"` });
      signals.push({ signal_code: `red_flag.${code(f.id)}`, kind: 'red_flag', source: 'rule', weight: null, display_text: f.label, evidence: { rule: f.id, sign: f.sign, source: f.source } });
    } else if (v == null && pop === true) {
      unassessed.push({ floor: f });
    }
  }

  const n = rs.news2;
  const news2Applicable = (input.ageYears != null ? input.ageYears >= n.minAgeYears : n.applyWhenAgeUnknown === true) && input.pregnant !== true;
  const knownParams: string[] = []; const missingParams: string[] = [];
  let score = 0; let anyRed = false;
  const parts: string[] = [];
  const v = input.vitals;
  const scoreParam = (name: keyof typeof n.bands, value: number | null | undefined, label: string, unit: string) => {
    if (!isNum(value)) { missingParams.push(name); return; }
    const s = bandScore(n.bands[name], value);
    knownParams.push(name); score += s; if (s >= n.tierMap.singleRedScore) anyRed = true;
    if (s > 0) parts.push(`${label} ${value}${unit}: ${s} point${s === 1 ? '' : 's'}`);
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
        parts.push(`Level of consciousness ${input.consciousness}: ${n.consciousnessNotAlert} points`);
        signals.push({ signal_code: 'vital.consciousness', kind: 'abnormal_vital', source: 'rule', weight: n.consciousnessNotAlert, display_text: `Level of consciousness recorded as ${input.consciousness} (early-warning points: ${n.consciousnessNotAlert})`, evidence: { param: 'consciousness', value: input.consciousness, points: n.consciousnessNotAlert, source: n.source } });
      }
    }
    if (input.onSupplementalOxygen == null) missingParams.push('oxygen');
    else { knownParams.push('oxygen'); if (input.onSupplementalOxygen) { score += n.supplementalOxygen; parts.push(`On extra oxygen: ${n.supplementalOxygen} points`); signals.push({ signal_code: 'vital.supplemental_oxygen', kind: 'abnormal_vital', source: 'rule', weight: n.supplementalOxygen, display_text: `On supplemental oxygen (early-warning points: ${n.supplementalOxygen})`, evidence: { param: 'oxygen', points: n.supplementalOxygen, source: n.source } }); } }
    if (knownParams.length > 0) {
      const tier = news2Tier(rs, score, anyRed);
      log.push({ layer: 'news2', ruleId: 'NEWS2', tier, detail: `Early-warning score ${score} from ${knownParams.length} of 7 parameters${anyRed ? ', one parameter in the highest band' : ''}`, source: n.source.split('. ')[0],
        why: `${parts.length ? parts.join('; ') : 'Every recorded measurement is in the normal range'}. Total ${score} from ${knownParams.length} of 7 measurements.` });
    }
  }

  const pv = rs.paediatricVitals;
  if (pv && input.ageYears != null && input.ageYears < n.minAgeYears) {
    const age = input.ageYears;
    const band = pv.bands.find(b => b.upToYears === undefined || age <= b.upToYears) ?? pv.bands[pv.bands.length - 1]!;
    const hits: string[] = [];
    let paedTier: Tier = pv.dangerTier;
    const flag = (param: string, text: string, value: number, limit: number) => {
      hits.push(text);
      signals.push({ signal_code: `vital.paed_${param}`, kind: 'abnormal_vital', source: 'rule', weight: null, display_text: text, evidence: { param, value, limit, source: pv.source } });
    };
    if (isNum(v.pulse_bpm) && v.pulse_bpm > band.pulseAbove) flag('pulse_bpm', `Pulse ${v.pulse_bpm} per minute is above ${band.pulseAbove} for this age`, v.pulse_bpm, band.pulseAbove);
    if (isNum(v.resp_rate_pm) && v.resp_rate_pm > band.respAbove) flag('resp_rate_pm', `Breathing rate ${v.resp_rate_pm} per minute is above ${band.respAbove} for this age`, v.resp_rate_pm, band.respAbove);
    if (isNum(v.spo2_pct) && v.spo2_pct < pv.spo2Below) {
      flag('spo2_pct', `Oxygen saturation ${v.spo2_pct}% is below ${pv.spo2Below}%`, v.spo2_pct, pv.spo2Below);
      if (v.spo2_pct < pv.spo2ImmediateBelow) paedTier = Math.min(paedTier, pv.immediateTier) as Tier;
    }
    if (hits.length > 0) {
      const ageText = age < 2 ? `${Math.round(age * 12)} months old` : `${Math.floor(age)} years old`;
      log.push({ layer: 'paed_vitals', ruleId: pv.id, tier: paedTier, detail: hits.join('; '), source: pv.source, why: `This patient is ${ageText}. ${hits.join('; ')}.` });
    }
  }

  const pb = rs.pregnancyHypertension;
  if (input.pregnant === true) {
    const hi = (isNum(v.bp_systolic_mmhg) && v.bp_systolic_mmhg >= pb.sbp) || (isNum(v.bp_diastolic_mmhg) && v.bp_diastolic_mmhg >= pb.dbp);
    if (hi) {
      log.push({ layer: 'pregnancy_bp', ruleId: pb.id, tier: pb.tier, detail: pb.label, source: pb.source, why: `Recorded blood pressure ${v.bp_systolic_mmhg ?? 'not taken'}/${v.bp_diastolic_mmhg ?? 'not taken'} mmHg. The limit in pregnancy is ${pb.sbp}/${pb.dbp}.` });
      signals.push({ signal_code: `red_flag.${code(pb.id)}`, kind: 'red_flag', source: 'rule', weight: null, display_text: pb.label, evidence: { rule: pb.id, systolic: v.bp_systolic_mmhg ?? null, diastolic: v.bp_diastolic_mmhg ?? null, source: pb.source } });
    }
  }

  for (const h of input.externalHints ?? []) {
    if (!(Number.isInteger(h.tier) && h.tier >= 1 && h.tier <= 4)) continue;
    const extra = h.code === 'ai_second_opinion';
    const text = extra ? 'Extended check of the case details' : `External suggestion: ${h.code}`;
    log.push({ layer: 'external', ruleId: `EXT-${code(h.code)}`, tier: h.tier, detail: text, source: 'Triage engine extended check',
      why: 'The extended check read the words, measurements and answers recorded for this case and suggested this level. It can only raise the priority, never lower it.' });
    signals.push({ signal_code: `external.${code(h.code)}`, kind: 'external_hint', source: h.source, weight: null, display_text: text, evidence: { code: h.code, tier: h.tier } });
  }

  const anyVital = Object.values(v).some(isNum) || input.consciousness != null || input.onSupplementalOxygen != null;
  const anySignAnswered = Object.values(input.signs).some(x => typeof x === 'boolean');
  const insufficientData = !anyVital && !anySignAnswered && (input.externalHints ?? []).length === 0;
  if (insufficientData) {
    log.push({ layer: 'insufficient_data', ruleId: 'INSUFFICIENT', tier: rs.insufficientDataTier, detail: 'No vitals or danger-sign answers recorded yet', source: 'Built-in rule', why: 'Nothing has been measured or answered yet, so there is nothing to check. The level stays provisional until something is recorded.' });
    signals.push({ signal_code: 'missing.nothing_assessed', kind: 'missing_information', source: 'missing_data', weight: null, display_text: 'No vitals or danger-sign answers recorded yet', evidence: {} });
  }

  log.push({ layer: 'default', ruleId: 'DEFAULT', tier: 4, detail: 'No urgency signal found in the information recorded so far', source: 'Built-in rule', why: 'None of the checks found an urgent sign in what has been recorded so far. More answers or measurements can change this.' });

  const sorted = [...log].sort((a, b) => a.tier - b.tier || LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
  const winning = sorted[0]!;
  const tier = winning.tier;

  const capped = (pt: number): Tier | null => (pt < tier ? (Math.max(pt, tier - rs.potentialTierCap, 1) as Tier) : null);
  const relevant = input.relevantSigns ? new Set(input.relevantSigns) : null;
  for (const { floor } of unassessed) {
    if (relevant && !relevant.has(floor.sign)) continue;
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

  const best = missing.reduce<number>((acc, m) => (m.potentialTier != null && m.potentialTier < acc ? m.potentialTier : acc), 99);
  let combined = 99;
  if (news2Applicable && missingParams.length > 0) {
    const worst = score + missingParams.reduce((s, p) => s + n.maxPerParam[p as keyof typeof n.maxPerParam], 0);
    const red = anyRed || missingParams.some(p => n.maxPerParam[p as keyof typeof n.maxPerParam] >= n.tierMap.singleRedScore);
    combined = news2Tier(rs, worst, red);
  }
  const rawPotential = Math.min(best, combined);
  const potentialTier = capped(rawPotential);

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
