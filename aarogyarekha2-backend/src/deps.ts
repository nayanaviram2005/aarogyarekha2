import type { PatientRow, IdentifierRow, EncounterRow, VitalRow } from './fhir/project.js';
import type { PersistArgs, PersistResult } from './triage/persist.js';
import type { PatientFacts, TriageContext } from './intake/input.js';
import type { VitalKind } from './fhir/codes.js';
import type { ReviewArgs, ReviewResult } from './review/record.js';
import type { SendReferralArgs, SendReferralResult } from './referral/send.js';
import type { Bundle } from 'fhir/r4';
import type { ReadText } from './ocr/engines.js';
import type { Generate, ProviderName } from './ai/provider.js';
import type { Transcribe } from './ai/stt.js';
import type { Vision } from './ai/vision.js';
import type { RuleSet } from './triage/types.js';
import type { SmsStore, StatusSms } from './sms/notify.js';
import type { AuditRow } from './admin/suspicious.js';
import type { TrainingStore } from './training/store.js';

export interface AuditEvent {
  action: 'read' | 'create' | 'update' | 'delete' | 'export' | 'share' | 'break_glass' | 'login' | 'login_failed' | 'logout' | 'consent_change' | 'erasure';
  entityType: string;
  entityId?: string | null;
  patientId?: string | null;
  facilityId?: string | null;
  actor?: string | null;
  outcome: 'success' | 'denied' | 'error';
  requestId?: string;
  ip?: string;
  userAgent?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface PatientBrief {
  id: string; public_ref: string; full_name: string; sex: 'female' | 'male' | 'other' | 'unknown';
  birth_date: string | null; age_years_reported: number | null; preferred_language: string;
}

export interface QueueEntry {
  encounterId: string; patient: PatientBrief; scenario: string; facilityId?: string;
  chiefComplaint: string | null; chiefComplaintTranslated: string | null;
  assessed: boolean; urgencyCode: 'red' | 'orange' | 'yellow' | 'green' | null; tier: number | null; potentialTier: number | null;
  missingCount: number; winningLabel: string | null; vulnerable: boolean;
  queueStatus: string | null; waitingSince: string | null; assessmentVersion: number | null;
  engineTier: number | null;
  reviewed: boolean;
  documents?: QueueDocument[];
}
export interface QueueDocument { id: string; name: string | null; mimeType: string; kind: string }

export interface FacilityRow { id: string; name: string; type: string | null; state: string | null; district: string | null; capabilities: string[] }
export type ReferralPriority = 'routine' | 'urgent' | 'asap' | 'stat';
export type ReferralStatus = 'draft' | 'requested' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'cancelled';
export interface ReferralRow {
  id: string; encounter_id: string; patient_id: string; from_facility_id: string; to_facility_id: string | null; requested_by: string;
  priority: ReferralPriority; reason_text: string | null; status: ReferralStatus; status_reason: string | null;
  bundle: Bundle | null; bundle_sha256: string | null; sent_at: string | null; created_at: string; updated_at: string;
}
export interface ConsentBrief { id?: string; purpose: string; granted_at: string; revoked_at: string | null; expires_at: string | null }

export type DocumentKind = 'lab_report' | 'prescription' | 'discharge_summary' | 'imaging_report' | 'vaccination_record' | 'referral_letter' | 'photo' | 'other';
export interface DocumentRow {
  id: string; patient_id: string; encounter_id: string | null; facility_id: string; kind: DocumentKind; storage_path: string; mime_type: string;
  size_bytes: number; original_filename: string | null; scan_status: 'pending' | 'clean' | 'infected' | 'failed'; uploaded_by: string | null; created_at: string;
}
export interface NewDocument { id: string; patientId: string; encounterId: string; facilityId: string; kind: DocumentKind; storagePath: string; mimeType: string; sizeBytes: number; originalFilename: string | null }
export interface FieldRow {
  id: string; extraction_id: string; field_name: string; extracted_value_text: string | null; value_text: string | null; value_num: number | null; unit: string | null;
  reference_range_text: string | null; printed_flag: 'low' | 'high' | 'abnormal' | 'normal' | null; confidence: number | null; verified_by: string | null; verified_at: string | null;
  second_read?: string | null; agreement?: 'agree' | 'differ' | 'ocr_only' | 'ai_only' | null;
}
export interface ExtractionView {
  id: string; document_id: string; engine: string; engine_version: string | null; status: 'pending' | 'completed' | 'failed'; language: string | null;
  avg_confidence: number | null; error: string | null; created_at: string; completed_at: string | null; fields: FieldRow[];
}
export interface ParsedField { fieldName: string; extractedValueText: string | null; valueNum: number | null; unit: string | null; referenceRangeText: string | null; printedFlag: 'low' | 'high' | 'abnormal' | 'normal' | null; confidence: number | null; secondRead?: string | null; agreement?: 'agree' | 'differ' | 'ocr_only' | 'ai_only' | null }
export interface SaveExtractionArgs { documentId: string; engine: string; engineVersion: string | null; language: string | null; avgConfidence: number | null; status: 'completed' | 'failed'; error: string | null; rawText: string | null; fields: ParsedField[] }

export interface Me {
  displayName: string | null;
  memberships: { facilityId: string; facilityName: string | null; facilityType: string | null; role: string }[];
}

export interface EncounterSummary {
  encounter: EncounterRow;
  patient: PatientBrief;
  symptoms: { id: string; text_original: string; text_translated: string | null; lang: string | null; duration_value: number | string | null; duration_unit: string | null; severity: number | null; created_at: string }[];
  vitals: VitalRow[];
  triageContext: TriageContext;
  assessment: null | {
    id: string; version: number; created_at: string; urgency_code: string; note: Record<string, unknown>;
    signals: { signal_code: string; kind: string; source: string; weight: number | null; display_text: string | null }[];
  };
  followUps: { field_code: string | null; question_text: string; status: string; answer_text: string | null }[];
  queue: { urgency_code: string; status: string; entered_at: string } | null;
  reviews: { id: string; action: string; assessment_id: string | null; reviewer_id: string; reviewer_name: string | null; from_urgency_code: string | null; to_urgency_code: string | null; reason: string | null; created_at: string }[];
}

export interface UserReader {
  getPatient(id: string): Promise<PatientRow | null>;
  getIdentifiers(patientId: string): Promise<IdentifierRow[]>;
  getEncounter(id: string): Promise<EncounterRow | null>;
  getVitals(encounterId: string): Promise<VitalRow[]>;
  listPatients(q: string | undefined, limit: number): Promise<PatientBrief[]>;
  getQueue(): Promise<QueueEntry[]>;
  getEncounterSummary(id: string): Promise<EncounterSummary | null>;
  getMe(): Promise<Me>;
  listFacilities(): Promise<FacilityRow[]>;
  getFacility(id: string): Promise<FacilityRow | null>;
  getReferral(id: string): Promise<ReferralRow | null>;
  listReferrals(encounterId: string): Promise<Omit<ReferralRow, 'bundle'>[]>;
  getConsents(patientId: string): Promise<ConsentBrief[]>;
  getNames(ids: string[]): Promise<Record<string, string | null>>;
  listDocuments(encounterId: string): Promise<DocumentRow[]>;
  getDocument(id: string): Promise<DocumentRow | null>;
  getExtraction(documentId: string): Promise<ExtractionView | null>;
}

export type FollowupKind = 'anc_visit' | 'chronic_checkin' | 'fever_followup' | 'vaccination' | 'custom';
export interface FollowupView {
  id: string; patient_id: string; facility_id: string; kind: FollowupKind; cadence_days: number | null; next_due_at: string | null; active: boolean; created_at: string;
  reminders: { id: string; due_at: string; channel: 'sms' | 'whatsapp' | 'ivr' | 'in_app'; status: string; sent_at: string | null }[];
}
export interface FollowupStore {
  list(patientId: string): Promise<FollowupView[]>;
  get(id: string): Promise<FollowupView | null>;
  create(a: { patientId: string; facilityId: string; kind: FollowupKind; cadenceDays: number | null; nextDueAt: string }): Promise<{ id: string }>;
  stop(id: string): Promise<void>;
}

export interface ReferralBoardRow {
  id: string; encounter_id: string; patient_id: string; from_facility_id: string; to_facility_id: string | null; priority: ReferralPriority; reason_text: string | null;
  status: ReferralStatus; status_reason: string | null; sent_at: string | null; updated_at: string; patient: PatientBrief | null;
}
export interface ReferralBoard {
  list(side: 'incoming' | 'sent', facilityIds: string[], statuses: ReferralStatus[], limit: number): Promise<ReferralBoardRow[]>;
  respond(id: string, to: ReferralStatus, note: string | null): Promise<void>;
}

export type HistoryKind = 'reported_condition' | 'allergy' | 'medication' | 'family_history' | 'occupational_exposure' | 'immunisation' | 'other';
export interface HistoryRow { id: string; patient_id: string; kind: HistoryKind; text_original: string; lang: string | null; source: string; created_at: string; confirmed_by: string | null; confirmed_at: string | null }
export interface HistoryStore {
  list(patientId: string): Promise<HistoryRow[]>;
  add(a: { patientId: string; kind: HistoryKind; text: string; lang?: string }): Promise<{ id: string }>;
  confirm(id: string): Promise<boolean>;
}

export interface VitalPoint { kind: string; value: number; unit: string; measured_at: string; encounter_id: string }
export interface LabHistoryStore { forPatient(patientId: string, limit: number): Promise<import('./ocr/labTrends.js').LabPoint[]> }
export interface VitalHistoryStore { forPatient(patientId: string, kinds: string[], limit: number): Promise<VitalPoint[]> }

export type NoteKind = 'comment' | 'escalation' | 'feedback_up' | 'feedback_down' | 'doctor_note';
export interface NoteRow { id: string; encounter_id: string; assessment_id: string | null; author_id: string; kind: NoteKind; body: string | null; created_at: string }
export interface NotesStore {
  list(encounterId: string): Promise<NoteRow[]>;
  add(a: { encounterId: string; assessmentId?: string | null; kind: NoteKind; body?: string | null }): Promise<{ id: string }>;
}

export type VisitOutcome = 'treated_here' | 'sent_home' | 'did_not_wait' | 'referred';
export interface DoneRow { encounterId: string; facilityId: string; patientRef: string; patientName: string | null; sex: string | null; urgencyCode: string | null; outcome: VisitOutcome | null; finishedAt: string; by: string | null; waitedMinutes: number | null }
export class VisitError extends Error { constructor(public readonly kind: 'forbidden' | 'not_found' | 'review_first' | 'taken' | 'state' | 'invalid' | 'not_set_up', message: string) { super(message); } }
export interface VisitFlow {
  callIn(a: { actor: string; encounterId: string }): Promise<{ status: string }>;
  complete(a: { actor: string; encounterId: string; outcome: Exclude<VisitOutcome, 'referred'> }): Promise<{ outcome: VisitOutcome; queueStatus: string }>;
  done(facilityIds: string[], hours: number): Promise<DoneRow[]>;
}

export interface MemberRow { userId: string; facilityId: string; role: string; active: boolean; since: string; name: string | null; email: string | null; lastSignIn: string | null; mfa: boolean }
export interface MemberChange { at: string; facilityId: string; op: string; role: string | null; previous: string | null; actor: string | null; target: string | null }
export class MemberError extends Error { constructor(public readonly kind: 'forbidden' | 'not_found' | 'invalid', message: string) { super(message); } }
export interface MemberAdmin {
  list(facilityIds: string[]): Promise<MemberRow[]>;
  findByEmail(email: string): Promise<{ id: string } | null>;
  setRole(a: { actor: string; facilityId: string; userId: string; role: string }): Promise<{ role: string; previous: string }>;
  deactivate(a: { actor: string; facilityId: string; userId: string }): Promise<{ previous: string }>;
  changes(facilityIds: string[], limit: number): Promise<MemberChange[]>;
}

export interface PlatformFacilityRow { id: string; name: string; type: string; state: string | null; district: string | null; code: string | null; active: boolean; staff: number; lastActivity: string | null; visits30: number; referrals30: number; admins: { userId: string; name: string | null; email: string | null }[] }
export class PlatformError extends Error { constructor(public readonly kind: 'forbidden' | 'not_found' | 'invalid', message: string) { super(message); } }
export interface PlatformAdmin {
  isPlatform(userId: string): Promise<boolean>;
  facilities(): Promise<PlatformFacilityRow[]>;
  create(a: { actor: string; name: string; type: string; state?: string | undefined; district?: string | undefined; pincode?: string | undefined; code?: string | undefined }): Promise<{ id: string }>;
  setActive(a: { actor: string; facilityId: string; active: boolean }): Promise<void>;
}

export interface BreakGlassRow { id: string; user_id: string; patient_ref: string; facility_id: string; reason: string; created_at: string; expires_at: string; reviewed_by: string | null; reviewed_at: string | null }
export class BreakGlassError extends Error { constructor(public readonly kind: 'not_found' | 'forbidden', message: string) { super(message); } }
export interface TriageVisitRow {
  id: string; createdAt: string; facilityId: string; facilityName: string | null; scenario: string; status: string; outcome: string | null; complaint: string | null;
  assessedUrgency: string | null; finalUrgency: string | null; reviewedBy: string | null; reviewedAt: string | null;
  notes: { id: string; authorId: string; body: string; at: string }[];
}
export interface PatientSearchRow { publicRef: string; name: string; sex: string | null; age: number | null; facilityId: string; facilityName: string }
export interface AdminStore {
  recentAudit(sinceIso: string, limit: number): Promise<AuditRow[]>;
  reviewBreakGlass(id: string, reviewerId: string): Promise<boolean>;
  patientEncounters(patientId: string): Promise<{ id: string; status: string; scenario: string; created_at: string }[]>;
  patientTriageHistory(patientId: string): Promise<TriageVisitRow[]>;
}
export interface Spread { n: number; median: number | null; p90: number | null }
export interface Analytics {
  days: number; referralsSent: number; perDay: { day: string; n: number }[]; encounters: number; submitted: number; assessed: number; reviewed: number;
  byScenario: { scenario: string; n: number }[]; byUrgency: { urgency: string; n: number }[];
  secondsToAssessment: Spread; minutesToReview: Spread;
  review: { approved: number; changed: number; loweredBelowRules: number; agreementRate: number | null };
  feedback: { helpful: number; notHelpful: number } | null;
}
export interface AuditExportRow { id: number; occurred_at: string; actor_user_id: string | null; actor_name: string | null; actor_role: string | null; facility_id: string | null; facility_name: string | null; action: string; entity_type: string; outcome: string; patient_ref: string | null }
export interface SystemAdmin {
  analytics(facilityIds: string[], days: number): Promise<Analytics>;
  verifyChain(): Promise<{ checked: number; brokenIds: number[] }>;
  auditExport(facilityIds: string[], sinceIso: string, limit: number): Promise<AuditExportRow[]>;
  searchPatients(q: string, limit: number): Promise<PatientSearchRow[]>;
  listBreakGlass(facilityIds: string[], limit: number): Promise<BreakGlassRow[]>;
  grantBreakGlass(a: { userId: string; facilityId: string; publicRef: string; reason: string }): Promise<{ id: string; patientId: string; publicRef: string; expiresAt: string }>;
}

export class DbError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface NewConsent { patientId: string; purpose: 'care_triage' | 'referral_sharing' | 'external_ai_processing' | 'reminders' | 'status_messages' | 'research_deidentified'; givenBy: 'self' | 'guardian' | 'representative'; method: 'digital' | 'verbal_witnessed' | 'paper'; noticeVersion: string; witnessName?: string; expiresAt?: string }
export interface NewEncounter { patientId: string; facilityId: string; scenario: string; language: string; chiefComplaint?: string }
export interface NewSymptom { text: string; lang?: string; durationValue?: number; durationUnit?: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'; severity?: number }
export interface NewVital { kind: VitalKind; value: number; unit: string }
export interface NewInfoRequest { fieldCode: string; question: string; lang: string }
export interface InfoAnswer { fieldCode: string; answer: string }

export interface NewPatient {
  facilityId: string; fullName: string; sex: PatientBrief['sex']; birthDate?: string; ageYears?: number; preferredLanguage: string;
  phone?: string; villageTown?: string; district?: string; state?: string; pincode?: string;
}
export interface UserWriter {
  registerPatient(p: NewPatient): Promise<{ id: string; publicRef: string }>;
  hasActiveConsent(patientId: string, purpose: NewConsent['purpose']): Promise<boolean>;
  recordConsent(c: NewConsent): Promise<{ id: string }>;
  createEncounter(e: NewEncounter): Promise<EncounterRow>;
  addSymptom(encounterId: string, s: NewSymptom): Promise<{ id: string }>;
  addVital(encounterId: string, v: NewVital): Promise<{ id: string }>;
  patientFacts(patientId: string): Promise<PatientFacts | null>;
  getTriageContext(encounterId: string): Promise<TriageContext>;
  setTriageContext(encounterId: string, ctx: TriageContext): Promise<void>;
  submitEncounter(encounterId: string): Promise<void>;
  listOpenInfoCodes(encounterId: string): Promise<string[]>;
  dismissInfoRequests?(encounterId: string, keepCodes: string[]): Promise<number>;
  addInfoRequests(encounterId: string, items: NewInfoRequest[]): Promise<void>;
  answerInfoRequests(encounterId: string, answers: InfoAnswer[]): Promise<void>;
  createReferral(r: { encounterId: string; patientId: string; fromFacilityId: string; toFacilityId: string; priority: ReferralPriority; reasonText: string }): Promise<ReferralRow>;
  updateReferralDraft(id: string, patch: { toFacilityId?: string; priority?: ReferralPriority; reasonText?: string }): Promise<void>;
  cancelReferral(id: string, reason: string | null): Promise<void>;
  setComplaintTranslation(encounterId: string, text: string): Promise<void>;
  createDocument(d: NewDocument): Promise<DocumentRow>;
  uploadObject(path: string, bytes: Buffer, mime: string): Promise<void>;
  downloadObject(path: string): Promise<Buffer>;
  verifyField(fieldId: string, v: { valueText: string | null; valueNum: number | null; unit: string | null }): Promise<void>;
}

export interface Deps {
  verifyToken(token: string): Promise<{ userId: string; aal?: 'aal1' | 'aal2' } | null>;
  userReader(token: string, userId: string): UserReader;
  userWriter(token: string, userId: string): UserWriter;
  assess(args: PersistArgs): Promise<PersistResult>;
  review(args: ReviewArgs): Promise<ReviewResult>;
  sendReferral(args: SendReferralArgs): Promise<SendReferralResult>;
  translator: { name: ProviderName; model: string; generate: Generate };
  saveSymptomTranslations(items: { id: string; text: string }[]): Promise<void>;
  logExternalRun(a: { encounterId: string; consentId: string; provider: string; model: string; items: number; chars: number; status: 'ok' | 'error' | 'timeout' | 'rejected'; purpose?: 'translation' | 'transcription' | 'triage_opinion' | 'vision_extraction' }): Promise<void>;
  referralBoard?: (token: string, userId: string) => ReferralBoard;
  history?: (token: string, userId: string) => HistoryStore;
  vitalHistory?: (token: string) => VitalHistoryStore;
  labHistory?: (token: string) => LabHistoryStore;
  notes?: (token: string, userId: string) => NotesStore;
  statusSms?: StatusSms;
  smsInbound?: { store: SmsStore; authToken: string; webhookUrl: string };
  visitFlow?: VisitFlow;
  memberAdmin?: MemberAdmin;
  platformAdmin?: PlatformAdmin;
  adminStore?: (token: string, userId: string) => AdminStore;
  systemAdmin?: SystemAdmin;
  followups?: (token: string, userId: string) => FollowupStore;
  scheduleReminder?: (a: { scheduleId: string; consentId: string; dueAt: string; channel: 'sms' | 'whatsapp' | 'ivr' | 'in_app' }) => Promise<{ id: string }>;
  loadRuleSet?: (name: string, version: string) => Promise<RuleSet>;
  triageAi?: { name: ProviderName; model: string; generate: Generate };
  trainingStore?: TrainingStore;
  vision?: Vision;
  transcriber?: { name: ProviderName; model: string; supported: boolean; transcribe: Transcribe };
  readText: ReadText;
  finishUpload(a: { documentId: string; sha256: string; sizeBytes: number }): Promise<void>;
  failUpload(documentId: string): Promise<void>;
  saveExtraction(a: SaveExtractionArgs): Promise<{ extractionId: string }>;
  audit(event: AuditEvent): Promise<void>;
}
