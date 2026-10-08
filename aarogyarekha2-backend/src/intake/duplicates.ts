// Before registering someone new, check whether they are probably already registered. A false "duplicate" only costs one extra
// tap (the nurse confirms), while a missed one splits a person's record in two, so the match is deliberately generous on age.
import type { PatientBrief } from '../deps.js';

export const normName = (s: string): string =>
  s.normalize('NFKC').toLowerCase().replace(/[.\-']/g, ' ').replace(/\s+/g, ' ').trim();

export interface NewPersonKey { fullName: string; sex: PatientBrief['sex']; birthDate?: string | null; ageYears?: number | null }

function yearsOld(p: Pick<PatientBrief, 'birth_date' | 'age_years_reported'>, now: Date): number | null {
  if (p.birth_date) { const b = new Date(p.birth_date); if (!Number.isNaN(b.getTime())) { let a = now.getUTCFullYear() - b.getUTCFullYear(); if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a--; return a; } }
  return p.age_years_reported ?? null;
}

export function possibleDuplicates(existing: PatientBrief[], n: NewPersonKey, now: Date = new Date()): PatientBrief[] {
  const name = normName(n.fullName);
  const nAge = yearsOld({ birth_date: n.birthDate ?? null, age_years_reported: n.ageYears ?? null }, now);
  return existing.filter(p => {
    if (normName(p.full_name) !== name) return false;
    if (p.sex !== 'unknown' && n.sex !== 'unknown' && p.sex !== n.sex) return false;
    if (n.birthDate && p.birth_date) return n.birthDate === p.birth_date;
    const pAge = yearsOld(p, now);
    if (nAge === null || pAge === null) return true;           // not enough to tell them apart: ask
    return Math.abs(nAge - pAge) <= 1;
  });
}
