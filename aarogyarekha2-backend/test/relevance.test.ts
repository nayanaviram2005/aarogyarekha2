import { describe, expect, it } from 'vitest';
import { triage } from '../src/triage/engine.js';
import { askableFloors, candidateFloors, mentionedSystems, QUESTION_MAX, QUESTION_TARGET, selectRelevantSigns, universalSigns, vitalSystems } from '../src/triage/relevance.js';
import { RULESET_EXPANDED } from '../src/triage/ruleset.expanded.js';
import { systemOf, type System } from '../src/triage/questionBank.js';
import type { TriageInput } from '../src/triage/types.js';

const adult = (over: Partial<TriageInput> = {}): TriageInput => ({ ageYears: 34, pregnant: false, vitals: { temperature_c: 36.8 }, signs: {}, ...over });
const rs = { ...RULESET_EXPANDED, status: 'approved' as const };
const pick = (words: string, over: Partial<TriageInput> = {}, ai: string[] | null = null) => selectRelevantSigns(adult(over), rs, words, ai);
const count = (signs: string[], system: System) => signs.filter(s => systemOf(s) === system).length;

describe('a plain fever', () => {
  const r = pick('Fever for two days');
  it('gets five or six questions, mostly about the fever', () => {
    expect(r.signs.length).toBeGreaterThanOrEqual(5); expect(r.signs.length).toBeLessThanOrEqual(QUESTION_TARGET);
    expect(count(r.signs, 'fever')).toBeGreaterThanOrEqual(3); expect(r.source).toBe('topics');
  });
  it('has one breathing question at most, because the words do not mention breathing', () => {
    expect(count(r.signs, 'breathing')).toBe(1); expect(r.signs).toContain('severe_respiratory_distress');
    for (const s of ['airway_obstructed_or_not_breathing', 'central_cyanosis', 'breathing_difficulty_not_severe', 'cough_over_2_weeks']) expect(r.signs, s).not.toContain(s);
  });
  it('is not padded with injury, poison, mental health or eye questions', () => {
    for (const sys of ['injury', 'poison', 'mental', 'eye', 'burns', 'bites'] as System[]) expect(count(r.signs, sys), sys).toBe(0);
  });
  it('a child with a fever also gets the child danger question and fever questions for children', () => {
    const k = pick('Fever and not eating', { ageYears: 2 });
    expect(k.signs).toContain('unable_to_drink_or_breastfeed'); expect(count(k.signs, 'breathing')).toBeLessThanOrEqual(1); expect(k.signs.length).toBeLessThanOrEqual(QUESTION_TARGET);
    expect(k.signs).toContain('fever_child_stopped_eating_drinking');
  });
});

describe('a complaint that does mention breathing', () => {
  it('may have up to three breathing questions', () => {
    const r = pick('Fever and cough with wheezing');
    expect(count(r.signs, 'breathing')).toBeGreaterThanOrEqual(2); expect(count(r.signs, 'breathing')).toBeLessThanOrEqual(3);
    expect(r.signs).toContain('wheeze_and_cannot_speak_full_sentences');
  });
});

describe('questions follow the complaint', () => {
  const cases: [string, Partial<TriageInput>, string[], System[]][] = [
    ['Stomach pain since last night, pain on the right lower side', {}, ['pain_right_lower_belly'], ['breathing', 'poison', 'mental']],
    ['Vomiting and loose motions since morning', {}, ['diarrhoea_many_times_a_day'], ['breathing', 'injury']],
    ['Burning while passing urine and fever', {}, ['burning_when_passing_urine'], ['breathing', 'burns']],
    ['Chest pain when climbing stairs', {}, ['chest_pain_on_effort'], ['burns', 'mental']],
    ['Severe headache and vomiting', {}, ['headache_with_vomiting_and_light_sensitivity'], ['breathing', 'burns']],
    ['Cut on the hand while cutting vegetables, deep and bleeding', {}, ['deep_cut_needing_stitches'], ['poison', 'mental', 'breathing']],
    ['Bitten by a snake on the foot', {}, ['snake_bite_with_spreading_swelling', 'venomous_bite_or_sting'], ['mental']],
    ['Dog bite on the leg yesterday', {}, ['animal_bite_breaking_skin'], ['poison', 'mental']],
    ['Eye is red and painful', {}, ['red_painful_eye_with_poor_vision'], ['breathing', 'burns']],
    ['Ear pain and discharge', {}, ['blood_or_pus_from_ear'], ['poison', 'mental']],
    ['Toothache with swollen jaw', {}, ['swollen_jaw_or_face_with_toothache'], ['breathing', 'poison']],
    ['Rash all over with itching', {}, ['hives_all_over'], ['poison', 'mental']],
    ['Diabetic patient feeling very thirsty and vomiting', {}, ['known_diabetes_with_extreme_thirst_and_vomiting'], ['burns', 'bites']],
    ['Heavy period, soaking pads', { sex: 'female' } as never, ['soaking_pads_every_hour'], ['breathing', 'burns']],
    ['Seven months pregnant with swelling of face and hands', { pregnant: true }, ['swollen_face_and_hands_in_pregnancy'], ['burns', 'bites']],
    ['Baby not feeding, cord looks red', { ageYears: 0.1 }, ['infant_feeding_poorly', 'infant_cord_red_or_pus'], ['burns', 'bites']],
    ['Child swallowed a coin', { ageYears: 3 }, ['child_swallowed_coin_or_small_object'], ['breathing']],
    ['Fell from the bike, pain in the leg and cannot walk', {}, ['cannot_put_weight_after_injury', 'serious_accident_or_big_fall'], ['poison', 'mental']],
    ['Shaking chills and fever every second day', {}, ['fever_with_shaking_chills'], ['breathing', 'injury']],
    ['Feeling very low and hopeless, has a plan to end life', {}, ['has_plan_to_end_life'], ['breathing', 'burns']],
  ];
  for (const [words, over, wanted, absent] of cases) {
    it(`"${words}"`, () => {
      const r = pick(words, over);
      expect(r.signs.length).toBeLessThanOrEqual(QUESTION_TARGET); expect(r.signs.length).toBeGreaterThanOrEqual(4);
      for (const w of wanted) expect(r.signs, w).toContain(w);
      for (const sys of absent) expect(count(r.signs, sys), `${sys} questions`).toBe(sys === 'breathing' ? 1 : 0);
      for (const u of universalSigns(adult(over))) expect(r.signs, u).toContain(u);
    });
  }

  it('different complaints get clearly different lists', () => {
    const lists = cases.map(([w, o]) => pick(w, o).signs);
    const all = new Set(lists.flat()); expect(all.size).toBeGreaterThanOrEqual(45);
    const fever = pick('Fever for two days').signs; const belly = pick('Stomach pain since last night').signs;
    expect(fever.filter(s => belly.includes(s)).length).toBeLessThanOrEqual(2);
  });
});

describe('measurements can add questions', () => {
  it('a low oxygen reading brings in breathing questions even if the words do not', () => {
    const r = pick('Feeling weak', { vitals: { spo2_pct: 90 } });
    expect(count(r.signs, 'breathing')).toBeGreaterThanOrEqual(2); expect(r.signs.length).toBeLessThanOrEqual(QUESTION_MAX);
  });
  it('a high temperature brings in fever questions, and a racing pulse or low pressure the circulation ones', () => {
    expect(count(pick('Not feeling well', { vitals: { temperature_c: 39.2 } }).signs, 'fever')).toBeGreaterThanOrEqual(2);
    expect(pick('Not feeling well', { vitals: { pulse_bpm: 135, bp_systolic_mmhg: 85 } }).signs).toContain('shock_signs');
  });
  it('not being alert brings in the nervous system questions', () => {
    expect(count(pick('Not feeling well', { consciousness: 'voice' }).signs, 'neuro')).toBeGreaterThanOrEqual(2);
  });
  it('age changes what counts as fast breathing', () => {
    expect([...vitalSystems(adult({ ageYears: 0.5, vitals: { resp_rate_pm: 45 } }))]).not.toContain('breathing');
    expect([...vitalSystems(adult({ ageYears: 30, vitals: { resp_rate_pm: 45 } }))]).toContain('breathing');
  });
  it('words and age map to body systems', () => {
    const s = mentionedSystems('Fever, loose stools and belly pain', adult({ ageYears: 2 }));
    expect([...s]).toEqual(expect.arrayContaining(['fever', 'gut', 'abdomen', 'child'])); expect([...s]).not.toContain('breathing');
  });
});

describe('with little to go on', () => {
  it('no words and no measurements: the short universal list plus a few general red flags', () => {
    const r = pick('');
    expect(r.signs).toEqual(expect.arrayContaining(['unconscious_or_convulsing_now', 'severe_respiratory_distress'])); expect(r.signs.length).toBe(4); expect(r.source).toBe('core_only');
  });
  it('the universal questions depend on the patient', () => {
    expect(universalSigns(adult())).toEqual(['unconscious_or_convulsing_now', 'severe_respiratory_distress']);
    expect(universalSigns(adult({ ageYears: 2 }))).toContain('unable_to_drink_or_breastfeed');
    expect(universalSigns(adult({ pregnant: true }))).toContain('heavy_vaginal_bleeding');
  });
});

describe('the AI can steer within limits', () => {
  it('its choices come first, in its order, and unknown or unrelated codes are ignored', () => {
    const r = pick('Fever for six days', {}, ['fever_over_5_days', 'not_a_real_sign', 'mental_health_crisis', 'fever_with_confusion']);
    expect(r.source).toBe('ai'); expect(r.signs.slice(2, 4)).toEqual(['fever_over_5_days', 'fever_with_confusion']);
    expect(r.signs).not.toContain('not_a_real_sign'); expect(r.signs).not.toContain('mental_health_crisis');
  });
  it('cannot push extra breathing questions onto a complaint that does not mention breathing', () => {
    const r = pick('Fever for two days', {}, ['central_cyanosis', 'airway_obstructed_or_not_breathing', 'breathing_difficulty_not_severe', 'cough_over_2_weeks']);
    expect(count(r.signs, 'breathing')).toBe(1);
  });
  it('cannot add sensitive questions when the words do not point there, but can when they do', () => {
    expect(pick('Stomach pain since yesterday', {}, ['overdose_poisoning_or_self_harm', 'weapon_injury', 'mental_health_crisis', 'has_plan_to_end_life']).signs).not.toEqual(expect.arrayContaining(['weapon_injury']));
    expect(pick('He swallowed pesticide and says he wants to die', {}, ['overdose_poisoning_or_self_harm', 'has_plan_to_end_life']).signs).toEqual(expect.arrayContaining(['overdose_poisoning_or_self_harm', 'has_plan_to_end_life']));
    expect(pick('stab wound after a fight, bleeding', {}, ['weapon_injury']).signs).toContain('weapon_injury');
  });
  it('an empty list means no AI answer', () => { expect(pick('Fever', {}, []).source).toBe('topics'); });
  it('never goes past the maximum, whatever the AI asks for', () => {
    const many = rs.floors.map(f => f.sign);
    expect(selectRelevantSigns(adult(), rs, 'Fever and cough and stomach pain and headache and rash', many).signs.length).toBeLessThanOrEqual(QUESTION_MAX);
  });
  it('a tiny budget never drops the universal questions', () => {
    expect(selectRelevantSigns(adult(), rs, 'Stomach pain', null, 1).signs).toEqual(['unconscious_or_convulsing_now', 'severe_respiratory_distress']);
  });
});

describe('the list shown to the AI', () => {
  it('is the universal questions plus the ones that fit the complaint, not the whole bank', () => {
    const c = candidateFloors(adult(), rs, 'Fever for two days'); const signs = c.map(x => x.floor.sign);
    expect(c.filter(x => x.must).map(x => x.floor.sign)).toEqual(['unconscious_or_convulsing_now', 'severe_respiratory_distress']);
    expect(c.length).toBeLessThanOrEqual(2 + 24); expect(rs.floors.length).toBeGreaterThan(200);
    expect(signs).toContain('fever_over_5_days'); expect(signs).not.toContain('mental_health_crisis'); expect(signs).not.toContain('central_cyanosis');
  });
});

describe('askableFloors', () => {
  it('leaves out answered signs and signs for the wrong group', () => {
    const a = askableFloors(adult({ signs: { chest_pain: false } }), rs).map(f => f.sign);
    expect(a).not.toContain('chest_pain'); expect(a).not.toContain('unable_to_drink_or_breastfeed'); expect(a).not.toContain('convulsions_in_pregnancy'); expect(a).toContain('severe_bleeding');
    expect(a).not.toContain('child_fast_breathing'); expect(a).not.toContain('pregnant_burning_urine');
  });
  it('a child gets the child signs and a pregnant patient the pregnancy signs', () => {
    expect(askableFloors(adult({ ageYears: 2 }), rs).map(f => f.sign)).toEqual(expect.arrayContaining(['unable_to_drink_or_breastfeed', 'child_fast_breathing', 'infant_feeding_poorly']));
    expect(askableFloors(adult({ pregnant: true }), rs).map(f => f.sign)).toEqual(expect.arrayContaining(['convulsions_in_pregnancy', 'pregnant_burning_urine']));
  });
  it('unknown age or pregnancy keeps the question open rather than hiding it', () => {
    const a = askableFloors(adult({ ageYears: null, pregnant: null }), rs).map(f => f.sign); expect(a).toContain('unable_to_drink_or_breastfeed'); expect(a).toContain('convulsions_in_pregnancy');
  });
});

describe('the engine with a narrowed question list', () => {
  const missing = (i: TriageInput) => triage(i, rs).missing.filter(m => m.code.startsWith('sign.')).map(m => m.code.slice(5));
  it('asks only the chosen signs, a handful out of more than two hundred', () => {
    const all = missing(adult()); const chosen = pick('Fever for two days').signs; const some = missing(adult({ relevantSigns: chosen }));
    expect(all.length).toBeGreaterThan(100); expect(some.sort()).toEqual([...chosen].sort()); expect(some.length).toBeLessThanOrEqual(QUESTION_TARGET);
  });
  it('an answer to a sign that is not on the list still counts', () => {
    const d = triage(adult({ relevantSigns: ['fever_over_5_days'], signs: { overdose_poisoning_or_self_harm: true } }), rs);
    expect(d.tier).toBe(1); expect(d.winning.ruleId).toMatch(/GT1-08/);
  });
  it('a new question raises the priority when answered yes', () => {
    expect(triage(adult({ signs: { fever_with_bleeding_or_spots: true } }), rs).tier).toBe(2);
    expect(triage(adult({ signs: { choking_now: true } }), rs).tier).toBe(1);
    expect(triage(adult({ signs: { fever_over_5_days: true } }), rs).tier).toBe(3);
  });
  it('changing the list never lowers a tier that answers already set', () => {
    const base = adult({ signs: { shock_signs: true } });
    expect(triage({ ...base, relevantSigns: [] }, rs).tier).toBe(triage(base, rs).tier);
  });
});
