import type { Consciousness, Tier, TriageInput } from '../triage/types.js';

export type CaseGroup = 'adult_news2' | 'adult_danger_signs' | 'child' | 'pregnancy' | 'missing_data' | 'india_scenarios';
export interface EvalCase { id: string; group: CaseGroup; text: string; input: TriageInput; expected: Tier; source: string; gap?: boolean; fixedIn?: string; potentialTier?: Tier | null }

const NORMAL = { resp_rate_pm: 16, spo2_pct: 98, bp_systolic_mmhg: 120, bp_diastolic_mmhg: 80, pulse_bpm: 72, temperature_c: 37.0 };
const NO_AIRWAY = { airway_obstructed_or_not_breathing: false };
const adult = (v: Partial<typeof NORMAL> = {}, o: Partial<TriageInput> = {}): TriageInput => ({ ageYears: 40, pregnant: false, vitals: { ...NORMAL, ...v }, consciousness: 'alert' as Consciousness, onSupplementalOxygen: false, signs: { ...NO_AIRWAY }, ...o });
const withSign = (i: TriageInput, ...codes: string[]): TriageInput => ({ ...i, signs: { ...i.signs, ...Object.fromEntries(codes.map(c => [c, true])) } });
const child = (age: number, ...codes: string[]): TriageInput => withSign({ ageYears: age, pregnant: false, vitals: { temperature_c: 37.2, pulse_bpm: 110, resp_rate_pm: 28, spo2_pct: 98 }, consciousness: 'alert', onSupplementalOxygen: false, signs: { ...NO_AIRWAY } }, ...codes);
const preg = (v: Partial<typeof NORMAL> = {}, ...codes: string[]): TriageInput => withSign({ ageYears: 26, pregnant: true, vitals: { ...NORMAL, ...v }, consciousness: 'alert', onSupplementalOxygen: false, signs: { ...NO_AIRWAY } }, ...codes);

const c = (id: string, group: CaseGroup, text: string, input: TriageInput, expected: Tier, source: string, extra: Partial<EvalCase> = {}): EvalCase => ({ id, group, text, input, expected, source, ...extra });
const N2 = 'NEWS2 (RCP 2017) bands, tier per docs/03 mapping';

export const CASES: EvalCase[] = [
  c('A01', 'adult_news2', 'Normal vitals, alert', adult(), 4, `${N2}: score 0`),
  c('A02', 'adult_news2', 'Temperature 38.6 only', adult({ temperature_c: 38.6 }), 3, `${N2}: score 1`),
  c('A03', 'adult_news2', 'Pulse 100 only', adult({ pulse_bpm: 100 }), 3, `${N2}: score 1`),
  c('A04', 'adult_news2', 'SpO2 95 only', adult({ spo2_pct: 95 }), 3, `${N2}: score 1`),
  c('A05', 'adult_news2', 'Breathing 22 and temperature 38.5', adult({ resp_rate_pm: 22, temperature_c: 38.5 }), 3, `${N2}: score 3 (2+1), no single 3`),
  c('A06', 'adult_news2', 'SpO2 91 only', adult({ spo2_pct: 91 }), 2, `${N2}: single parameter 3`),
  c('A07', 'adult_news2', 'Breathing 26 only', adult({ resp_rate_pm: 26 }), 2, `${N2}: single parameter 3`),
  c('A08', 'adult_news2', 'Systolic 85 only', adult({ bp_systolic_mmhg: 85 }), 2, `${N2}: single parameter 3`),
  c('A09', 'adult_news2', 'Pulse 135 only', adult({ pulse_bpm: 135 }), 2, `${N2}: single parameter 3`),
  c('A10', 'adult_news2', 'New confusion', adult({}, { consciousness: 'confusion' }), 2, `${N2}: consciousness 3`),
  c('A11', 'adult_news2', 'Breathing 22, SpO2 94, systolic 105, pulse 105, temp 38.5', adult({ resp_rate_pm: 22, spo2_pct: 94, bp_systolic_mmhg: 105, pulse_bpm: 105, temperature_c: 38.5 }), 2, `${N2}: score 6`),
  c('A12', 'adult_news2', 'Breathing 22, SpO2 94, systolic 105, pulse 105', adult({ resp_rate_pm: 22, spo2_pct: 94, bp_systolic_mmhg: 105, pulse_bpm: 105 }), 2, `${N2}: score 5`),
  c('A13', 'adult_news2', 'On supplemental oxygen, otherwise normal', adult({}, { onSupplementalOxygen: true }), 3, `${N2}: oxygen scores 2`),
  c('A14', 'adult_news2', 'Breathing 28, SpO2 88, pulse 140, systolic 85', adult({ resp_rate_pm: 28, spo2_pct: 88, pulse_bpm: 140, bp_systolic_mmhg: 85 }), 1, `${N2}: score 12`),
  c('A15', 'adult_news2', 'Score exactly 7 (breathing 22, SpO2 92, pulse 115, temp 38.5)', adult({ resp_rate_pm: 22, spo2_pct: 92, pulse_bpm: 115, temperature_c: 38.5 }), 1, `${N2}: score 7`),
  c('A16', 'adult_news2', 'Temperature 34.5 only', adult({ temperature_c: 34.5 }), 2, `${N2}: single parameter 3`),
  c('A17', 'adult_news2', 'Systolic 225 only', adult({ bp_systolic_mmhg: 225 }), 2, `${N2}: single parameter 3`),
  c('A18', 'adult_news2', 'Fever 39.5, pulse 118, breathing 23, systolic 98', adult({ temperature_c: 39.5, pulse_bpm: 118, resp_rate_pm: 23, bp_systolic_mmhg: 98 }), 1, `${N2}: score 8`),
  c('A19', 'adult_news2', 'Elderly 85, SpO2 93 and pulse 95', adult({ spo2_pct: 93, pulse_bpm: 95 }, { ageYears: 85 }), 3, `${N2}: score 3`),
  c('A20', 'adult_news2', 'Older adult 70, normal vitals', adult({}, { ageYears: 70 }), 4, `${N2}: score 0; age alone does not escalate`),

  c('D01', 'adult_danger_signs', 'Airway obstructed or not breathing', withSign(adult(), 'airway_obstructed_or_not_breathing'), 1, 'ETAT emergency sign'),
  c('D02', 'adult_danger_signs', 'Severe respiratory distress', withSign(adult(), 'severe_respiratory_distress'), 1, 'ETAT emergency sign'),
  c('D03', 'adult_danger_signs', 'Central cyanosis', withSign(adult(), 'central_cyanosis'), 1, 'ETAT emergency sign'),
  c('D04', 'adult_danger_signs', 'Signs of shock', withSign(adult(), 'shock_signs'), 1, 'ETAT emergency sign'),
  c('D05', 'adult_danger_signs', 'Unconscious or convulsing now', withSign(adult({}, { consciousness: 'unresponsive' }), 'unconscious_or_convulsing_now'), 1, 'ETAT emergency sign'),
  c('D06', 'adult_danger_signs', 'Severe pain reported', withSign(adult(), 'adult_severe_pain'), 3, 'ETAT priority sign. v0.1.1 applies priority signs to children under 5 only, so an adult gets no floor from it', { gap: true, fixedIn: '0.2.0' }),
  c('D07', 'adult_danger_signs', 'Major trauma or burns', withSign(adult(), 'adult_major_trauma_or_burns'), 2, 'Clinical judgement: major trauma needs an adult sign; v0.1.1 has none', { gap: true, fixedIn: '0.2.0' }),
  c('D08', 'adult_danger_signs', 'Poisoning reported', withSign(adult(), 'adult_poisoning_reported'), 2, 'Clinical judgement: poisoning needs an adult sign; v0.1.1 has none', { gap: true, fixedIn: '0.2.0' }),

  c('N01', 'adult_danger_signs', 'Chest pain or heaviness', withSign(adult(), 'chest_pain'), 2, 'Product brief lists chest pain as a red flag; not in v0.1.1', { gap: true, fixedIn: '0.2.0' }),
  c('N02', 'adult_danger_signs', 'Chest pain in a pregnant patient', withSign(preg(), 'chest_pain'), 2, 'Product brief lists chest pain as a red flag; not in v0.1.1', { gap: true, fixedIn: '0.2.0' }),
  c('N03', 'adult_danger_signs', 'Stiff neck with fever', withSign(adult({ temperature_c: 39.2 }), 'stiff_neck_with_fever'), 2, 'Product brief lists "high fever with a stiff neck"; not in v0.1.1', { gap: true, fixedIn: '0.2.0' }),
  c('N04', 'adult_danger_signs', 'Severe bleeding that will not stop', withSign(adult(), 'severe_bleeding'), 1, 'Product brief lists severe bleeding; v0.1.1 has it only for pregnancy', { gap: true, fixedIn: '0.2.0' }),

  c('C01', 'child', 'Well child of 3, no danger signs', child(3), 4, 'IMNCI: no general danger sign'),
  c('C02', 'child', 'Lethargic child', child(3, 'lethargic'), 2, 'IMNCI general danger sign, local tier T2'),
  c('C03', 'child', 'Unable to drink or breastfeed', child(1, 'unable_to_drink_or_breastfeed'), 2, 'IMNCI general danger sign'),
  c('C04', 'child', 'Convulsions during this illness', child(2, 'convulsions_this_illness'), 2, 'IMNCI general danger sign'),
  c('C05', 'child', 'Vomits everything', child(4, 'vomits_everything'), 2, 'IMNCI general danger sign'),
  c('C06', 'child', 'Very high fever, otherwise well', child(3, 'very_high_fever_child'), 3, 'ETAT priority sign'),
  c('C07', 'child', 'Severe pallor', child(3, 'severe_pallor'), 3, 'ETAT priority sign'),
  c('C08', 'child', 'Severe visible wasting', child(2, 'severe_visible_wasting'), 3, 'ETAT priority sign'),
  c('C09', 'child', 'Swelling of both feet', child(4, 'swelling_both_feet'), 3, 'ETAT priority sign'),
  c('C10', 'child', 'Tiny infant under 2 months', child(0.08, 'tiny_infant_under_2_months'), 3, 'ETAT priority sign'),
  c('C11', 'child', 'Breathing difficulty, not severe', child(2, 'breathing_difficulty_not_severe'), 3, 'ETAT priority sign'),
  c('C12', 'child', 'Unconscious now', child(3, 'unconscious_or_convulsing_now'), 1, 'ETAT emergency sign'),
  c('C13', 'child', 'Severe fluid loss signs', child(1, 'severe_fluid_loss_signs'), 1, 'ETAT emergency sign'),
  c('C14', 'child', 'Central cyanosis', child(2, 'central_cyanosis'), 1, 'ETAT emergency sign'),
  c('C15', 'child', 'Lethargic and very high fever: the more urgent wins', child(3, 'lethargic', 'very_high_fever_child'), 2, 'Most urgent layer wins'),
  c('C16', 'child', 'Convulsing and severe respiratory distress', child(3, 'convulsions_this_illness', 'severe_respiratory_distress'), 1, 'Most urgent layer wins'),
  c('C17', 'child', 'Infant 8 months, fever 39.5, alert, no danger signs', { ...child(0.67), vitals: { temperature_c: 39.5, pulse_bpm: 140, resp_rate_pm: 34, spo2_pct: 97 } }, 4, 'IMNCI: fever without a general danger sign is not urgent referral'),
  c('C18', 'child', 'Child 4 with SpO2 88 and no sign ticked', { ...child(4), vitals: { temperature_c: 37.5, pulse_bpm: 150, resp_rate_pm: 48, spo2_pct: 88 } }, 2, 'Clinical judgement: low oxygen in a child needs urgent assessment; the draft rules score adults only', { gap: true }),

  c('P01', 'pregnancy', 'Pregnant, normal readings, no signs', preg(), 4, 'No danger sign, normal blood pressure'),
  c('P02', 'pregnancy', 'Blood pressure 165/112', preg({ bp_systolic_mmhg: 165, bp_diastolic_mmhg: 112 }), 2, 'WHO severe hypertension in pregnancy'),
  c('P03', 'pregnancy', 'Blood pressure 120/112 (diastolic severe only)', preg({ bp_systolic_mmhg: 120, bp_diastolic_mmhg: 112 }), 2, 'WHO severe hypertension in pregnancy: either reading'),
  c('P04', 'pregnancy', 'Convulsions in pregnancy', preg({}, 'convulsions_in_pregnancy'), 1, 'NHM danger sign, local tier T1'),
  c('P05', 'pregnancy', 'Heavy vaginal bleeding', preg({}, 'heavy_vaginal_bleeding'), 1, 'NHM danger sign, local tier T1'),
  c('P06', 'pregnancy', 'Severe headache and blurred vision', preg({}, 'severe_headache_blurred_vision'), 2, 'NHM danger sign'),
  c('P07', 'pregnancy', 'Reduced fetal movement', preg({}, 'reduced_fetal_movement'), 2, 'NHM danger sign'),
  c('P08', 'pregnancy', 'Fever in pregnancy', preg({ temperature_c: 38.9 }, 'fever_in_pregnancy'), 2, 'NHM danger sign'),
  c('P09', 'pregnancy', 'Any vaginal bleeding', preg({}, 'any_vaginal_bleeding'), 2, 'NHM danger sign'),
  c('P10', 'pregnancy', 'Leaking fluid or labour pains', preg({}, 'leaking_fluid_or_labour_pains'), 2, 'NHM danger sign'),
  c('P11', 'pregnancy', 'Blood pressure 150/100 (raised, not severe)', preg({ bp_systolic_mmhg: 150, bp_diastolic_mmhg: 100 }), 3, 'Clinical judgement: raised pressure in pregnancy needs same-day review; the draft has only the severe-range rule', { gap: true }),
  c('P12', 'pregnancy', 'Pregnant, SpO2 88', preg({ spo2_pct: 88 }), 2, 'Clinical judgement: hypoxia in pregnancy is urgent; the draft gives pregnant patients no score', { gap: true }),
  c('P13', 'pregnancy', 'Pregnant, pulse 125 and systolic 92', preg({ pulse_bpm: 125, bp_systolic_mmhg: 92 }), 2, 'Clinical judgement: possible shock; no MEOWS-type score in the draft (deliberately not implemented)', { gap: true }),

  c('M01', 'missing_data', 'Nothing assessed at all', { ageYears: 40, pregnant: false, vitals: {}, consciousness: null, onSupplementalOxygen: null, signs: {} }, 3, 'Safety choice: never T4 when nothing was checked'),
  c('M02', 'missing_data', 'Normal vitals but no sign question answered', { ...adult(), signs: {} }, 4, 'Unanswered is not "no"; tier from what is known', { potentialTier: 3 }),
  c('M03', 'missing_data', 'Age unknown, fever only', { ageYears: null, pregnant: null, vitals: { temperature_c: 38.7 }, consciousness: null, signs: {} }, 3, 'Cautious when age and pregnancy are unknown. The draft cannot score NEWS2 without an age, so this falls to the default', { gap: true, fixedIn: '0.2.0' }),
  c('M04', 'missing_data', 'Only a pulse of 135 recorded', { ageYears: 40, pregnant: false, vitals: { pulse_bpm: 135 }, consciousness: null, signs: {} }, 2, `${N2}: single parameter 3 from the one reading`),
  c('M05', 'missing_data', 'Adult with every vital but consciousness missing', { ...adult(), consciousness: null }, 4, 'Missing is not abnormal; shown as still needed'),

  c('S01', 'india_scenarios', 'Campus: student 20, fever 38.8, pulse 98', adult({ temperature_c: 38.8, pulse_bpm: 98 }, { ageYears: 20 }), 3, `${N2}: score 2`),
  c('S02', 'india_scenarios', 'Workplace heat: worker 35, 40.2 C, pulse 124, breathing 24, confused', adult({ temperature_c: 40.2, pulse_bpm: 124, resp_rate_pm: 24 }, { ageYears: 35, consciousness: 'confusion' }), 1, `${N2}: score 9`),
  c('S03', 'india_scenarios', 'Camp: man 62, BP 190/105, no symptoms', adult({ bp_systolic_mmhg: 190, bp_diastolic_mmhg: 105 }, { ageYears: 62 }), 3, 'Clinical judgement: pressure of 180+ should be reviewed the same day; NEWS2 does not score it', { gap: true }),
  c('S04', 'india_scenarios', 'Camp: woman 55, all normal', adult({}, { ageYears: 55 }), 4, `${N2}: score 0`),
  c('S05', 'india_scenarios', 'ANC visit, 28 weeks, normal', preg(), 4, 'No danger sign'),
  c('S06', 'india_scenarios', 'Farm worker 45, pulse 52, otherwise normal', adult({ pulse_bpm: 52 }, { ageYears: 45 }), 4, `${N2}: score 0`),
  c('S07', 'india_scenarios', 'Fever 39.2 with breathing 25 (outbreak visit)', adult({ temperature_c: 39.2, resp_rate_pm: 25 }, { ageYears: 30 }), 2, `${N2}: score 5 (2+3)`),
];
