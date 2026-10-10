export type Tier = 1 | 2 | 3 | 4;
export const TIER_TO_URGENCY: Record<Tier, 'red' | 'orange' | 'yellow' | 'green'> = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green' };

export type Consciousness = 'alert' | 'confusion' | 'voice' | 'pain' | 'unresponsive';

export interface TriageInput {
  ageYears: number | null;
  pregnant: boolean | null;
  vitals: {
    temperature_c?: number | null; spo2_pct?: number | null; pulse_bpm?: number | null;
    resp_rate_pm?: number | null; bp_systolic_mmhg?: number | null; bp_diastolic_mmhg?: number | null;
  };
  consciousness?: Consciousness | null;
  onSupplementalOxygen?: boolean | null;
  signs: Record<string, boolean | null | undefined>;
  relevantSigns?: string[] | null;
  externalHints?: { code: string; tier: Tier; source: 'external_secondary' | 'external_primary' }[];
}

export type Population = 'any' | 'child' | 'child_under_5' | 'adult' | 'pregnant';

export interface PaediatricBand { upToYears?: number; pulseAbove: number; respAbove: number }
export interface PaediatricVitals {
  id: string;
  source: string;
  bands: PaediatricBand[];
  spo2Below: number;
  spo2ImmediateBelow: number;
  dangerTier: Tier;
  immediateTier: Tier;
}

export interface FloorRule {
  id: string;
  sign: string;
  tier: Tier;
  population: Population;
  label: string;
  question: string;
  source: string;
}

export interface ScoreBand { upTo?: number; score: number }

export interface RuleSet {
  name: string;
  version: string;
  status: 'draft' | 'approved' | 'retired';
  provenance: string;
  insufficientDataTier: Tier;
  potentialTierCap: number;
  floors: FloorRule[];
  pregnancyHypertension: { sbp: number; dbp: number; tier: Tier; id: string; label: string; source: string };
  paediatricVitals?: PaediatricVitals;
  news2: {
    minAgeYears: number;
    applyWhenAgeUnknown?: boolean;
    source: string;
    bands: { resp_rate_pm: ScoreBand[]; spo2_pct: ScoreBand[]; bp_systolic_mmhg: ScoreBand[]; pulse_bpm: ScoreBand[]; temperature_c: ScoreBand[] };
    consciousnessNotAlert: number;
    supplementalOxygen: number;
    maxPerParam: Record<'resp_rate_pm' | 'spo2_pct' | 'bp_systolic_mmhg' | 'pulse_bpm' | 'temperature_c' | 'consciousness' | 'oxygen', number>;
    tierMap: { aggregateHighMin: number; aggregateHighTier: Tier; aggregateMediumMin: number; aggregateMediumTier: Tier; singleRedScore: number; singleRedTier: Tier; lowMin: number; lowTier: Tier; zeroTier: Tier };
  };
  vulnerable: { ageUnder: number; ageOver: number };
}

export type SignalKind = 'red_flag' | 'abnormal_vital' | 'missing_information' | 'duration' | 'risk_context' | 'external_hint';
export type SignalSource = 'rule' | 'external_secondary' | 'external_primary' | 'manual' | 'missing_data';

export interface Signal {
  signal_code: string; kind: SignalKind; source: SignalSource; weight: number | null;
  display_text: string; evidence: Record<string, unknown>;
}

export interface DecisionLogEntry { layer: 'floor' | 'news2' | 'paed_vitals' | 'pregnancy_bp' | 'external' | 'insufficient_data' | 'default'; ruleId: string; tier: Tier; detail: string; source?: string; why?: string }

export interface TriageDecision {
  tier: Tier;
  urgencyCode: 'red' | 'orange' | 'yellow' | 'green';
  potentialTier: Tier | null;
  winning: DecisionLogEntry;
  log: DecisionLogEntry[];
  signals: Signal[];
  news2: { applicable: boolean; score: number | null; knownParams: string[]; missingParams: string[] };
  missing: { code: string; label: string; potentialTier: Tier | null }[];
  vulnerable: boolean;
  insufficientData: boolean;
  engineVersion: string;
  ruleSet: { name: string; version: string; status: string; hash: string };
  inputFingerprint: string;
}
