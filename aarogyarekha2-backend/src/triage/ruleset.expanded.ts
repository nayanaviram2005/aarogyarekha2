import { BANK_FLOORS } from './questionBank.js';
import { RULESET_PROPOSED } from './ruleset.proposed.js';
import type { RuleSet } from './types.js';

export const RULESET_EXPANDED: RuleSet = {
  ...RULESET_PROPOSED,
  version: '0.3.0',
  provenance:
    'v0.3.0 widens the question list of v0.2.1 with local additions grouped by body system, so a patient is asked only the few questions that fit the complaint. ' +
    'The new questions and their priorities were written locally, are not from a published list, and have not been reviewed by a clinician. ' +
    'Not approved for real patients. Synthetic data only.',
  floors: [...RULESET_PROPOSED.floors, ...BANK_FLOORS],
};
