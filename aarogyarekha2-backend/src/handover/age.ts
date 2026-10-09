import type { PatientBrief } from '../deps.js';

export function ageSexText(p: Pick<PatientBrief, 'birth_date' | 'age_years_reported' | 'sex'>, now: Date = new Date()): string {
  let age: string | null = null;
  if (p.birth_date) {
    const b = new Date(p.birth_date);
    if (!Number.isNaN(b.getTime())) {
      let y = now.getUTCFullYear() - b.getUTCFullYear();
      if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) y--;
      age = y < 1 ? `${Math.max(0, (now.getUTCFullYear() - b.getUTCFullYear()) * 12 + now.getUTCMonth() - b.getUTCMonth())} months` : `${y} years`;
    }
  }
  if (!age && p.age_years_reported != null) age = `${p.age_years_reported} years`;
  const sex = p.sex && p.sex !== 'unknown' ? p.sex : null;
  return [age, sex].filter(Boolean).join(', ') || 'not recorded';
}
