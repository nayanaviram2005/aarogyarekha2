// AarogyaRekha triage engine: types. Review-priority labels only. Nothing here diagnoses or advises treatment.

/** 1 = most urgent. Maps onto the seeded urgency_levels (red/orange/yellow/green). */
export type Tier = 1 | 2 | 3 | 4;
export const TIER_TO_URGENCY: Record<Tier, 'red' | 'orange' | 'yellow' | 'green'> = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green' };

/** ACVPU. Anything other than 'alert' scores as new confusion / reduced consciousness. */
export type Consciousness = 'alert' | 'confusion' | 'voice' | 'pain' | 'unresponsive';

export interface TriageInput {
  ageYears: number | null;               // fractional for infants (e.g. 0.5). null = unknown
  pregnant: boolean | null;              // null = unknown
  vitals: {
    temperature_c?: number | null; spo2_pct?: number | null; pulse_bpm?: number | null;
    resp_rate_pm?: number | null; bp_systolic_mmhg?: number | null; bp_diastolic_mmhg?: number | null;
  };
  consciousness?: Consciousness | null;
  onSupplementalOxygen?: boolean | null;
  /** sign code -> true (present) | false (asked, absent) | null/undefined (NOT assessed). Absence of an answer is never "no". */
  signs: Record<string, boolean | null | undefined>;
  /** When set, only these signs are listed as 'not yet assessed' and asked about. An answer to any sign still counts. Narrows the questions, never the rules. */
  relevantSigns?: string[] | null;
  /** Optional model / external suggestions. They can only RAISE urgency, never lower it. */
  externalHints?: { code: string; tier: Tier; source: 'external_secondary' | 'external_primary' }[];
}

export type Population = 'any' | 'child_under_5' | 'adult' | 'pregnant';

export interface FloorRule {
  id: string;
  sign: string;                          // key in TriageInput.signs
  tier: Tier;
  population: Population;
  label: string;                         // non-diagnostic wording shown to reviewers (checked by the guard in tests)
  question: string;                      // how to ask for this sign when it has not been assessed (follow-up question)
  source: string;                        // which published protocol this transcribes
}

export interface ScoreBand { upTo?: number; score: number }   // ordered; first band whose upTo >= value; last band has no upTo

export interface RuleSet {
  name: string;
  version: string;
  status: 'draft' | 'approved' | 'retired';
  provenance: string;                    // how it was authored and what still needs verification
  /** Applied when NOTHING was assessed at all (no vitals, no sign answered): never default to the lowest tier. */
  insufficientDataTier: Tier;
  /** A potential tier may be at most this many tiers more urgent than the confirmed tier. */
  potentialTierCap: number;
  floors: FloorRule[];
  pregnancyHypertension: { sbp: number; dbp: number; tier: Tier; id: string; label: string; source: string };
  news2: {
    minAgeYears: number;
    /** When true, a patient whose age is unknown (and not known to be pregnant) is scored as an adult, so a missing age never hides abnormal vitals. Off in v0.1.1. */
    applyWhenAgeUnknown?: boolean;
    source: string;
    bands: { resp_rate_pm: ScoreBand[]; spo2_pct: ScoreBand[]; bp_systolic_mmhg: ScoreBand[]; pulse_bpm: ScoreBand[]; temperature_c: ScoreBand[] };
    consciousnessNotAlert: number;
    supplementalOxygen: number;
    /** Highest possible contribution per parameter, used to bound the potential tier when it is missing. */
    maxPerParam: Record<'resp_rate_pm' | 'spo2_pct' | 'bp_systolic_mmhg' | 'pulse_bpm' | 'temperature_c' | 'consciousness' | 'oxygen', number>;
    tierMap: { aggregateHighMin: number; aggregateHighTier: Tier; aggregateMediumMin: number; aggregateMediumTier: Tier; singleRedScore: number; singleRedTier: Tier; lowMin: number; lowTier: Tier; zeroTier: Tier };
  };
  vulnerable: { ageUnder: number; ageOver: number };
}

export type SignalKind = 'red_flag' | 'abnormal_vital' | 'missing_information' | 'duration' | 'risk_context' | 'external_hint';
export type SignalSource = 'rule' | 'external_secondary' | 'external_primary' | 'manual' | 'missing_data';

/** Shaped to insert into public.triage_signals. */
export interface Signal {
  signal_code: string; kind: SignalKind; source: SignalSource; weight: number | null;
  display_text: string; evidence: Record<string, unknown>;
}

export interface DecisionLogEntry { layer: 'floor' | 'news2' | 'pregnancy_bp' | 'external' | 'insufficient_data' | 'default'; ruleId: string; tier: Tier; detail: string }

export interface TriageDecision {
  tier: Tier;
  urgencyCode: 'red' | 'orange' | 'yellow' | 'green';
  /** More urgent tier the case COULD be if the missing data came back worst-case. null when nothing is missing or it would not change the tier. */
  potentialTier: Tier | null;
  winning: DecisionLogEntry;
  log: DecisionLogEntry[];
  signals: Signal[];
  news2: { applicable: boolean; score: number | null; knownParams: string[]; missingParams: string[] };
  /** Information not yet collected. potentialTier = the tier this case could reach if that one answer came back worst-case (null if it would not change the tier). Use it to rank follow-up questions. */
  missing: { code: string; label: string; potentialTier: Tier | null }[];
  vulnerable: boolean;
  insufficientData: boolean;
  engineVersion: string;
  ruleSet: { name: string; version: string; status: string; hash: string };
  inputFingerprint: string;
}
