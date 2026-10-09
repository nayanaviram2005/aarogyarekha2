import type { DocumentKind, RecordIdentity } from './types';

export interface RecordFile { key: string; file: File; kind: DocumentKind; state: 'reading' | 'read' | 'unreadable' | 'failed' | 'needs_consent'; note?: string; rows?: number; aiConsent?: boolean }
export const MAX_FILES = 5;

export interface Identityish { fullName: string; sex: 'female' | 'male' | 'other' | 'unknown'; age: string; birthDate: string; phone: string }

export function applyIdentity<T extends Identityish>(d: T, found: RecordIdentity): T {
  const out = { ...d };
  if (!out.fullName.trim() && found.fullName) out.fullName = found.fullName;
  if (out.sex === 'unknown' && found.sex) out.sex = found.sex;
  if (!out.age.trim() && !out.birthDate && found.birthDate) out.birthDate = found.birthDate;
  if (!out.age.trim() && !out.birthDate && found.ageYears !== undefined) out.age = String(Math.floor(found.ageYears));
  if (!out.phone.trim() && found.phone) out.phone = found.phone;
  return out;
}
