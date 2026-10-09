import type { Consciousness, TriageInput } from '../triage/types.js';
import type { VitalRow } from '../fhir/project.js';

export interface PatientFacts {
  birth_date: string | null;
  age_years_reported: number | null;
  sex: 'female' | 'male' | 'other' | 'unknown';
  pregnancyOngoing: boolean;
}

export interface TriageContext {
  consciousness?: Consciousness | null;
  onSupplementalOxygen?: boolean | null;
  pregnant?: boolean | null;
  signs?: Record<string, boolean>;
}

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

export function ageYearsAt(birthDate: string, now: Date): number | null {
  const t = Date.parse(birthDate);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now.getTime() - t) / MS_PER_YEAR);
}

const VITAL_KEYS = ['temperature_c', 'spo2_pct', 'pulse_bpm', 'resp_rate_pm', 'bp_systolic_mmhg', 'bp_diastolic_mmhg'] as const;

export function buildTriageInput(p: PatientFacts, vitals: VitalRow[], ctx: TriageContext, now: Date = new Date()): TriageInput {
  const ageYears = p.birth_date ? ageYearsAt(p.birth_date, now) : p.age_years_reported ?? null;

  const pregnant =
    typeof ctx.pregnant === 'boolean' ? ctx.pregnant
    : p.pregnancyOngoing ? true
    : p.sex === 'male' ? false
    : ageYears != null && ageYears < 10 ? false
    : null;

  const latest = new Map<string, VitalRow>();
  for (const v of vitals) {
    const prev = latest.get(v.kind);
    if (!prev || Date.parse(v.measured_at) >= Date.parse(prev.measured_at)) latest.set(v.kind, v);
  }
  const out: Record<string, number> = {};
  for (const k of VITAL_KEYS) {
    const v = latest.get(k);
    if (v) { const n = Number(v.value); if (Number.isFinite(n)) out[k] = n; }
  }

  return {
    ageYears, pregnant,
    vitals: out,
    consciousness: ctx.consciousness ?? null,
    onSupplementalOxygen: ctx.onSupplementalOxygen ?? null,
    signs: { ...(ctx.signs ?? {}) },
  };
}
