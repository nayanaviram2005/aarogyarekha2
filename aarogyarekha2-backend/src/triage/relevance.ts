import { topicSigns } from './topics.js';
import type { FloorRule, RuleSet, TriageInput } from './types.js';

export const CORE_SIGNS: readonly string[] = [
  'airway_obstructed_or_not_breathing', 'severe_respiratory_distress', 'central_cyanosis', 'shock_signs', 'unconscious_or_convulsing_now',
  'unable_to_drink_or_breastfeed', 'vomits_everything', 'convulsions_this_illness', 'lethargic',
  'convulsions_in_pregnancy', 'heavy_vaginal_bleeding', 'severe_headache_blurred_vision',
];

export const MAX_EXTRA_QUESTIONS = 8;

export const WORDS_REQUIRED: ReadonlySet<string> = new Set([
  'mental_health_crisis', 'overdose_poisoning_or_self_harm', 'poisoning_reported', 'adult_poisoning_reported', 'weapon_injury',
  'severe_burn', 'burn_to_face_or_genitals', 'major_trauma_or_burns', 'adult_major_trauma_or_burns', 'object_stuck_in_body', 'object_stuck_in_eye', 'eye_injury',
]);

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

export interface RelevanceResult { signs: string[]; source: 'ai' | 'topics' | 'core_only' }

export const QUESTION_BUDGET = 12;
export const MIN_SIGN_QUESTIONS = 8;

export function selectRelevantSigns(input: TriageInput, rs: RuleSet, words: string, aiAsk: string[] | null, budget: number = QUESTION_BUDGET): RelevanceResult {
  const tierOf = new Map(rs.floors.map(f => [f.sign, f.tier]));
  const open = new Set(askableFloors(input, rs).map(f => f.sign));
  const core = CORE_SIGNS.filter(s => open.has(s));
  let source: RelevanceResult['source'] = 'core_only';
  let extras: string[] = [];
  if (aiAsk && aiAsk.length > 0) {
    const worded = new Set(topicSigns(words, false));
    extras = aiAsk.filter(s => open.has(s) && !core.includes(s) && (!WORDS_REQUIRED.has(s) || worded.has(s)));
    source = 'ai';
  } else {
    const t = topicSigns(words, input.pregnant === true).filter(s => open.has(s) && !core.includes(s));
    extras = [...new Set(t)].sort((a, b) => (tierOf.get(a) ?? 9) - (tierOf.get(b) ?? 9));
    if (extras.length > 0) source = 'topics';
  }
  const room = Math.max(0, Math.min(MAX_EXTRA_QUESTIONS, budget - core.length));
  return { signs: [...core, ...extras.slice(0, room)], source };
}
