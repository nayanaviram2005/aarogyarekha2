import { describe, expect, it } from 'vitest';
import { hashRuleSet, triage, canonicalJson } from '../src/triage/engine.js';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import type { Tier, TriageInput } from '../src/triage/types.js';
import { checkNonDiagnostic } from '../src/guard/nonDiagnostic.js';

const NORMAL_ADULT_VITALS = { resp_rate_pm: 16, spo2_pct: 98, bp_systolic_mmhg: 120, bp_diastolic_mmhg: 80, pulse_bpm: 72, temperature_c: 37.0 };
const adult = (over: Partial<TriageInput> = {}): TriageInput => ({
  ageYears: 40, pregnant: false, vitals: { ...NORMAL_ADULT_VITALS }, consciousness: 'alert', onSupplementalOxygen: false,
  signs: { airway_obstructed_or_not_breathing: false }, ...over,
});
const tierOf = (i: TriageInput) => triage(i, RS).tier;
const withVitals = (v: Record<string, number>) => adult({ vitals: { ...NORMAL_ADULT_VITALS, ...v } });

describe('NEWS2 layer: hand-checked cases (adult)', () => {
  it('all normal -> score 0 -> T4', () => {
    const d = triage(adult(), RS);
    expect(d.news2).toMatchObject({ applicable: true, score: 0 });
    expect(d.tier).toBe(4);
    expect(d.urgencyCode).toBe('green');
  });

  it('RR 22(2) + SpO2 94(1) + SBP 105(1) + pulse 105(1) + temp 38.5(1) = 6 -> medium -> T2', () => {
    const d = triage(withVitals({ resp_rate_pm: 22, spo2_pct: 94, bp_systolic_mmhg: 105, pulse_bpm: 105, temperature_c: 38.5 }), RS);
    expect(d.news2.score).toBe(6);
    expect(d.tier).toBe(2);
    expect(d.winning.layer).toBe('news2');
  });

  it('score 12 -> T1', () => {
    const d = triage(withVitals({ resp_rate_pm: 28, spo2_pct: 88, bp_systolic_mmhg: 85, pulse_bpm: 140 }), RS);
    expect(d.news2.score).toBe(12);
    expect(d.tier).toBe(1);
  });

  it('a single parameter in the highest band (score 3) escalates even when the total is only 3', () => {
    const d = triage(withVitals({ resp_rate_pm: 8 }), RS);
    expect(d.news2.score).toBe(3);
    expect(d.tier).toBe(2);
  });

  it('a low score of 1 maps to T3 (conservative local mapping)', () => {
    expect(tierOf(withVitals({ temperature_c: 38.5 }))).toBe(3);
  });

  it('reduced consciousness scores 3 and escalates by itself', () => {
    const d = triage(adult({ consciousness: 'voice' }), RS);
    expect(d.news2.score).toBe(3);
    expect(d.tier).toBe(2);
  });

  it('supplemental oxygen adds 2', () => {
    expect(triage(adult({ onSupplementalOxygen: true }), RS).news2.score).toBe(2);
  });

  it.each<[string, number, number]>([
    ['temperature_c', 35.0, 3], ['temperature_c', 35.1, 1], ['temperature_c', 36.0, 1], ['temperature_c', 36.1, 0],
    ['temperature_c', 38.0, 0], ['temperature_c', 38.1, 1], ['temperature_c', 39.0, 1], ['temperature_c', 39.1, 2],
    ['spo2_pct', 91, 3], ['spo2_pct', 92, 2], ['spo2_pct', 93, 2], ['spo2_pct', 94, 1], ['spo2_pct', 95, 1], ['spo2_pct', 96, 0],
    ['bp_systolic_mmhg', 90, 3], ['bp_systolic_mmhg', 91, 2], ['bp_systolic_mmhg', 100, 2], ['bp_systolic_mmhg', 101, 1],
    ['bp_systolic_mmhg', 110, 1], ['bp_systolic_mmhg', 111, 0], ['bp_systolic_mmhg', 219, 0], ['bp_systolic_mmhg', 220, 3],
    ['pulse_bpm', 40, 3], ['pulse_bpm', 41, 1], ['pulse_bpm', 50, 1], ['pulse_bpm', 51, 0], ['pulse_bpm', 90, 0],
    ['pulse_bpm', 91, 1], ['pulse_bpm', 110, 1], ['pulse_bpm', 111, 2], ['pulse_bpm', 130, 2], ['pulse_bpm', 131, 3],
    ['resp_rate_pm', 8, 3], ['resp_rate_pm', 9, 1], ['resp_rate_pm', 11, 1], ['resp_rate_pm', 12, 0],
    ['resp_rate_pm', 20, 0], ['resp_rate_pm', 21, 2], ['resp_rate_pm', 24, 2], ['resp_rate_pm', 25, 3],
  ])('band edge: %s = %s scores %s', (param, value, points) => {
    expect(triage(withVitals({ [param]: value }), RS).news2.score).toBe(points);
  });

  it('is not applied to a child or to a pregnant patient', () => {
    expect(triage(adult({ ageYears: 10 }), RS).news2.applicable).toBe(false);
    expect(triage(adult({ pregnant: true }), RS).news2.applicable).toBe(false);
    expect(triage(adult({ ageYears: 15.9 }), RS).news2.applicable).toBe(false);
    expect(triage(adult({ ageYears: 16 }), RS).news2.applicable).toBe(true);
  });
});

describe('danger-sign floors', () => {
  it('an ETAT emergency sign gives T1 even with perfectly normal vitals', () => {
    const d = triage(adult({ signs: { central_cyanosis: true } }), RS);
    expect(d.tier).toBe(1);
    expect(d.winning).toMatchObject({ layer: 'floor', ruleId: 'ETAT-E3' });
    expect(d.signals.find(s => s.kind === 'red_flag')?.evidence).toMatchObject({ rule: 'ETAT-E3' });
  });

  it('an IMNCI general danger sign in a child gives T2', () => {
    const d = triage({ ageYears: 3, pregnant: false, vitals: {}, signs: { vomits_everything: true } }, RS);
    expect(d.tier).toBe(2);
    expect(d.winning.ruleId).toBe('IMNCI-G2');
  });

  it('an ETAT priority sign in a child gives T3', () => {
    expect(triage({ ageYears: 2, pregnant: false, vitals: {}, signs: { severe_pain: true } }, RS).tier).toBe(3);
  });

  it('child-only signs do not fire for an adult', () => {
    expect(tierOf(adult({ signs: { vomits_everything: true, severe_pain: true } }))).toBe(4);
  });

  it('pregnancy danger signs: convulsions T1, headache with blurred vision T2', () => {
    const base = { ageYears: 27, pregnant: true, vitals: {}, signs: {} as TriageInput['signs'] };
    expect(tierOf({ ...base, signs: { convulsions_in_pregnancy: true } })).toBe(1);
    expect(tierOf({ ...base, signs: { severe_headache_blurred_vision: true } })).toBe(2);
  });

  it('pregnancy-only signs do not fire when not pregnant', () => {
    expect(tierOf(adult({ signs: { heavy_vaginal_bleeding: true } }))).toBe(4);
  });

  it('severe-range blood pressure in pregnancy gives T2 from either reading', () => {
    const p = (sbp: number, dbp: number): TriageInput => ({ ageYears: 28, pregnant: true, vitals: { bp_systolic_mmhg: sbp, bp_diastolic_mmhg: dbp }, signs: { any_vaginal_bleeding: false } });
    expect(triage(p(160, 90), RS)).toMatchObject({ tier: 2 });
    expect(tierOf(p(130, 110))).toBe(2);
    expect(triage(p(159, 109), RS).tier).toBeGreaterThan(2);
    expect(triage(p(160, 90), RS).winning.layer).toBe('pregnancy_bp');
  });

  it('a danger sign that is true still fires when age is unknown (escalate-only)', () => {
    const d = triage({ ageYears: null, pregnant: null, vitals: {}, signs: { vomits_everything: true } }, RS);
    expect(d.tier).toBe(2);
    expect(d.missing.some(m => m.code === 'context.age')).toBe(true);
  });
});

describe('missing data is never read as normal', () => {
  it('nothing assessed at all -> insufficient-data tier, not the lowest tier', () => {
    const d = triage({ ageYears: 30, pregnant: false, vitals: {}, signs: {} }, RS);
    expect(d.insufficientData).toBe(true);
    expect(d.tier).toBe(3);
    expect(d.winning.layer).toBe('insufficient_data');
  });

  it('an unrecorded SpO2 keeps the confirmed tier but exposes a potential tier, capped at one step', () => {
    const d = triage(adult({ vitals: { ...NORMAL_ADULT_VITALS, spo2_pct: undefined } }), RS);
    expect(d.tier).toBe(4);
    expect(d.potentialTier).toBe(3);
    const m = d.missing.find(x => x.code === 'vital.spo2_pct');
    expect(m).toBeDefined();
    expect(m?.potentialTier).toBe(3);
  });

  it('complete data and every sign answered -> no potential tier', () => {
    const allFalse = Object.fromEntries(RS.floors.filter(f => f.population === 'any').map(f => [f.sign, false]));
    const d = triage(adult({ signs: allFalse }), RS);
    expect(d.potentialTier).toBeNull();
    expect(d.missing).toEqual([]);
  });

  it('unassessed danger signs in a child produce follow-up items ranked by what they could change', () => {
    const d = triage({ ageYears: 3, pregnant: false, vitals: { temperature_c: 37 }, signs: { vomits_everything: false } }, RS);
    expect(d.tier).toBe(4);
    const codes = d.missing.filter(m => m.potentialTier != null).map(m => m.code);
    expect(codes).toContain('sign.central_cyanosis');
    expect(d.missing.find(m => m.code === 'sign.vomits_everything')).toBeUndefined();
    expect(d.potentialTier).toBe(3);
  });

  it('an answered "no" is different from not asked', () => {
    const asked = triage({ ageYears: 3, pregnant: false, vitals: {}, signs: { central_cyanosis: false } }, RS);
    const notAsked = triage({ ageYears: 3, pregnant: false, vitals: {}, signs: {} }, RS);
    expect(asked.missing.some(m => m.code === 'sign.central_cyanosis')).toBe(false);
    expect(notAsked.missing.some(m => m.code === 'sign.central_cyanosis')).toBe(true);
  });

  it('records unknown age and unknown pregnancy status as missing context', () => {
    const d = triage({ ageYears: null, pregnant: null, vitals: { temperature_c: 37 }, signs: {} }, RS);
    expect(d.missing.map(m => m.code)).toEqual(expect.arrayContaining(['context.age', 'context.pregnancy_status']));
  });
});

describe('escalate-only guarantee', () => {
  it('an external hint can raise urgency', () => {
    const d = triage(adult({ externalHints: [{ code: 'model_concern', tier: 2, source: 'external_secondary' }] }), RS);
    expect(d.tier).toBe(2);
    expect(d.winning.layer).toBe('external');
  });

  it('an external hint can never lower urgency', () => {
    const d = triage(adult({ signs: { central_cyanosis: true }, externalHints: [{ code: 'looks_fine', tier: 4, source: 'external_primary' }] }), RS);
    expect(d.tier).toBe(1);
  });

  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const allSigns = [...new Set(RS.floors.map(f => f.sign))];
  const randomInput = (r: () => number): TriageInput => {
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    const maybe = (x: number) => (r() < 0.25 ? undefined : x);
    const signs: TriageInput['signs'] = {};
    for (const s of allSigns) { const x = r(); if (x < 0.15) signs[s] = true; else if (x < 0.5) signs[s] = false; }
    return {
      ageYears: pick([null, 0.1, 1, 3, 10, 15, 16, 30, 66, 90]), pregnant: pick([null, true, false, false]),
      vitals: { resp_rate_pm: maybe(6 + r() * 30), spo2_pct: maybe(80 + r() * 20), bp_systolic_mmhg: maybe(70 + r() * 170), bp_diastolic_mmhg: maybe(40 + r() * 90), pulse_bpm: maybe(30 + r() * 130), temperature_c: maybe(34 + r() * 7) },
      consciousness: pick([null, 'alert', 'alert', 'voice', 'pain', 'unresponsive']), onSupplementalOxygen: pick([null, true, false]),
      signs,
    };
  };

  it('PROPERTY: marking any additional danger sign present never lowers the tier (400 random cases)', () => {
    const r = rng(20261006);
    for (let n = 0; n < 400; n++) {
      const i = randomInput(r);
      const before = tierOf(i);
      const sign = allSigns[Math.floor(r() * allSigns.length)]!;
      const after = tierOf({ ...i, signs: { ...i.signs, [sign]: true } });
      expect(after, `seed case ${n}, sign ${sign}`).toBeLessThanOrEqual(before);
    }
  });

  it('PROPERTY: any external hint never lowers the tier (400 random cases)', () => {
    const r = rng(7);
    for (let n = 0; n < 400; n++) {
      const i = randomInput(r);
      const before = tierOf(i);
      const hint = { code: 'x', tier: (1 + Math.floor(r() * 4)) as Tier, source: 'external_secondary' as const };
      expect(tierOf({ ...i, externalHints: [hint] }), `case ${n}`).toBeLessThanOrEqual(before);
    }
  });

  it('PROPERTY: the potential tier is always more urgent than the confirmed tier and never more than one step away', () => {
    const r = rng(99);
    for (let n = 0; n < 400; n++) {
      const d = triage(randomInput(r), RS);
      if (d.potentialTier != null) {
        expect(d.potentialTier).toBeLessThan(d.tier);
        expect(d.tier - d.potentialTier).toBeLessThanOrEqual(RS.potentialTierCap);
      }
      expect(d.tier).toBeGreaterThanOrEqual(1); expect(d.tier).toBeLessThanOrEqual(4);
    }
  });

  it('PROPERTY: worsening one vital never lowers the tier (adult NEWS2 + floors, 400 cases)', () => {
    const r = rng(5);
    for (let n = 0; n < 400; n++) {
      const i = { ...randomInput(r), ageYears: 40, pregnant: false as const };
      const before = tierOf(i);
      const worse = { ...i, vitals: { ...i.vitals, spo2_pct: 85 } };
      expect(tierOf(worse), `case ${n}`).toBeLessThanOrEqual(before);
    }
  });
});

describe('queue context and output contract', () => {
  it('flags vulnerable patients: young child, older adult, pregnant; not a healthy adult', () => {
    const base = { vitals: { temperature_c: 37 }, signs: {} as TriageInput['signs'] };
    expect(triage({ ...base, ageYears: 3, pregnant: false }, RS).vulnerable).toBe(true);
    expect(triage({ ...base, ageYears: 70, pregnant: false }, RS).vulnerable).toBe(true);
    expect(triage({ ...base, ageYears: 28, pregnant: true }, RS).vulnerable).toBe(true);
    expect(triage({ ...base, ageYears: 30, pregnant: false }, RS).vulnerable).toBe(false);
  });

  it('maps tiers to the seeded urgency codes', () => {
    expect([1, 2, 3, 4].map(t => ({ 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green' } as const)[t as Tier])).toEqual(['red', 'orange', 'yellow', 'green']);
    expect(triage(adult({ signs: { central_cyanosis: true } }), RS).urgencyCode).toBe('red');
  });

  it('is deterministic and the fingerprint ignores key order', () => {
    const a = adult({ signs: { central_cyanosis: false, severe_respiratory_distress: false } });
    const b = adult({ signs: { severe_respiratory_distress: false, central_cyanosis: false } });
    expect(triage(a, RS)).toEqual(triage(a, RS));
    expect(triage(a, RS).inputFingerprint).toBe(triage(b, RS).inputFingerprint);
    expect(triage(adult({ consciousness: 'voice' }), RS).inputFingerprint).not.toBe(triage(a, RS).inputFingerprint);
  });

  it('stamps rule set name, version, status and integrity hash on every decision', () => {
    const d = triage(adult(), RS);
    expect(d.ruleSet).toMatchObject({ name: 'aarogyarekha-layered', version: RS.version, status: 'draft' });
    expect(d.ruleSet.hash).toBe(hashRuleSet(RS));
    expect(d.ruleSet.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every emitted signal fits the triage_signals constraints', () => {
    const d = triage({ ageYears: 28, pregnant: true, vitals: { bp_systolic_mmhg: 165 }, signs: { heavy_vaginal_bleeding: true }, externalHints: [{ code: 'Some Hint!', tier: 2, source: 'external_secondary' }] }, RS);
    expect(d.signals.length).toBeGreaterThan(1);
    for (const s of d.signals) {
      expect(s.signal_code).toMatch(/^[a-z][a-z0-9_.]{2,63}$/);
      expect(['red_flag', 'abnormal_vital', 'missing_information', 'duration', 'risk_context', 'external_hint']).toContain(s.kind);
      expect(['rule', 'external_secondary', 'external_primary', 'manual', 'missing_data']).toContain(s.source);
    }
  });

  it('the decision log explains the outcome: it contains the winning entry and is ordered most urgent first', () => {
    const d = triage(adult({ signs: { central_cyanosis: true }, vitals: { ...NORMAL_ADULT_VITALS, temperature_c: 38.5 } }), RS);
    expect(d.log[0]).toEqual(d.winning);
    expect(d.log.map(l => l.tier)).toEqual([...d.log.map(l => l.tier)].sort((a, b) => a - b));
  });
});

describe('rule set integrity and wording', () => {
  it('is a DRAFT: it must not be usable until a human approves it', () => {
    expect(RS.status).toBe('draft');
    expect(RS.provenance).toMatch(/memory/i);
  });

  it('has unique rule ids and a source on every rule', () => {
    const ids = RS.floors.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of RS.floors) { expect(f.source.length).toBeGreaterThan(3); expect(f.label.length).toBeGreaterThan(3); }
  });

  it('the integrity hash changes if any threshold is edited', () => {
    const edited = structuredClone(RS); edited.news2.bands.spo2_pct[0]!.upTo = 90;
    expect(hashRuleSet(edited)).not.toBe(hashRuleSet(RS));
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('every reviewer-facing label passes the non-diagnostic guard', () => {
    const texts = [...RS.floors.map(f => f.label), RS.pregnancyHypertension.label];
    for (const t of texts) expect(checkNonDiagnostic(t).allowed, t).toBe(true);
  });

  it('every signal text the engine can emit passes the non-diagnostic guard', () => {
    const d = triage({ ageYears: 40, pregnant: false, vitals: { resp_rate_pm: 28, spo2_pct: 88, bp_systolic_mmhg: 85, pulse_bpm: 140, temperature_c: 39.5 }, consciousness: 'pain', onSupplementalOxygen: true, signs: { central_cyanosis: true } }, RS);
    for (const s of d.signals) expect(checkNonDiagnostic(s.display_text).allowed, s.display_text).toBe(true);
  });
});
