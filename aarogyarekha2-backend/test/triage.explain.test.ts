import { describe, expect, it } from 'vitest';
import { triage } from '../src/triage/engine.js';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import { assertNoteNonDiagnostic } from '../src/guard/nonDiagnostic.js';
import type { TriageInput } from '../src/triage/types.js';

const base = (o: Partial<TriageInput> = {}): TriageInput => ({ ageYears: 40, pregnant: false, vitals: {}, consciousness: 'alert', onSupplementalOxygen: false, signs: {}, ...o });
const entry = (i: TriageInput, ruleId: string) => triage(i, RS).log.find(l => l.ruleId === ruleId)!;

describe('every rule that fires says where it comes from and how it relates to this case', () => {
  it('a danger sign names its question and its source', () => {
    const e = entry(base({ signs: { severe_respiratory_distress: true } }), 'ETAT-E2');
    expect(e.source).toBe('WHO ETAT emergency signs');
    expect(e.why).toContain('Marked Yes for: "Is the patient struggling severely to breathe');
  });

  it('the early-warning score lists the measurements that earned points', () => {
    const e = entry(base({ vitals: { resp_rate_pm: 22, spo2_pct: 94, pulse_bpm: 72, bp_systolic_mmhg: 120, temperature_c: 37 } }), 'NEWS2');
    expect(e.why).toContain('Respiratory rate 22 per minute: 2 points');
    expect(e.why).toContain('Oxygen saturation 94%: 1 point');
    expect(e.why).toContain('Total 3');
    expect(e.source).toContain('NEWS2');
  });

  it('a child’s vital-sign limit names the age and the value', () => {
    const e = entry(base({ ageYears: 6, vitals: { spo2_pct: 90 } }), 'PAED-VITALS');
    expect(e.why).toContain('6 years old');
    expect(e.why).toContain('Oxygen saturation 90% is below 92%');
    expect(e.source).toContain('Emergency Severity Index');
  });

  it('pregnancy blood pressure shows the recorded reading and the limit', () => {
    const e = entry(base({ pregnant: true, vitals: { bp_systolic_mmhg: 170, bp_diastolic_mmhg: 100 } }), 'WHO-PREG-BP');
    expect(e.why).toContain('170/100');
    expect(e.why).toContain('160/110');
  });

  it('the extended check is shown as the triage engine and never as an AI opinion', () => {
    const d = triage(base({ externalHints: [{ code: 'ai_second_opinion', tier: 2, source: 'external_secondary' }] }), RS);
    const e = d.log.find(l => l.layer === 'external')!;
    expect(e.detail).toBe('Extended check of the case details');
    expect(e.source).toBe('Triage engine extended check');
    const shown = d.signals.filter(s => s.kind === 'external_hint').map(s => s.display_text).concat(d.log.filter(l => l.layer === 'external').flatMap(l => [l.detail, l.source ?? '', l.why ?? '']));
    expect(shown.join(' ')).not.toMatch(/ai_second_opinion|\bAI\b|opinion/i);
  });

  it('the default and the nothing-recorded rules explain themselves', () => {
    expect(entry(base({ vitals: {}, consciousness: null, onSupplementalOxygen: null }), 'DEFAULT').why).toContain('None of the checks');
    expect(entry(base({ vitals: {}, consciousness: null, onSupplementalOxygen: null }), 'INSUFFICIENT').why).toContain('Nothing has been measured');
  });

  it('none of this text trips the non-diagnostic guard that protects stored assessments', () => {
    const d = triage(base({ ageYears: 6, vitals: { spo2_pct: 88, pulse_bpm: 150 }, signs: { breathing_difficulty_not_severe: true }, externalHints: [{ code: 'ai_second_opinion', tier: 2, source: 'external_secondary' }] }), RS);
    expect(() => assertNoteNonDiagnostic(d.log)).not.toThrow();
    const adult = triage(base({ vitals: { resp_rate_pm: 30, spo2_pct: 88 }, pregnant: false }), RS);
    expect(() => assertNoteNonDiagnostic(adult.log)).not.toThrow();
    const preg = triage(base({ pregnant: true, vitals: { bp_systolic_mmhg: 170 } }), RS);
    expect(() => assertNoteNonDiagnostic(preg.log)).not.toThrow();
  });
});
