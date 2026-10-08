import type { DocumentKind, RecordIdentity } from './types';

/**
 * Records added during a new-patient intake. They are read first (nothing is stored), the details found are offered to the person
 * registering, and the files are attached to the visit when it is created. The usual consent, duplicate and audit steps all apply.
 */
export interface RecordFile { key: string; file: File; kind: DocumentKind; state: 'reading' | 'read' | 'unreadable' | 'failed'; note?: string; rows?: number }
export const MAX_FILES = 5;

export interface Identityish { fullName: string; sex: 'female' | 'male' | 'other' | 'unknown'; age: string; birthDate: string; phone: string }

/** Fills only what is still empty, so what staff typed is never overwritten. A birth date wins over an age, and never both. */
export function applyIdentity<T extends Identityish>(d: T, found: RecordIdentity): T {
  const out = { ...d };
  if (!out.fullName.trim() && found.fullName) out.fullName = found.fullName;
  if (out.sex === 'unknown' && found.sex) out.sex = found.sex;
  if (!out.age.trim() && !out.birthDate && found.birthDate) out.birthDate = found.birthDate;
  if (!out.age.trim() && !out.birthDate && found.ageYears !== undefined) out.age = String(Math.floor(found.ageYears));
  if (!out.phone.trim() && found.phone) out.phone = found.phone;
  return out;
}
