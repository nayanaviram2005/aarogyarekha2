import { AGE_LIMITS, EXCLUDED_BY, FIRST_ASK, metaOf, orderOf, SYSTEM_CUES, systemOf, type System } from './questionBank.js';
import type { FloorRule, RuleSet, TriageInput } from './types.js';

export const QUESTION_TARGET = 6;
export const QUESTION_MAX = 7;
export const QUESTION_BUDGET = QUESTION_TARGET;
export const SYSTEM_CAP = 3;
export const CANDIDATES_FOR_AI = 24;

export const SENSITIVE_SYSTEMS: ReadonlySet<System> = new Set<System>(['mental', 'poison', 'bites', 'burns']);

export const WORDS_REQUIRED: ReadonlySet<string> = new Set([
  'weapon_injury', 'object_stuck_in_body', 'object_stuck_in_eye', 'eye_injury', 'sexual_assault', 'chemical_in_eye', 'part_of_body_cut_off', 'near_drowning',
  'electric_shock_or_lightning', 'smoke_or_fire_exposure', 'major_trauma_or_burns', 'adult_major_trauma_or_burns', 'child_swallowed_battery_or_magnet',
]);

const DEFAULT_FILL: readonly string[] = ['shock_signs', 'fainting_or_sudden_collapse', 'severe_bleeding', 'chest_pain'];

export function askableFloors(input: TriageInput, rs: RuleSet): FloorRule[] {
  return rs.floors.filter(f => {
    if (input.signs[f.sign] != null) return false;
    switch (f.population) {
      case 'any': return true;
      case 'child': return input.ageYears == null || input.ageYears < rs.news2.minAgeYears;
      case 'child_under_5': return input.ageYears == null || input.ageYears < 5;
      case 'adult': return input.ageYears == null || (input.ageYears >= rs.news2.minAgeYears && input.pregnant !== true);
      case 'pregnant': return input.pregnant == null || input.pregnant === true;
    }
  });
}

export function universalSigns(input: TriageInput): string[] {
  const out = ['unconscious_or_convulsing_now', 'severe_respiratory_distress'];
  if (input.ageYears == null || input.ageYears < 5) out.push('unable_to_drink_or_breastfeed');
  if (input.pregnant === true) out.push('heavy_vaginal_bleeding');
  return out;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function vitalSystems(input: TriageInput): Set<System> {
  const out = new Set<System>();
  const v = input.vitals; const age = input.ageYears;
  if (num(v.temperature_c) && v.temperature_c >= 38) out.add('fever');
  if (num(v.spo2_pct) && v.spo2_pct < 95) out.add('breathing');
  const rrLimit = age == null ? 24 : age < 1 ? 50 : age < 5 ? 40 : age < 12 ? 30 : 22;
  if (num(v.resp_rate_pm) && v.resp_rate_pm > rrLimit) out.add('breathing');
  const pulseLimit = age == null ? 120 : age < 1 ? 180 : age < 5 ? 160 : age < 12 ? 140 : 120;
  if (num(v.pulse_bpm) && (v.pulse_bpm > pulseLimit || v.pulse_bpm < 45)) out.add('heart');
  if (num(v.bp_systolic_mmhg) && v.bp_systolic_mmhg < 100 && (age == null || age >= 12)) out.add('heart');
  if (input.consciousness && input.consciousness !== 'alert') out.add('neuro');
  if (input.pregnant === true && num(v.bp_systolic_mmhg) && v.bp_systolic_mmhg >= 140) out.add('pregnancy');
  return out;
}

export function mentionedSystems(words: string, input: TriageInput): Set<System> {
  const out = new Set<System>();
  for (const [s, re] of Object.entries(SYSTEM_CUES) as [System, RegExp][]) if (re.test(words)) out.add(s);
  if (input.pregnant === true) out.add('pregnancy');
  if (input.ageYears != null && input.ageYears < 5) out.add('child');
  return out;
}

const tierWeight = (tier: number) => (5 - tier) * 0.25;

function cueHits(floors: FloorRule[], words: string): Set<string> {
  const bySystem = new Map<System, Map<string, Set<string>>>();
  const own = new Map<string, string[]>();
  for (const f of floors) {
    const m = metaOf(f.sign);
    if (!m?.cue) continue;
    const g = new RegExp('\\b(?:' + m.cue.source + ')', m.cue.flags.includes('g') ? m.cue.flags : m.cue.flags + 'g');
    const tokens = [...new Set([...words.matchAll(g)].map(x => x[0].toLowerCase()))];
    if (tokens.length === 0) continue;
    own.set(f.sign, tokens);
    const sys = bySystem.get(m.system) ?? new Map<string, Set<string>>();
    for (const t of tokens) sys.set(t, (sys.get(t) ?? new Set<string>()).add(f.sign));
    bySystem.set(m.system, sys);
  }
  const hit = new Set<string>();
  for (const [sign, tokens] of own) {
    const system = systemOf(sign);
    if (tokens.some(t => !SYSTEM_CUES[system].test(t) || (bySystem.get(system)?.get(t)?.size ?? 0) <= 2)) hit.add(sign);
  }
  return hit;
}

const firstAskBonus = (system: System, sign: string): number => {
  const list = FIRST_ASK[system];
  const i = list ? list.indexOf(sign) : -1;
  return i < 0 || !list ? 0 : (list.length - i) * 0.15;
};

interface Ranked { sign: string; system: System; score: number; tier: number; said: boolean; cue: boolean; vital: boolean }

function rank(input: TriageInput, rs: RuleSet, words: string, exclude: ReadonlySet<string>): Ranked[] {
  const said = mentionedSystems(words, input);
  const vit = vitalSystems(input);
  const out: Ranked[] = [];
  const floors = askableFloors(input, rs);
  const cues = cueHits(floors, words);
  for (const f of floors) {
    if (exclude.has(f.sign)) continue;
    const lim = AGE_LIMITS[f.sign];
    const age = input.ageYears;
    if (lim && age != null && ((lim.min != null && age < lim.min) || (lim.max != null && age > lim.max))) continue;
    if (EXCLUDED_BY[f.sign]?.some(s => said.has(s))) continue;
    const system = systemOf(f.sign);
    const m = metaOf(f.sign);
    const isSaid = said.has(system); const isVital = vit.has(system); const cue = cues.has(f.sign);
    if (!isSaid && !isVital) continue;
    if (SENSITIVE_SYSTEMS.has(system) && !isSaid) continue;
    if (WORDS_REQUIRED.has(f.sign) && !cue) continue;
    out.push({ sign: f.sign, system, tier: f.tier, said: isSaid, cue, vital: isVital, score: (cue ? 3 : 0) + (isSaid ? 2 + firstAskBonus(system, f.sign) : 0) + (isVital ? 1.5 : 0) + tierWeight(f.tier) });
  }
  return out.sort((a, b) => b.score - a.score || a.tier - b.tier || orderOf(a.sign) - orderOf(b.sign));
}

export interface RelevanceResult { signs: string[]; source: 'ai' | 'topics' | 'core_only' }

export function selectRelevantSigns(input: TriageInput, rs: RuleSet, words: string, aiAsk: string[] | null, budget?: number): RelevanceResult {
  const open = new Set(askableFloors(input, rs).map(f => f.sign));
  const universal = universalSigns(input).filter(s => open.has(s));
  const said = mentionedSystems(words, input);
  const vit = vitalSystems(input);
  const limit = Math.max(universal.length, budget ?? (vit.size > 0 ? QUESTION_MAX : QUESTION_TARGET));

  const chosen: string[] = [...universal];
  const perSystem = new Map<System, number>();
  const bump = (s: string) => perSystem.set(systemOf(s), (perSystem.get(systemOf(s)) ?? 0) + 1);
  universal.forEach(bump);
  let relaxed = false;
  const roomIn = (sign: string) => {
    const sys = systemOf(sign);
    const cap = said.has(sys) || vit.has(sys) ? SYSTEM_CAP + (relaxed ? 1 : 0) : 1;
    return (perSystem.get(sys) ?? 0) < cap;
  };
  const take = (sign: string) => { chosen.push(sign); bump(sign); };

  let source: RelevanceResult['source'] = 'core_only';
  const ranked = rank(input, rs, words, new Set(universal));
  const eligible = new Set(ranked.map(r => r.sign));

  if (aiAsk && aiAsk.length > 0) {
    source = 'ai';
    for (const s of aiAsk) {
      if (chosen.length >= limit) break;
      if (!open.has(s) || chosen.includes(s) || !eligible.has(s) || !roomIn(s)) continue;
      take(s);
    }
  }
  for (const r of ranked) {
    if (chosen.length >= limit) break;
    if (chosen.includes(r.sign) || !roomIn(r.sign)) continue;
    take(r.sign);
    if (source === 'core_only') source = 'topics';
  }
  if (chosen.length < QUESTION_TARGET - 1) {
    relaxed = true;
    for (const r of ranked) {
      if (chosen.length >= Math.min(QUESTION_TARGET - 1, limit)) break;
      if (chosen.includes(r.sign) || !roomIn(r.sign)) continue;
      take(r.sign);
      if (source === 'core_only') source = 'topics';
    }
  }
  if (chosen.length < 4) {
    for (const s of DEFAULT_FILL) {
      if (chosen.length >= Math.min(4, limit)) break;
      if (open.has(s) && !chosen.includes(s)) chosen.push(s);
    }
  }
  return { signs: chosen, source };
}

export interface QuestionCandidate { floor: FloorRule; must: boolean }

export function candidateFloors(input: TriageInput, rs: RuleSet, words: string, limit: number = CANDIDATES_FOR_AI): QuestionCandidate[] {
  const byCode = new Map(rs.floors.map(f => [f.sign, f]));
  const universal = universalSigns(input).map(s => byCode.get(s)).filter((f): f is FloorRule => !!f && askableFloors(input, rs).some(a => a.sign === f.sign));
  const out: QuestionCandidate[] = universal.map(floor => ({ floor, must: true }));
  const perSystem = new Map<System, number>();
  for (const r of rank(input, rs, words, new Set(universal.map(f => f.sign)))) {
    if (out.length - universal.length >= limit) break;
    const n = perSystem.get(r.system) ?? 0;
    if (n >= 8) continue;
    perSystem.set(r.system, n + 1);
    out.push({ floor: byCode.get(r.sign)!, must: false });
  }
  return out;
}
