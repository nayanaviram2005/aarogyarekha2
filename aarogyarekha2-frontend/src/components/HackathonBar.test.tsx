import { describe, expect, it } from 'vitest';
import { HACKATHON_MESSAGE, RULES_CLINICALLY_VALIDATED, SHOW_HACKATHON_BAR } from '../config';

describe('hackathon bar', () => {
  it('is on, and the rules are recorded as NOT clinically validated, until someone changes that on purpose', () => {
    expect(SHOW_HACKATHON_BAR).toBe(true);
    expect(RULES_CLINICALLY_VALIDATED).toBe(false);
  });
  it('says what a visitor must know: hackathon, synthetic data, rules not validated, not for real patients, non-diagnostic', () => {
    for (const phrase of ['HACKATHON PROTOTYPE', 'Synthetic data only', 'NOT been clinically validated', 'Not for use with real patients', 'Does not diagnose or advise treatment'])
      expect(HACKATHON_MESSAGE).toContain(phrase);
  });
});
