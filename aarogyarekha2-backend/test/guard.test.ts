import { describe, expect, it } from 'vitest';
import { assertNoteNonDiagnostic, assertNonDiagnostic, checkNonDiagnostic, NonDiagnosticViolation } from '../src/guard/nonDiagnostic.js';

const blocked = [
  'Diagnosis: dengue fever',
  'The patient was diagnosed with typhoid.',
  'Patient is suffering from pneumonia.',
  'Findings are consistent with malaria.',
  'This is likely dengue given the fever pattern.',
  'Suspected tuberculosis, needs further tests.',
  'Patient has diabetes.',
  'Give paracetamol 500 mg every 6 hours.',
  'Prescribe amoxicillin.',
  'She should take iron tablets daily.',
  'We recommend antibiotics for this.',
  'Start on a course of treatment today.',
  'Take 2 tablets after food.',
  'Differential includes sepsis.',
];

const allowed = [
  'Fever for 3 days, started evening of 2 October.',
  'Patient reports cough and breathlessness on climbing stairs.',
  'Temperature 38.6 °C, pulse 104 per minute (as recorded).',
  'Missing: duration of cough, pregnancy status, recent travel.',
  'Ask whether the child is drinking fluids and passing urine.',
  'Urgency signals: breathlessness reported; SpO2 not recorded.',
  'No prior hospital visits reported.',
  'Lab report lists haemoglobin 9.1 g/dL; flagged low by the printed reference range.',
];

describe('non-diagnostic guard: must block', () => {
  it.each(blocked)('%s', text => {
    const r = checkNonDiagnostic(text);
    expect(r.allowed, JSON.stringify(r.findings)).toBe(false);
  });
});

describe('non-diagnostic guard: must allow ordinary triage language', () => {
  it.each(allowed)('%s', text => {
    const r = checkNonDiagnostic(text);
    expect(r.allowed, JSON.stringify(r.findings)).toBe(true);
  });
});

describe('non-diagnostic guard: warn vs block', () => {
  it('reported history is allowed but warned, not blocked', () => {
    const r = checkNonDiagnostic('Patient reports a history of diabetes and takes insulin (as told by the patient).');
    expect(r.allowed).toBe(true);
    expect(r.findings.map(f => f.rule)).toEqual(expect.arrayContaining(['W1-disease-mention', 'W2-drug-mention']));
    expect(r.findings.every(f => f.severity === 'warn')).toBe(true);
  });

  it('a dose is blocked even when the drug is only reported', () => {
    expect(checkNonDiagnostic('Takes metformin 500 mg twice daily.').allowed).toBe(false);
  });
});

describe('assert helpers', () => {
  it('assertNonDiagnostic returns clean text unchanged', () => {
    expect(assertNonDiagnostic('Cough for 5 days.')).toBe('Cough for 5 days.');
  });

  it('assertNonDiagnostic throws a typed error carrying the findings', () => {
    expect(() => assertNonDiagnostic('Diagnosis: malaria')).toThrow(NonDiagnosticViolation);
  });

  it('assertNoteNonDiagnostic finds a violation nested in a structured note and reports its path', () => {
    const note = { summary: 'Fever 3 days', followUps: ['Ask about travel', { q: 'Patient has dengue' }] };
    try {
      assertNoteNonDiagnostic(note);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NonDiagnosticViolation);
      expect((e as NonDiagnosticViolation).findings.some(f => f.rule.includes('$.followUps[1].q'))).toBe(true);
    }
  });

  it('assertNoteNonDiagnostic accepts a clean structured note', () => {
    expect(() => assertNoteNonDiagnostic({ summary: 'Fever 3 days', missing: ['pregnancy status'], n: 3, ok: true, none: null })).not.toThrow();
  });
});
