// Which danger-sign questions are worth asking for THIS patient.
//
// The rule set holds ~100 danger signs. Asking all of them of everyone buries the health worker (why ask about self-harm of
// someone with plain stomach pain?). So the follow-up list is narrowed to what the patient's own symptoms point to:
//   * CORE signs are always asked while unanswered: the quick look-at-the-patient emergency signs, plus the general danger signs for
//     a small child and for a pregnant patient. These are never filtered out by anything, including the AI.
//   * An AI model, when available and consented, picks the other signs that fit the symptoms. It can only ADD questions to the core.
//   * Without the AI, simple topic matching on the symptom words does a coarser job (see topics.ts).
// Narrowing changes what is ASKED, never what counts: an answer to any sign is always honoured, and "could be higher" only counts
// the questions that are on the list.
import { topicSigns } from './topics.js';
import type { FloorRule, RuleSet, TriageInput } from './types.js';

export const CORE_SIGNS: readonly string[] = [
  // quick emergency look, everyone
  'airway_obstructed_or_not_breathing', 'severe_respiratory_distress', 'central_cyanosis', 'shock_signs', 'unconscious_or_convulsing_now',
  // general danger signs, child under 5 (IMNCI)
  'unable_to_drink_or_breastfeed', 'vomits_everything', 'convulsions_this_illness', 'lethargic',
  // maternal danger signs, pregnant (NHM)
  'convulsions_in_pregnancy', 'heavy_vaginal_bleeding', 'severe_headache_blurred_vision',
];

export const MAX_EXTRA_QUESTIONS = 8;

/**
 * Questions that must never reach a health worker because a model liked them: they are asked only when the person's own words point there
 * (the topic match on the symptom words finds them). A model that lists "self-harm" for plain stomach pain is padding, not reasoning.
 */
export const WORDS_REQUIRED: ReadonlySet<string> = new Set([
  'mental_health_crisis', 'overdose_poisoning_or_self_harm', 'poisoning_reported', 'adult_poisoning_reported', 'weapon_injury',
  'severe_burn', 'burn_to_face_or_genitals', 'major_trauma_or_burns', 'adult_major_trauma_or_burns', 'object_stuck_in_body', 'object_stuck_in_eye', 'eye_injury',
]);

/** The signs the rules could still ask about: right population (or population not yet known) and not yet answered. */
export function askableFloors(input: TriageInput, rs: RuleSet): FloorRule[] {
  return rs.floors.filter(f => {
    if (input.signs[f.sign] != null) return false;
    switch (f.population) {
      case 'any': return true;
      case 'child_under_5': return input.ageYears == null || input.ageYears < 5;
      case 'adult': return input.ageYears == null || (input.ageYears >= rs.news2.minAgeYears && input.pregnant !== true);
      case 'pregnant': return input.pregnant == null || input.pregnant === true;
    }
  });
}

export interface RelevanceResult { signs: string[]; source: 'ai' | 'topics' | 'core_only' }

/** The most danger-sign + measurement questions one assessment lists. Anything more would delay emergency care. */
export const QUESTION_BUDGET = 12;
/** Even when many measurements are missing, at least this many sign questions are listed (the core signs plus a few that fit the symptoms). Worst case total is about 15. */
export const MIN_SIGN_QUESTIONS = 8;

/**
 * @param words   the patient's own words (complaint and symptoms), in English where translated
 * @param aiAsk   signs the AI chose (in its order of relevance), or null when it could not be used
 * @param budget  how many sign questions may be listed in total (the caller subtracts the measurement questions it will also list)
 */
export function selectRelevantSigns(input: TriageInput, rs: RuleSet, words: string, aiAsk: string[] | null, budget: number = QUESTION_BUDGET): RelevanceResult {
  const tierOf = new Map(rs.floors.map(f => [f.sign, f.tier]));
  const open = new Set(askableFloors(input, rs).map(f => f.sign));
  const core = CORE_SIGNS.filter(s => open.has(s));
  let source: RelevanceResult['source'] = 'core_only';
  let extras: string[] = [];
  if (aiAsk && aiAsk.length > 0) {
    const worded = new Set(topicSigns(words, false));
    extras = aiAsk.filter(s => open.has(s) && !core.includes(s) && (!WORDS_REQUIRED.has(s) || worded.has(s)));          // the AI's own order: most relevant first; sensitive ones only when the words point there
    source = 'ai';
  } else {
    const t = topicSigns(words, input.pregnant === true).filter(s => open.has(s) && !core.includes(s));
    extras = [...new Set(t)].sort((a, b) => (tierOf.get(a) ?? 9) - (tierOf.get(b) ?? 9));   // most urgent first
    if (extras.length > 0) source = 'topics';
  }
  const room = Math.max(0, Math.min(MAX_EXTRA_QUESTIONS, budget - core.length));
  return { signs: [...core, ...extras.slice(0, room)], source };
}
