import type { PatientBrief, Sex, Tier } from './types';

const MS_YEAR = 365.25 * 24 * 3600 * 1000;
const MS_DAY = 24 * 3600 * 1000;

/** "3 y", "8 mo", "12 d"; falls back to an age reported at a camp; "age unknown" otherwise. Never invents an age. */
export function formatAge(p: Pick<PatientBrief, 'birth_date' | 'age_years_reported'>, now: Date = new Date()): string {
  if (p.birth_date) {
    const t = Date.parse(p.birth_date);
    if (Number.isFinite(t)) {
      const ms = Math.max(0, now.getTime() - t);
      if (ms < 60 * MS_DAY) return `${Math.floor(ms / MS_DAY)} d`;
      if (ms < 2 * MS_YEAR) return `${Math.floor(ms / (MS_YEAR / 12))} mo`;
      return `${Math.floor(ms / MS_YEAR)} y`;
    }
  }
  if (p.age_years_reported != null) return `${p.age_years_reported} y`;
  return 'age unknown';
}

const SEX: Record<Sex, string> = { female: 'Female', male: 'Male', other: 'Other', unknown: 'Sex not recorded' };
export const formatSex = (s: Sex) => SEX[s] ?? SEX.unknown;
export const ageSex = (p: PatientBrief, now?: Date) => `${formatAge(p, now)}, ${formatSex(p.sex).toLowerCase()}`;

/** "12 min", "1 h 05 min", "2 d". Waiting time is shown, never hidden. Empty when unknown. */
export function formatWait(since: string | null, now: Date = new Date()): string {
  if (!since) return '';
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d`;
}

export const TIER_WORD: Record<Tier, string> = { 1: 'Immediate', 2: 'Very urgent', 3: 'Urgent', 4: 'Routine' };
const URGENCY_TIER: Record<string, Tier> = { red: 1, orange: 2, yellow: 3, green: 4 };
export const tierOfUrgency = (u: string | null | undefined): Tier | null => (u ? URGENCY_TIER[u] ?? null : null);
export const URGENCY_OF_TIER: Record<Tier, 'red' | 'orange' | 'yellow' | 'green'> = { 1: 'red', 2: 'orange', 3: 'yellow', 4: 'green' };

export const REASON_CODES: { value: 'clinical_judgement' | 'new_information' | 'data_entry_error' | 'other'; label: string }[] = [
  { value: 'clinical_judgement', label: 'Clinical judgement' }, { value: 'new_information', label: 'New information' },
  { value: 'data_entry_error', label: 'A reading or answer was entered wrongly' }, { value: 'other', label: 'Other' },
];

export const PRIORITY_LABEL: Record<'routine' | 'urgent' | 'asap' | 'stat', string> = { routine: 'Routine', urgent: 'Urgent', asap: 'As soon as possible', stat: 'Immediate' };

export const isTier = (n: unknown): n is Tier => n === 1 || n === 2 || n === 3 || n === 4;

export const SCENARIOS: { value: string; label: string }[] = [
  { value: 'opd_queue', label: 'Outpatient queue' },
  { value: 'campus_fever', label: 'Campus fever' },
  { value: 'occupational', label: 'Occupational health' },
  { value: 'maternal_followup', label: 'Maternal follow-up' },
  { value: 'chronic_checkin', label: 'Chronic disease check-in' },
  { value: 'health_camp', label: 'Health camp' },
  { value: 'referral_intake', label: 'Referral intake' },
  { value: 'other', label: 'Other' },
];
export const scenarioLabel = (v: string) => SCENARIOS.find(s => s.value === v)?.label ?? v;

export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' }, { value: 'or', label: 'Odia' },
];
export const languageLabel = (v: string) => LANGUAGES.find(l => l.value === v)?.label ?? v;

const ROLE: Record<string, string> = { health_worker: 'Health worker', nurse: 'Nurse', doctor: 'Doctor', medical_officer: 'Medical officer', facility_admin: 'Facility administrator' };
export const roleLabel = (r: string) => ROLE[r] ?? r;

const VITAL: Record<string, { label: string; unit: string }> = {
  temperature_c: { label: 'Temperature', unit: '°C' }, pulse_bpm: { label: 'Pulse', unit: '/min' },
  resp_rate_pm: { label: 'Breathing rate', unit: '/min' }, spo2_pct: { label: 'Oxygen saturation (SpO2)', unit: '%' },
  bp_systolic_mmhg: { label: 'Blood pressure, systolic', unit: 'mmHg' }, bp_diastolic_mmhg: { label: 'Blood pressure, diastolic', unit: 'mmHg' },
  weight_kg: { label: 'Weight', unit: 'kg' }, height_cm: { label: 'Height', unit: 'cm' },
  blood_glucose_mgdl: { label: 'Blood glucose', unit: 'mg/dL' }, muac_cm: { label: 'Mid-upper-arm circumference', unit: 'cm' },
};
export const vitalLabel = (k: string) => VITAL[k]?.label ?? k;
export const vitalUnit = (k: string) => VITAL[k]?.unit ?? '';

export const CONSCIOUSNESS: { value: 'alert' | 'confusion' | 'voice' | 'pain' | 'unresponsive'; label: string }[] = [
  { value: 'alert', label: 'Alert' }, { value: 'confusion', label: 'Confused' }, { value: 'voice', label: 'Responds to voice only' },
  { value: 'pain', label: 'Responds to pain only' }, { value: 'unresponsive', label: 'Unresponsive' },
];

/** Latest reading per kind, newest first within kind. */
export function latestVitals<T extends { kind: string; measured_at: string }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) { const p = m.get(r.kind); if (!p || Date.parse(r.measured_at) >= Date.parse(p.measured_at)) m.set(r.kind, r); }
  return [...m.values()];
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
