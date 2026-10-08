import { describe, expect, it } from 'vitest';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED as PROP } from '../src/triage/ruleset.proposed.js';
import { questionCodes } from '../../aarogyarekha2-frontend/src/i18n/questions.js';

describe('patient-language questions cover the rule set', () => {
  it('every sign in the rule set has a Hindi and Odia question (so a new sign cannot ship without one)', () => {
    const have = new Set(questionCodes());
    expect([...RS.floors, ...PROP.floors].filter(f => !have.has('sign.' + f.sign)).map(f => f.sign)).toEqual([]);
  });
});
