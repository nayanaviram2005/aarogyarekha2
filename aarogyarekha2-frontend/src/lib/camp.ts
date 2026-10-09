import { buildRegistration } from '../components/RegisterPatientForm';
import { NOTICE_VERSION } from '../components/ConsentForm';
import { ApiError } from './api';
import type { Api, DuplicateMatch, PatientBrief } from './types';

export interface CampProgress { patientId?: string; consent?: boolean; encounterId?: string; vital?: boolean; submitted?: boolean }
export interface CampRow {
  key: string; name: string; sex: PatientBrief['sex']; age: string; language: string; complaint: string; temperature: string;
  consented: boolean;
  notDuplicate: boolean;
  progress: CampProgress;
  status: 'todo' | 'run' | 'done' | 'fail' | 'duplicate';
  message?: string; duplicates?: DuplicateMatch[]; encounterId?: string;
}

export const blankRow = (key: string): CampRow => ({ key, name: '', sex: 'unknown', age: '', language: 'en', complaint: '', temperature: '', consented: false, notDuplicate: false, progress: {}, status: 'todo' });
export const isBlank = (r: CampRow) => !r.name.trim() && !r.age.trim() && !r.complaint.trim() && !r.temperature.trim();

export function rowProblem(r: CampRow, witness: string): string | null {
  const reg = buildRegistration({ fullName: r.name, sex: r.sex, age: r.age, birthDate: '', language: r.language });
  if (typeof reg === 'string') return reg;
  if (!r.complaint.trim()) return 'Enter the complaint.';
  if (r.temperature.trim()) { const t = Number(r.temperature); if (!Number.isFinite(t) || t < 25 || t > 45) return 'Temperature should be a number in °C, for example 38.5.'; }
  if (!r.consented) return 'Consent has not been recorded for this person.';
  if (!witness.trim()) return 'Enter the witness name above.';
  return null;
}

export async function processRow(api: Api, row: CampRow, witness: string): Promise<CampRow> {
  const bad = rowProblem(row, witness);
  if (bad) return { ...row, status: 'fail', message: bad };
  const reg = buildRegistration({ fullName: row.name, sex: row.sex, age: row.age, birthDate: '', language: row.language }) as Exclude<ReturnType<typeof buildRegistration>, string>;
  const p: CampProgress = { ...row.progress };
  let encounterId = row.encounterId;
  try {
    if (!p.patientId) { p.patientId = (await api.registerPatient({ ...reg, ...(row.notDuplicate ? { confirmNotDuplicate: true } : {}) })).id; }
    if (!p.consent) { await api.recordConsent(p.patientId, { purpose: 'care_triage', givenBy: 'self', method: 'verbal_witnessed', noticeVersion: NOTICE_VERSION, witnessName: witness.trim() }); p.consent = true; }
    if (!p.encounterId) { encounterId = (await api.createEncounter({ patientId: p.patientId, scenario: 'health_camp', language: row.language, chiefComplaint: row.complaint.trim() })).id; p.encounterId = encounterId; }
    if (row.temperature.trim() && !p.vital) { await api.addVital(p.encounterId, { kind: 'temperature_c', value: Number(row.temperature) }); p.vital = true; }
    if (!p.submitted) { await api.submit(p.encounterId); p.submitted = true; }
    try { await api.assess(p.encounterId); }
    catch (e) {
      if (e instanceof ApiError && e.isRulesNotApproved) return { ...row, progress: p, encounterId, status: 'done', message: 'In the queue. Not assessed: triage rules are not approved yet.' };
      return { ...row, progress: p, encounterId, status: 'done', message: 'In the queue, but the priority could not be set. Open the record and assess it.' };
    }
    return { ...row, progress: p, encounterId, status: 'done', message: 'In the queue and assessed.' };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.duplicates?.length) return { ...row, progress: p, status: 'duplicate', duplicates: e.duplicates, message: 'Possibly already registered. Check, then tick "different person" to register anyway.' };
    return { ...row, progress: p, encounterId, status: 'fail', message: `${(e as Error).message} Try again to continue from where it stopped.` };
  }
}
