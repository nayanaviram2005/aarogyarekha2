import { describe, expect, it } from 'vitest';
import { triage } from '../src/triage/engine.js';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import { askableFloors } from '../src/triage/relevance.js';
import type { TriageInput } from '../src/triage/types.js';

const kid = (ageYears: number | null, vitals: TriageInput['vitals'] = {}, signs: TriageInput['signs'] = {}): TriageInput => ({
  ageYears, pregnant: false, vitals, consciousness: null, onSupplementalOxygen: null, signs,
});
const layers = (i: TriageInput) => triage(i, RS).log.map(l => l.layer);

describe('children get age-banded vital-sign limits', () => {
  it('a 6-year-old with oxygen 90% is raised to very urgent, and the reason names the limit', () => {
    const d = triage(kid(6, { spo2_pct: 90, pulse_bpm: 130 }), RS);
    expect(d.tier).toBe(2);
    expect(d.winning).toMatchObject({ layer: 'paed_vitals', ruleId: 'PAED-VITALS' });
    expect(d.winning.detail).toContain('below 92%');
    expect(d.signals.some(s => s.signal_code === 'vital.paed_spo2_pct')).toBe(true);
  });

  it('oxygen below 90% is immediate', () => {
    expect(triage(kid(6, { spo2_pct: 89 }), RS).tier).toBe(1);
    expect(triage(kid(6, { spo2_pct: 90 }), RS).tier).toBe(2);
    expect(triage(kid(6, { spo2_pct: 92 }), RS).tier).toBe(4);
  });

  it.each<[string, number, number, number | null]>([
    ['2 months, pulse over 180', 0.17, 185, 2],
    ['2 months, pulse 180', 0.17, 180, null],
    ['2 years, pulse over 160', 2, 165, 2],
    ['2 years, pulse 160', 2, 160, null],
    ['6 years, pulse over 140', 6, 145, 2],
    ['6 years, pulse 140', 6, 140, null],
    ['10 years, pulse over 100', 10, 105, 2],
    ['10 years, pulse 100', 10, 100, null],
  ])('%s', (_label, age, pulse, tier) => {
    const d = triage(kid(age, { pulse_bpm: pulse }), RS);
    if (tier == null) expect(layers(kid(age, { pulse_bpm: pulse }))).not.toContain('paed_vitals');
    else { expect(d.tier).toBe(tier); expect(d.winning.layer).toBe('paed_vitals'); }
  });

  it.each<[number, number, boolean]>([[0.17, 51, true], [0.17, 50, false], [2, 41, true], [2, 40, false], [6, 31, true], [6, 30, false], [10, 21, true], [10, 20, false]])(
    'age %s, breathing rate %s is flagged: %s', (age, rr, flagged) => {
      expect(layers(kid(age, { resp_rate_pm: rr })).includes('paed_vitals')).toBe(flagged);
    });

  it('says nothing when the child has no measurements, or the age is unknown', () => {
    expect(layers(kid(6))).not.toContain('paed_vitals');
    expect(layers(kid(null, { spo2_pct: 80 }))).not.toContain('paed_vitals');
  });

  it('stops at 16, where the adult early-warning score takes over', () => {
    const d = triage(kid(16, { spo2_pct: 90, pulse_bpm: 105 }), RS);
    expect(d.log.map(l => l.layer)).not.toContain('paed_vitals');
    expect(d.news2.applicable).toBe(true);
  });

  it('only ever raises the priority', () => {
    const base = triage(kid(6, { pulse_bpm: 100 }, { severe_respiratory_distress: true }), RS);
    const worse = triage(kid(6, { pulse_bpm: 100, spo2_pct: 91 }, { severe_respiratory_distress: true }), RS);
    expect(base.tier).toBe(1);
    expect(worse.tier).toBe(1);
  });
});

describe('the WHO triage-chart signs apply to every child under 16', () => {
  const askable = (age: number) => askableFloors(kid(age), RS).map(f => f.sign);

  it('a 6-year-old is asked the priority-sign questions, not just the five emergency ones', () => {
    const s = askable(6);
    expect(s).toEqual(expect.arrayContaining(['breathing_difficulty_not_severe', 'severe_pain', 'poisoning_reported', 'major_trauma_or_burns', 'severe_pallor', 'severe_fluid_loss_signs']));
    expect(s.length).toBeGreaterThan(5);
  });

  it('a Yes to some breathing difficulty gives a 6-year-old the urgent level', () => {
    const d = triage(kid(6, {}, { breathing_difficulty_not_severe: true }), RS);
    expect(d.tier).toBe(3);
    expect(d.winning.ruleId).toBe('ETAT-P7');
  });

  it('the under-5 danger signs stay under 5', () => {
    expect(askable(6)).not.toContain('lethargic');
    expect(askable(4)).toContain('lethargic');
    expect(layers(kid(6, {}, { lethargic: true }))).not.toContain('floor');
  });

  it('a 16-year-old is not treated as a child', () => {
    expect(askable(16)).not.toContain('severe_pain');
  });
});

describe('a child with measurements still to take is asked for them', () => {
  const codes = (i: TriageInput) => triage(i, RS).missing.map(m => m.code);

  it('asks for pulse, breathing rate and oxygen when none are recorded, with what each could change', () => {
    const d = triage(kid(6), RS);
    expect(d.missing.filter(m => m.code.startsWith('vital.')).map(m => m.code).sort()).toEqual(['vital.pulse_bpm', 'vital.resp_rate_pm', 'vital.spo2_pct']);
    expect(d.potentialTier).not.toBeNull();
    expect(d.potentialTier!).toBeLessThan(d.tier);
  });

  it('asks only for the ones still missing, and for none once all three are taken', () => {
    expect(codes(kid(6, { spo2_pct: 97 })).filter(c => c.startsWith('vital.')).sort()).toEqual(['vital.pulse_bpm', 'vital.resp_rate_pm']);
    expect(codes(kid(6, { spo2_pct: 97, pulse_bpm: 100, resp_rate_pm: 24 })).filter(c => c.startsWith('vital.'))).toEqual([]);
  });

  it('works for infants and does not apply from 16, where the early-warning score asks instead', () => {
    expect(codes(kid(0.5)).filter(c => c.startsWith('vital.'))).toContain('vital.spo2_pct');
    expect(codes(kid(16)).filter(c => c.startsWith('vital.'))).toContain('vital.spo2_pct');
    expect(codes(kid(null)).filter(c => c.startsWith('vital.'))).toEqual([]);
  });

  it('never changes the priority itself', () => {
    expect(triage(kid(6, { spo2_pct: 99 }), RS).tier).toBe(triage(kid(6, { spo2_pct: 99, pulse_bpm: 90, resp_rate_pm: 20 }), RS).tier);
  });
});
