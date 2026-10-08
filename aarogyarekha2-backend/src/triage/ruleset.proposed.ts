// PROPOSED rule set v0.2.0. It is NOT in use: the database still holds v0.1.1, and the DB refuses any assessment against a rule set that
// has not been approved. This file exists so a clinician can read, change or reject each addition, and so the evaluation can show
// what would change (npm run eval:report compares both).
//
// What it adds to v0.1.1, and why (each is the build team's suggestion, taken from the product brief or from a gap our own
// evaluation found; none is from a published protocol list, and each needs a clinician's decision):
//   * chest pain (any age)                      -> T2   brief: "chest pain"
//   * stiff neck with fever (any age)           -> T2   brief: "high fever with a stiff neck"
//   * severe bleeding anywhere (any age)        -> T1   brief: "severe bleeding"
//   * adult major injury or burns               -> T2   v0.1.1 applies the ETAT priority signs to children under 5 only
//   * adult possible poisoning                  -> T2   same reason
//   * adult severe pain                         -> T3   same reason
//   * an unknown age no longer skips the adult score (applyWhenAgeUnknown)   evaluation case M03
//   * 50 more flags from a published six-level GP triage chart (see ruleset.chart.ts for the source, the tier mapping and its limits)
// Not added, because they need a clinical decision on which published tool to follow: scoring for children (PEWS) and pregnancy
// (MEOWS), raised-but-not-severe blood pressure in pregnancy, severe high blood pressure in an adult, and low oxygen in a child.
import { CHART_FLAGS } from './ruleset.chart.js';
import { RULESET_DRAFT } from './ruleset.draft.js';
import type { FloorRule, RuleSet } from './types.js';

const SRC = 'PROPOSED local addition (not from a published list); needs clinical review';
const added: FloorRule[] = [
  { id: 'PROP-C1', sign: 'chest_pain', tier: 2, population: 'any', label: 'Chest pain or heaviness', question: 'Does the patient have chest pain or heaviness in the chest?', source: SRC },
  { id: 'PROP-C2', sign: 'stiff_neck_with_fever', tier: 2, population: 'any', label: 'Stiff neck with fever', question: 'Is the neck stiff, with fever?', source: SRC },
  { id: 'PROP-C3', sign: 'severe_bleeding', tier: 1, population: 'any', label: 'Severe bleeding', question: 'Is there severe bleeding that will not stop, or that is soaking through cloth?', source: SRC },
  { id: 'PROP-A1', sign: 'adult_major_trauma_or_burns', tier: 2, population: 'adult', label: 'Major injury or burns (adult)', question: 'Has the patient had a major injury or burn?', source: SRC },
  { id: 'PROP-A2', sign: 'adult_poisoning_reported', tier: 2, population: 'adult', label: 'Possible poisoning (adult)', question: 'Could the patient have swallowed or breathed in something poisonous?', source: SRC },
  { id: 'PROP-A3', sign: 'adult_severe_pain', tier: 3, population: 'adult', label: 'Severe pain (adult)', question: 'Is the patient in severe pain?', source: SRC },
];

export const RULESET_PROPOSED: RuleSet = {
  ...RULESET_DRAFT,
  version: '0.2.0',
  provenance: 'PROPOSED additions to v0.1.1 (see the header of ruleset.proposed.ts). Not reviewed by a clinician. Not approved. Do not use for real patients.',
  floors: [...RULESET_DRAFT.floors, ...added, ...CHART_FLAGS],
  news2: { ...RULESET_DRAFT.news2, applyWhenAgeUnknown: true },
};
