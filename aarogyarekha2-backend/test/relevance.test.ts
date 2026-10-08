import { describe, expect, it } from 'vitest';
import { triage } from '../src/triage/engine.js';
import { askableFloors, CORE_SIGNS, MAX_EXTRA_QUESTIONS, selectRelevantSigns } from '../src/triage/relevance.js';
import { RULESET_PROPOSED as PROP } from '../src/triage/ruleset.proposed.js';
import { PREGNANCY_SIGNS, TOPICS, topicSigns } from '../src/triage/topics.js';
import type { TriageInput } from '../src/triage/types.js';

const adult = (over: Partial<TriageInput> = {}): TriageInput => ({ ageYears: 34, pregnant: false, vitals: { temperature_c: 36.8 }, signs: {}, ...over });
const rs = { ...PROP, status: 'approved' as const };

describe('topics', () => {
  it('every sign in the rules is reachable: core, pregnancy, or in at least one topic', () => {
    const reachable = new Set<string>([...CORE_SIGNS, ...PREGNANCY_SIGNS, ...TOPICS.flatMap(t => t.signs)]);
    expect(PROP.floors.map(f => f.sign).filter(s => !reachable.has(s))).toEqual([]);
  });
  it('every topic and pregnancy sign exists in the rules (no typos)', () => {
    const known = new Set(PROP.floors.map(f => f.sign));
    expect([...PREGNANCY_SIGNS, ...TOPICS.flatMap(t => t.signs)].filter(s => !known.has(s))).toEqual([]);
  });
  it('plain stomach pain does not bring in self-harm, weapons, burns or the eye', () => {
    const s = topicSigns('Stomach pain since yesterday, no vomiting', false);
    expect(s).toContain('sudden_severe_abdominal_or_back_pain');
    for (const bad of ['mental_health_crisis', 'overdose_poisoning_or_self_harm', 'weapon_injury', 'severe_burn', 'eye_injury', 'object_stuck_in_eye']) expect(s, bad).not.toContain(bad);
  });
  it('pregnancy adds the pregnancy signs whatever the words say', () => { for (const s of PREGNANCY_SIGNS) expect(topicSigns('tired', true)).toContain(s); });
  it('no words, no topic signs', () => { expect(topicSigns('', false)).toEqual([]); });
});

describe('selectRelevantSigns', () => {
  it('core signs for the patient are always there; child and pregnancy core signs come with those patients', () => {
    const a = selectRelevantSigns(adult(), rs, '', null); expect(a.signs).toEqual(['airway_obstructed_or_not_breathing', 'severe_respiratory_distress', 'central_cyanosis', 'shock_signs', 'unconscious_or_convulsing_now']); expect(a.source).toBe('core_only');
    expect(selectRelevantSigns(adult({ ageYears: 2 }), rs, '', null).signs).toContain('unable_to_drink_or_breastfeed');
    expect(selectRelevantSigns(adult({ pregnant: true }), rs, '', null).signs).toContain('convulsions_in_pregnancy');
  });
  it('the AI can only add; it cannot remove a core sign, and unknown codes are ignored', () => {
    const r = selectRelevantSigns(adult(), rs, 'stomach pain', ['persistent_vomiting', 'not_a_real_sign']);
    expect(r.source).toBe('ai'); expect(r.signs).toContain('persistent_vomiting'); expect(r.signs).not.toContain('not_a_real_sign'); for (const s of CORE_SIGNS.slice(0, 5)) expect(r.signs).toContain(s);
    expect(r.signs).not.toContain('mental_health_crisis');                      // topics are NOT added on top of the AI's choice
  });
  it('without the AI it falls back to topic matching on the words', () => {
    const r = selectRelevantSigns(adult(), rs, 'severe stomach pain and vomiting', null);
    expect(r.source).toBe('topics'); expect(r.signs).toContain('persistent_vomiting'); expect(r.signs).not.toContain('mental_health_crisis');
  });
  it('an empty AI list is treated as "no AI answer" and falls back', () => { expect(selectRelevantSigns(adult(), rs, 'fever', []).source).toBe('topics'); });
  it('the whole list stays within the budget, with core first and the rest by the AI\'s order or by urgency', () => {
    const ai = selectRelevantSigns(adult(), rs, '', ['persistent_vomiting', 'swollen_limb', 'sudden_rash', 'urgent_test_result', 'medicine_reaction', 'limb_pain_without_injury', 'eye_injury', 'missed_or_run_out_medicine', 'sudden_vision_change'], 9);
    expect(ai.signs.length).toBe(9); expect(ai.signs.slice(5)).toEqual(['persistent_vomiting', 'swollen_limb', 'sudden_rash', 'urgent_test_result']);
    const tp = selectRelevantSigns(adult(), rs, 'injury and bleeding, a fall, a burn and fever', null, 12);
    expect(tp.signs.length).toBe(12); const tiers = tp.signs.slice(5).map(s => rs.floors.find(f => f.sign === s)!.tier); expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });
  it('a tiny budget never drops the core signs', () => { expect(selectRelevantSigns(adult(), rs, 'stomach pain', ['persistent_vomiting'], 2).signs).toEqual(['airway_obstructed_or_not_breathing', 'severe_respiratory_distress', 'central_cyanosis', 'shock_signs', 'unconscious_or_convulsing_now']); });
  it('caps what the AI can add', () => {
    const many = rs.floors.map(f => f.sign); const r = selectRelevantSigns(adult(), rs, '', many);
    expect(r.signs.length).toBeLessThanOrEqual(5 + MAX_EXTRA_QUESTIONS);
  });
});

describe('askableFloors', () => {
  it('leaves out answered signs and signs for the wrong group', () => {
    const a = askableFloors(adult({ signs: { chest_pain: false } }), rs).map(f => f.sign);
    expect(a).not.toContain('chest_pain'); expect(a).not.toContain('unable_to_drink_or_breastfeed'); expect(a).not.toContain('convulsions_in_pregnancy'); expect(a).toContain('severe_bleeding');
  });
  it('a child gets the child signs and a pregnant patient the pregnancy signs', () => {
    expect(askableFloors(adult({ ageYears: 2 }), rs).map(f => f.sign)).toContain('unable_to_drink_or_breastfeed');
    expect(askableFloors(adult({ pregnant: true }), rs).map(f => f.sign)).toContain('convulsions_in_pregnancy');
  });
  it('unknown age or pregnancy keeps the question open rather than hiding it', () => {
    const a = askableFloors(adult({ ageYears: null, pregnant: null }), rs).map(f => f.sign); expect(a).toContain('unable_to_drink_or_breastfeed'); expect(a).toContain('convulsions_in_pregnancy');
  });
});

describe('the engine with a narrowed question list', () => {
  const missing = (i: TriageInput) => triage(i, rs).missing.filter(m => m.code.startsWith('sign.')).map(m => m.code.slice(5));
  it('asks only the relevant signs, far fewer than before', () => {
    const all = missing(adult()); const some = missing(adult({ relevantSigns: [...CORE_SIGNS, 'persistent_vomiting'] }));
    expect(all.length).toBeGreaterThan(40); expect(some).toContain('persistent_vomiting'); expect(some).not.toContain('mental_health_crisis'); expect(some.length).toBeLessThan(10);
  });
  it('an answer to a sign that is not on the list still counts', () => {
    const d = triage(adult({ relevantSigns: ['persistent_vomiting'], signs: { overdose_poisoning_or_self_harm: true } }), rs);
    expect(d.tier).toBe(1); expect(d.winning.ruleId).toMatch(/GT1-08/);
  });
  it('"could be higher" only counts questions that are on the list', () => {
    const full = { temperature_c: 36.8, spo2_pct: 98, pulse_bpm: 80, resp_rate_pm: 16, bp_systolic_mmhg: 120, bp_diastolic_mmhg: 80 }; const withVitals = (o: Partial<TriageInput> = {}) => adult({ vitals: full, consciousness: 'alert', onSupplementalOxygen: false, ...o });
    const wide = triage(withVitals(), rs); const none = triage(withVitals({ relevantSigns: [] }), rs);
    expect(wide.potentialTier).not.toBeNull(); expect(none.potentialTier).toBeNull();
  });
  it('changing the list never lowers a tier that answers already set', () => {
    const base = adult({ signs: { shock_signs: true } });
    expect(triage({ ...base, relevantSigns: [] }, rs).tier).toBe(triage(base, rs).tier);
  });
});

describe('sensitive questions need the person\'s words', () => {
  it('a model that lists self-harm, poisoning or weapons for plain stomach pain is ignored on those', () => {
    const r = selectRelevantSigns(adult(), rs, 'Stomach pain since yesterday evening, no vomiting', ['sudden_severe_abdominal_or_back_pain', 'mental_health_crisis', 'overdose_poisoning_or_self_harm', 'weapon_injury', 'persistent_vomiting']);
    expect(r.signs).toContain('sudden_severe_abdominal_or_back_pain'); expect(r.signs).toContain('persistent_vomiting');
    for (const bad of ['mental_health_crisis', 'overdose_poisoning_or_self_harm', 'weapon_injury']) expect(r.signs, bad).not.toContain(bad);
  });
  it('the same questions are kept when the words point there', () => {
    expect(selectRelevantSigns(adult(), rs, 'He swallowed pesticide and says he wants to die', ['overdose_poisoning_or_self_harm', 'mental_health_crisis']).signs).toEqual(expect.arrayContaining(['overdose_poisoning_or_self_harm', 'mental_health_crisis']));
    expect(selectRelevantSigns(adult(), rs, 'stab wound after a fight, bleeding', ['weapon_injury']).signs).toContain('weapon_injury');
  });
});
