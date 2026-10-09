// The seams between the HTTP layer and the outside world. The app only sees these interfaces, so the
// security-relevant behaviour (auth, consent gate, fail-closed auditing, RLS-miss handling) is testable without a database.
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

/** One row of the queue board. Not-yet-assessed encounters are included with assessed = false. */
export interface QueueEntry {
  encounterId: string; patient: PatientBrief; scenario: string; facilityId?: string;
  chiefComplaint: string | null; chiefComplaintTranslated: string | null;
  assessed: boolean; urgencyCode: 'red' | 'orange' | 'yellow' | 'green' | null; tier: number | null; potentialTier: number | null;
  missingCount: number; winningLabel: string | null; vulnerable: boolean;
  queueStatus: string | null; waitingSince: string | null; assessmentVersion: number | null;
  /** The tier the RULES produced. `tier` is the effective tier (what a reviewer may have changed it to). */
  engineTier: number | null;
  /** True when a reviewer has signed off the CURRENT assessment. */
  reviewed: boolean;
}

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
  /** What an AI model read for this row, and how it compares with the local read. Null when no second read was made (or migration 0017 is not applied). */
  second_read?: string | null; agreement?: 'agree' | 'differ' | 'ocr_only' | 'ai_only' | null;
}
export interface ExtractionView {
  id: string; document_id: string; engine: string; engine_version: string | null; status: 'pending' | 'completed' | 'failed'; language: string | null;
  avg_confidence: number | null; error: string | null; created_at: string; completed_at: string | null; fields: FieldRow[];
}
export interface ParsedField { fieldName: string; extractedValueText: string | null; valueNum: number | null; unit: string | null; referenceRangeText: string | null; printedFlag: 'low' | 'high' | 'abnormal' | 'normal' | null; confidence: number | null; secondRead?: string | null; agreement?: 'agree' | 'differ' | 'ocr_only' | 'ai_only' | null }
export interface SaveExtractionArgs { documentId: string; engine: string; engineVersion: string | null; language: string | null; avgConfidence: number | null; status: 'completed' | 'failed'; error: string | null; rawText: string | null; fields: ParsedField[] }

/** Who is signed in. No patient data, so reading it is not audited. */
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

/** Reads performed AS the caller (their JWT), so row-level security decides what comes back. */
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
/** Follow-up schedules as the CALLER (row-level security decides who sees and changes them). */
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
/** Referral lists and receiving-facility responses AS the caller. Row-level security and the database's transition rules decide what is allowed. */
export interface ReferralBoard {
  list(side: 'incoming' | 'sent', facilityIds: string[], statuses: ReferralStatus[], limit: number): Promise<ReferralBoardRow[]>;
  respond(id: string, to: ReferralStatus, note: string | null): Promise<void>;
}

export type HistoryKind = 'reported_condition' | 'allergy' | 'medication' | 'family_history' | 'occupational_exposure' | 'immunisation' | 'other';
export interface HistoryRow { id: string; patient_id: string; kind: HistoryKind; text_original: string; lang: string | null; source: string; created_at: string; confirmed_by: string | null; confirmed_at: string | null }
/** What the patient or staff REPORTED: conditions, allergies, medicines. Recorded as told, never advised on. */
export interface HistoryStore {
  list(patientId: string): Promise<HistoryRow[]>;
  add(a: { patientId: string; kind: HistoryKind; text: string; lang?: string }): Promise<{ id: string }>;
  confirm(id: string): Promise<boolean>;
}

export interface VitalPoint { kind: string; value: number; unit: string; measured_at: string; encounter_id: string }
/** A patient's measurements across ALL their visits, as the caller (row-level security). */
export interface VitalHistoryStore { forPatient(patientId: string, kinds: string[], limit: number): Promise<VitalPoint[]> }

export type NoteKind = 'comment' | 'escalation' | 'feedback_up' | 'feedback_down';
export interface NoteRow { id: string; encounter_id: string; assessment_id: string | null; author_id: string; kind: NoteKind; body: string | null; created_at: string }
/** Reviewer notes as the caller (row-level security): comments, escalations and feedback. Append-only. */
export interface NotesStore {
  list(encounterId: string): Promise<NoteRow[]>;
  add(a: { encounterId: string; assessmentId?: string | null; kind: NoteKind; body?: string | null }): Promise<{ id: string }>;
}

export type VisitOutcome = 'treated_here' | 'sent_home' | 'did_not_wait' | 'referred';
export interface DoneRow { encounterId: string; facilityId: string; patientRef: string; patientName: string | null; sex: string | null; urgencyCode: string | null; outcome: VisitOutcome | null; finishedAt: string; by: string | null; waitedMinutes: number | null }
export class VisitError extends Error { constructor(public readonly kind: 'forbidden' | 'not_found' | 'review_first' | 'taken' | 'state' | 'invalid' | 'not_set_up', message: string) { super(message); } }
/** Getting patients off the queue (migration 0018). The database functions enforce the rules; this is the call into them. */
export interface VisitFlow {
  callIn(a: { actor: string; encounterId: string }): Promise<{ status: string }>;
  complete(a: { actor: string; encounterId: string; outcome: Exclude<VisitOutcome, 'referred'> }): Promise<{ outcome: VisitOutcome; queueStatus: string }>;
  done(facilityIds: string[], hours: number): Promise<DoneRow[]>;
}

export interface MemberRow { userId: string; facilityId: string; role: string; active: boolean; since: string; name: string | null; email: string | null }
export interface MemberChange { at: string; facilityId: string; op: string; role: string | null; previous: string | null; actor: string | null; target: string | null }
export class MemberError extends Error { constructor(public readonly kind: 'forbidden' | 'not_found' | 'invalid', message: string) { super(message); } }
/** Who works at a facility and in what role. The database functions of migration 0016 enforce the rules; this is the call into them. */
export interface MemberAdmin {
  list(facilityIds: string[]): Promise<MemberRow[]>;
  findByEmail(email: string): Promise<{ id: string } | null>;
  setRole(a: { actor: string; facilityId: string; userId: string; role: string }): Promise<{ role: string; previous: string }>;
  deactivate(a: { actor: string; facilityId: string; userId: string }): Promise<{ previous: string }>;
  changes(facilityIds: string[], limit: number): Promise<MemberChange[]>;
}

export interface PlatformFacilityRow { id: string; name: string; type: string; state: string | null; district: string | null; code: string | null; active: boolean; staff: number; admins: { userId: string; name: string | null; email: string | null }[] }
export class PlatformError extends Error { constructor(public readonly kind: 'forbidden' | 'not_found' | 'invalid', message: string) { super(message); } }
/** The platform administrator's work: facilities. Appointing facility administrators goes through MemberAdmin. No patient data. */
export interface PlatformAdmin {
  isPlatform(userId: string): Promise<boolean>;
  facilities(): Promise<PlatformFacilityRow[]>;
  create(a: { actor: string; name: string; type: string; state?: string | undefined; district?: string | undefined; pincode?: string | undefined; code?: string | undefined }): Promise<{ id: string }>;
  setActive(a: { actor: string; facilityId: string; active: boolean }): Promise<void>;
}

export interface BreakGlassRow { id: string; user_id: string; patient_ref: string; facility_id: string; reason: string; created_at: string; expires_at: string; reviewed_by: string | null; reviewed_at: string | null }
export class BreakGlassError extends Error { constructor(public readonly kind: 'not_found' | 'forbidden', message: string) { super(message); } }
/** Administrator reads and writes as the CALLER (row-level security decides). */
export interface AdminStore {
  recentAudit(sinceIso: string, limit: number): Promise<AuditRow[]>;
  reviewBreakGlass(id: string, reviewerId: string): Promise<boolean>;
  patientEncounters(patientId: string): Promise<{ id: string; status: string; scenario: string; created_at: string }[]>;
}
/** System-path administrator functions (database connection). Callers must have been checked by the route first. */
export interface Spread { n: number; median: number | null; p90: number | null }
export interface Analytics {
  days: number; encounters: number; submitted: number; assessed: number; reviewed: number;
  byScenario: { scenario: string; n: number }[]; byUrgency: { urgency: string; n: number }[];
  secondsToAssessment: Spread; minutesToReview: Spread;
  review: { approved: number; changed: number; loweredBelowRules: number; agreementRate: number | null };
  feedback: { helpful: number; notHelpful: number } | null;
}
export interface SystemAdmin {
  /** Counts and timings for the given facilities. No names, no patient ids. */
  analytics(facilityIds: string[], days: number): Promise<Analytics>;
  verifyChain(): Promise<{ checked: number; brokenIds: number[] }>;
  listBreakGlass(facilityIds: string[], limit: number): Promise<BreakGlassRow[]>;
  /** Grants a short emergency access. Throws BreakGlassError when there is no such patient or the caller is not clinical staff at that facility. */
  grantBreakGlass(a: { userId: string; facilityId: string; publicRef: string; reason: string }): Promise<{ id: string; patientId: string; publicRef: string; expiresAt: string }>;
}

/** A database rule rejected the write. `code` is the Postgres SQLSTATE (42501 = not allowed, 23xxx = constraint). */
export class DbError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface NewConsent { patientId: string; purpose: 'care_triage' | 'referral_sharing' | 'external_ai_processing' | 'reminders' | 'status_messages' | 'research_deidentified'; givenBy: 'self' | 'guardian' | 'representative'; method: 'digital' | 'verbal_witnessed' | 'paper'; noticeVersion: string; witnessName?: string; expiresAt?: string }
export interface NewEncounter { patientId: string; facilityId: string; scenario: string; language: string; chiefComplaint?: string }
export interface NewSymptom { text: string; lang?: string; durationValue?: number; durationUnit?: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'; severity?: number }
export interface NewVital { kind: VitalKind; value: number; unit: string }
export interface NewInfoRequest { fieldCode: string; question: string; lang: string }
export interface InfoAnswer { fieldCode: string; answer: string }

/** Writes performed AS the caller (their JWT, and stamped with their user id), so RLS decides what is allowed. */
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
  /** Marks open questions as dismissed when a newer assessment no longer asks them (they were not relevant to this patient). Optional. */
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
  /** Returns the authenticated user id (and the sign-in assurance level: aal2 means a second factor was verified), or null if the token is invalid/expired/revoked. */
  verifyToken(token: string): Promise<{ userId: string; aal?: 'aal1' | 'aal2' } | null>;
  /** `userId` is the id the token was verified as. Reads that describe "me" must ask for exactly that user's own rows. */
  userReader(token: string, userId: string): UserReader;
  userWriter(token: string, userId: string): UserWriter;
  /** System path (not the caller's JWT): runs the triage engine and stores the assessment, signals and queue entry. */
  assess(args: PersistArgs): Promise<PersistResult>;
  /** System path: records a reviewer decision atomically (role check, stale-assessment check, queue update). Throws ReviewError for refusals. */
  review(args: ReviewArgs): Promise<ReviewResult>;
  /** System path: sends a referral atomically (role, sign-off and consent checks; freezes the bundle). Throws SendError for refusals. */
  sendReferral(args: SendReferralArgs): Promise<SendReferralResult>;
  /** The outside AI service used for translation. Only ever called with redacted text, after consent, and every call is logged. */
  translator: { name: ProviderName; model: string; generate: Generate };
  /** System path: store machine translations of symptom text (users cannot update symptom rows). */
  saveSymptomTranslations(items: { id: string; text: string }[]): Promise<void>;
  /** System path: record that an outside AI service was called (size only, never the text). */
  logExternalRun(a: { encounterId: string; consentId: string; provider: string; model: string; items: number; chars: number; status: 'ok' | 'error' | 'timeout' | 'rejected'; purpose?: 'translation' | 'transcription' | 'triage_opinion' | 'vision_extraction' }): Promise<void>;
  /** Incoming and sent referral lists, and the receiving facility's responses. Optional: when absent those screens say they are not set up. */
  referralBoard?: (token: string, userId: string) => ReferralBoard;
  /** Reported medical history for the caller. Optional: when absent the history panel says it is not set up. */
  history?: (token: string, userId: string) => HistoryStore;
  /** Measurements over time for one patient. Optional: when absent the trend panel says it is not set up. */
  vitalHistory?: (token: string) => VitalHistoryStore;
  /** Reviewer notes. Optional: needs migration 0015; when absent the notes panel says it is not set up. */
  notes?: (token: string, userId: string) => NotesStore;
  /** Tells a patient their queue status by text after a sign-off. Optional: when absent nothing is sent. */
  statusSms?: StatusSms;
  /** Replies from Twilio (STOP). Needs the auth token to check the signature and the exact public webhook address. */
  smsInbound?: { store: SmsStore; authToken: string; webhookUrl: string };
  /** Call in, complete a visit, list who was seen. Optional: needs migration 0018; when absent the screens say it is not set up. */
  visitFlow?: VisitFlow;
  /** People and roles. Optional: needs migration 0016; when absent the screen says it is not set up. */
  memberAdmin?: MemberAdmin;
  /** Facilities and their administrators, for platform administrators. Optional: when absent those screens say they are not set up. */
  platformAdmin?: PlatformAdmin;
  /** Administrator and emergency-access functions. Optional: when absent those screens say they are not set up. */
  adminStore?: (token: string, userId: string) => AdminStore;
  systemAdmin?: SystemAdmin;
  /** Follow-up schedules for the caller. Optional: when absent, the follow-up screens say they are not set up. */
  followups?: (token: string, userId: string) => FollowupStore;
  /** System path: stores a scheduled reminder (users cannot write reminders; the 'reminders' consent id is required). */
  scheduleReminder?: (a: { scheduleId: string; consentId: string; dueAt: string; channel: 'sms' | 'whatsapp' | 'ivr' | 'in_app' }) => Promise<{ id: string }>;
  /** Loads an approved rule set (for choosing which danger-sign questions fit the patient). Optional: when absent, every unanswered sign is asked about. */
  loadRuleSet?: (name: string, version: string) => Promise<RuleSet>;
  /** The model used for the priority second opinion. Optional: falls back to `translator`. Lets that task have its own key. */
  triageAi?: { name: ProviderName; model: string; generate: Generate };
  /** Reads report images with a vision model, as a second reader beside the local OCR. Optional; needs outside-AI consent per patient. */
  vision?: Vision;
  /** Speech to text. Optional: when absent, voice input reports "not set up". Recordings are never stored. */
  transcriber?: { name: ProviderName; model: string; supported: boolean; transcribe: Transcribe };
  /** Reads text from a stored report. Runs locally; nothing is sent to an outside service. */
  readText: ReadText;
  /** System path: after a file passed every check and was stored, make it readable (scan_status clean + checksum). */
  finishUpload(a: { documentId: string; sha256: string; sizeBytes: number }): Promise<void>;
  /** System path: mark a document that could not be stored. */
  failUpload(documentId: string): Promise<void>;
  /** System path: store an extraction and its fields (users cannot write these tables). */
  saveExtraction(a: SaveExtractionArgs): Promise<{ extractionId: string }>;
  /** Must throw if the audit record could not be durably written. */
  audit(event: AuditEvent): Promise<void>;
}
