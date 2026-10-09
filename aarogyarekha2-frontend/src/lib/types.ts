export type UrgencyCode = 'red' | 'orange' | 'yellow' | 'green';
export type Tier = 1 | 2 | 3 | 4;
export type Sex = 'female' | 'male' | 'other' | 'unknown';

export interface MfaApi {
  hasFactor(): Promise<boolean>;
  enroll(): Promise<{ factorId: string; qr: string; secret: string }>;
  verify(code: string, factorId?: string): Promise<string | null>;
}

export interface Me {
  aal?: 'aal1' | 'aal2';
  mfaRequired?: boolean;
  userId: string;
  displayName: string | null;
  isPlatformAdmin?: boolean;
  memberships: { facilityId: string; facilityName: string | null; facilityType: string | null; role: string }[];
}

export interface PatientBrief {
  id: string; public_ref: string; full_name: string; sex: Sex;
  birth_date: string | null; age_years_reported: number | null; preferred_language: string;
}

export interface QueueEntry {
  encounterId: string; patient: PatientBrief; scenario: string; facilityId?: string; waitingLong?: boolean;
  chiefComplaint: string | null; chiefComplaintTranslated: string | null;
  assessed: boolean; urgencyCode: UrgencyCode | null; tier: number | null; potentialTier: number | null;
  missingCount: number; winningLabel: string | null; vulnerable: boolean;
  queueStatus: string | null; waitingSince: string | null; assessmentVersion: number | null;
  engineTier: number | null;
  reviewed: boolean;
  order?: QueueOrder;
}
export type QueueOrderWhy = 'first' | 'tier' | 'unassessed' | 'vulnerable' | 'wait';
export interface QueueOrder { position: number; of: number; effectiveTier: number; promoted: boolean; why: QueueOrderWhy; waitedMin: number }
export interface QueueResponse { generatedAt: string; entries: QueueEntry[] }

export interface EncounterRow {
  id: string; patient_id: string; facility_id: string; status: string; scenario: string; language: string;
  chief_complaint_original: string | null; chief_complaint_translated: string | null;
  submitted_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
}
export interface VitalRow { id: string; encounter_id: string; kind: string; value: number | string; unit: string; measured_at: string }
export interface TriageContext {
  consciousness?: 'alert' | 'confusion' | 'voice' | 'pain' | 'unresponsive' | null;
  onSupplementalOxygen?: boolean | null; pregnant?: boolean | null; signs?: Record<string, boolean>;
}
export interface DecisionLogEntry { layer: string; ruleId: string; tier: Tier; detail: string }
export interface AiOpinionView { tier: Tier; reason: string; provider: string; model: string; machineGenerated: true; rulesTier: Tier; relation: 'agrees' | 'raised' | 'lower' }
export interface AssessmentNote {
  aiOpinion?: AiOpinionView;
  disclaimer?: string; tier: Tier; potentialTier: Tier | null; winning: DecisionLogEntry; log: DecisionLogEntry[];
  missing: { code: string; label: string; potentialTier: Tier | null }[];
  news2: { applicable: boolean; score: number | null };
  vulnerable: boolean; insufficientData: boolean;
  ruleSet: { name: string; version: string; status: string; hash: string };
}
export interface EncounterSummary {
  encounter: EncounterRow; patient: PatientBrief;
  symptoms: { id: string; text_original: string; text_translated: string | null; lang: string | null; duration_value: number | string | null; duration_unit: string | null; severity: number | null; created_at: string }[];
  vitals: VitalRow[]; triageContext: TriageContext;
  assessment: null | {
    id: string; version: number; created_at: string; urgency_code: UrgencyCode; note: AssessmentNote;
    signals: { signal_code: string; kind: string; source: string; weight: number | null; display_text: string | null }[];
  };
  followUps: { field_code: string | null; question_text: string; status: string; answer_text: string | null }[];
  queue: { urgency_code: UrgencyCode; status: string; entered_at: string } | null;
  consentActive: boolean | null;
  reviews: ReviewRecord[];
}
export interface ReviewRecord {
  id: string; action: string; assessment_id: string | null; reviewer_id: string; reviewer_name: string | null;
  from_urgency_code: UrgencyCode | null; to_urgency_code: UrgencyCode | null; reason: string | null; created_at: string;
}
export type ReasonCode = 'clinical_judgement' | 'new_information' | 'data_entry_error' | 'other';
export type ReviewInput =
  | { action: 'approve'; assessmentId: string }
  | { action: 'override'; assessmentId: string; toUrgency: UrgencyCode; reasonCode: ReasonCode; reason: string; confirmDowngrade?: boolean };
export interface SmsOutcome { status: 'sent' | 'skipped' | 'failed'; reason: string | null; language: 'en' | 'hi' | 'or' }
export interface ReviewResult { reviewId: string; action: string; effectiveUrgency: UrgencyCode; rulesUrgency: UrgencyCode; downgrade: boolean; belowRuleFloor: boolean; sms?: SmsOutcome }

export interface FollowUp { fieldCode: string; audience: string; question: string; lang: string; potentialTier: Tier | null; rank: number }
export interface AssessResponse {
  disclaimer: string; assessmentId: string; version: number; tier: Tier; urgencyCode: UrgencyCode; potentialTier: Tier | null;
  winning: DecisionLogEntry; log: DecisionLogEntry[]; vulnerable: boolean; insufficientData: boolean;
  news2: { applicable: boolean; score: number | null };
  queue: { urgency: UrgencyCode; downgradeSuggested: boolean };
  followUps: FollowUp[]; followUpsSaved: boolean;
  ruleSet: { name: string; version: string; status: string; hash: string };
  aiOpinion?: { status: 'ok' | 'not_set_up' | 'no_consent' | 'unavailable' | 'unusable' };
  questionsFrom?: 'ai' | 'topics' | 'core_only' | 'all';
}

export type FollowupKind = 'anc_visit' | 'chronic_checkin' | 'fever_followup' | 'vaccination' | 'custom';
export type ReminderChannel = 'sms' | 'whatsapp' | 'ivr' | 'in_app';
export interface Followup {
  id: string; kind: FollowupKind; cadenceDays: number | null; nextDueAt: string | null; active: boolean; createdAt: string;
  reminders: { id: string; due_at: string; channel: ReminderChannel; status: string; sent_at: string | null }[];
}
export interface RegisterInput {
  fullName: string; sex: PatientBrief['sex']; birthDate?: string; ageYears?: number; preferredLanguage: string;
  phone?: string; villageTown?: string; district?: string; state?: string; pincode?: string; facilityId?: string; confirmNotDuplicate?: boolean;
}
export interface DuplicateMatch { id: string; publicRef: string; fullName: string; sex: PatientBrief['sex']; birthDate: string | null; ageYears: number | null }
export type FlagKind = 'many_patients' | 'repeated_refusals' | 'failed_logins' | 'off_hours_reads' | 'emergency_access';
export interface AuditFlag { kind: FlagKind; severity: 'review' | 'info'; who: { actorId: string | null; ip: string | null; name: string | null }; count: number; firstAt: string; lastAt: string; text: string }
export interface FlagsResponse { hours: number; examined: number; rulesValidated: boolean; flags: AuditFlag[] }
export interface ChainStatus { intact: boolean; checked: number; brokenIds: number[]; checkedAt: string }
export type VisitOutcome = 'treated_here' | 'sent_home' | 'did_not_wait' | 'referred';
export interface DoneEntry { encounterId: string; facilityId: string; patientRef: string; patientName: string | null; sex: string | null; urgencyCode: string | null; outcome: VisitOutcome | null; finishedAt: string; by: string | null; waitedMinutes: number | null }
export type MemberRole = 'health_worker' | 'nurse' | 'doctor' | 'medical_officer';
export interface MemberView { userId: string; facilityId: string; role: string; active: boolean; since: string; name: string | null; email: string | null; lastSignIn: string | null; mfa: boolean; isSelf: boolean; canChange: boolean }
export interface PlatformFacilityView { id: string; name: string; type: string; state: string | null; district: string | null; code: string | null; active: boolean; staff: number; lastActivity: string | null; visits30: number; referrals30: number; admins: { userId: string; name: string | null; email: string | null }[] }
export interface MemberChangeView { at: string; facilityId: string; op: string; role: string | null; previous: string | null; actor: string | null; target: string | null }
export interface BreakGlassGrantView { id: string; who: string | null; userId: string; patientRef: string; facilityId: string; reason: string; createdAt: string; expiresAt: string; reviewedAt: string | null; reviewed: boolean }
export type HistoryKind = 'reported_condition' | 'allergy' | 'medication' | 'family_history' | 'occupational_exposure' | 'immunisation' | 'other';
export interface HistoryEntry { id: string; kind: HistoryKind; text: string; lang: string | null; source: string; createdAt: string; confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null }
export interface TrendReading { kind: string; value: number; unit: string; at: string; encounterId: string }
export type NoteKind = 'comment' | 'escalation' | 'feedback_up' | 'feedback_down' | 'doctor_note';
export interface PatientSearchHit { publicRef: string; name: string; sex: string | null; age: number | null; facility: string; ownFacility: boolean }
export interface TriageVisit {
  id: string; createdAt: string; facility: string | null; scenario: string; status: string; outcome: string | null; complaint: string | null;
  assessedUrgency: string | null; finalUrgency: string | null; reviewedBy: string | null; reviewedAt: string | null; notes: { id: string; body: string; author: string | null; at: string }[];
}
export interface TriageHistory { patientRef: string; patientName: string; visits: TriageVisit[] }
export interface ReviewerNote { id: string; kind: NoteKind; body: string | null; assessmentId: string | null; author: string | null; at: string }
export interface Spread { n: number; median: number | null; p90: number | null }
export interface AnalyticsView {
  days: number; referralsSent: number; perDay: { day: string; n: number }[]; encounters: number; submitted: number; assessed: number; reviewed: number; byScenario: { scenario: string; n: number }[]; byUrgency: { urgency: string; n: number }[];
  secondsToAssessment: Spread; minutesToReview: Spread; review: { approved: number; changed: number; loweredBelowRules: number; agreementRate: number | null };
  feedback: { helpful: number; notHelpful: number } | null; note: string;
}
export interface ConsentInput { purpose?: 'care_triage' | 'referral_sharing' | 'external_ai_processing' | 'reminders' | 'status_messages'; givenBy: 'self' | 'guardian' | 'representative'; method: 'digital' | 'verbal_witnessed' | 'paper'; noticeVersion: string; witnessName?: string }
export interface EncounterInput { patientId: string; scenario: string; language: string; chiefComplaint: string }
export interface SymptomInput { text: string; lang?: string; durationValue?: number; durationUnit?: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'; severity?: number }
export interface InputsPatch { consciousness?: TriageContext['consciousness']; onSupplementalOxygen?: boolean | null; pregnant?: boolean | null; signs?: Record<string, boolean> }

export interface Facility { id: string; name: string; type: string | null; state: string | null; district: string | null; capabilities: string[] }
export type ReferralPriority = 'routine' | 'urgent' | 'asap' | 'stat';
export type ReferralStatus = 'draft' | 'requested' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'cancelled';
export interface ReferralMeta {
  id: string; encounterId: string; patientId: string; status: ReferralStatus; priority: ReferralPriority; reasonText: string | null;
  toFacility: { id: string; name: string | null } | null; sentAt: string | null; createdAt: string; bundleSha256: string | null;
}
export interface FhirBundle { resourceType: 'Bundle'; type: string; timestamp?: string; entry?: { fullUrl?: string; resource: { resourceType: string; id?: string; [k: string]: unknown } }[] }
export interface ReferralView {
  referral: ReferralMeta; preview: boolean; bundle: FhirBundle;
  readiness: { signedOff: boolean; sharingConsent: boolean; hasReceiver: boolean; hasReason: boolean };
}
export interface BoardReferral {
  id: string; encounterId: string; patientId: string; status: ReferralStatus; statusReason: string | null; priority: ReferralPriority; reasonText: string | null; sentAt: string | null; updatedAt: string;
  from: { id: string; name: string | null }; to: { id: string; name: string | null } | null;
  patient: { id: string; publicRef: string; fullName: string; sex: PatientBrief['sex']; birthDate: string | null; ageYears: number | null; language: string } | null;
}
export type ReferralAction = 'accept' | 'reject' | 'start' | 'complete';
export interface ReferralInput { toFacilityId: string; priority?: ReferralPriority; reasonText: string }

export type DocumentKind = 'lab_report' | 'prescription' | 'discharge_summary' | 'imaging_report' | 'vaccination_record' | 'referral_letter' | 'photo' | 'other';
export interface RecordIdentity { fullName?: string; sex?: 'female' | 'male' | 'other'; ageYears?: number; birthDate?: string; phone?: string }
export interface RecordPreview { identity: RecordIdentity; rows: number; readable: boolean; note: string | null; averageConfidence: number | null; needsAiConsent?: boolean; readBy?: 'ai' | 'local' }
export interface LabTrendPoint { at: string; value: number | null; text: string | null; flag: string | null; verified: boolean; documentId: string; encounterId: string }
export interface LabTrend {
  name: string; label: string; unit: string | null; points: LabTrendPoint[]; unitsDiffer: boolean;
  change: null | { from: number; to: number; direction: 'up' | 'down' | 'same'; unit: string | null };
}
export interface LabTrends { tests: LabTrend[]; rows: number; unverified: number; visits: number }
export interface RecordContextRow { name: string; valueText: string | null; valueNum: number | null; unit: string | null; printedFlag: string | null; verified: boolean }
export interface RecordContext {
  summary: { documents: number; read: number; notRead: number; rows: number; verified: number; flagged: number; lines: string[]; gaps?: { code: 'unread' | 'readers_differ' | 'low_confidence'; text: string }[] };
  documents: { id: string; kind: DocumentKind; filename: string | null; createdAt: string; status: string; rows: RecordContextRow[] }[];
}
export interface DocumentMeta { id: string; encounterId: string | null; kind: DocumentKind; mimeType: string; sizeBytes: number; filename: string | null; status: 'pending' | 'clean' | 'infected' | 'failed'; createdAt: string }
export interface ExtractedField {
  id: string; name: string; printedLine: string | null; valueText: string | null; valueNum: number | null; unit: string | null; referenceRange: string | null;
  printedFlag: 'low' | 'high' | 'abnormal' | 'normal' | null; confidence: number | null; verified: boolean; verifiedAt: string | null;
  secondRead?: string | null; agreement?: 'agree' | 'differ' | 'ocr_only' | 'ai_only' | null;
}
export interface Extraction { id: string; documentId: string; engine: string; status: 'pending' | 'completed' | 'failed'; language: string | null; averageConfidence: number | null; error: string | null; createdAt: string; fields: ExtractedField[] }
export type OcrLanguage = 'en' | 'hi' | 'or';

export interface Api {
  health(): Promise<boolean>;
  me(): Promise<Me>;
  queue(): Promise<QueueResponse>;
  patients(q?: string): Promise<PatientBrief[]>;
  summary(encounterId: string): Promise<EncounterSummary>;
  registerPatient(body: RegisterInput): Promise<{ id: string; publicRef: string }>;
  recordConsent(patientId: string, body: ConsentInput): Promise<{ id: string }>;
  createEncounter(body: EncounterInput): Promise<{ id: string; status: string }>;
  addSymptom(encounterId: string, body: SymptomInput): Promise<{ id: string }>;
  addVital(encounterId: string, body: { kind: string; value: number }): Promise<{ id: string }>;
  saveInputs(encounterId: string, body: InputsPatch): Promise<unknown>;
  submit(encounterId: string): Promise<unknown>;
  assess(encounterId: string): Promise<AssessResponse>;
  review(encounterId: string, body: ReviewInput): Promise<ReviewResult>;
  facilities(): Promise<Facility[]>;
  referralsFor(encounterId: string): Promise<ReferralMeta[]>;
  createReferral(encounterId: string, body: ReferralInput): Promise<ReferralMeta>;
  referral(id: string): Promise<ReferralView>;
  updateReferral(id: string, body: Partial<ReferralInput>): Promise<unknown>;
  cancelReferral(id: string, reason?: string): Promise<unknown>;
  sendReferral(id: string): Promise<{ id: string; status: string; sentAt: string; bundleSha256: string }>;
  downloadReferral(id: string): Promise<{ filename: string; text: string }>;
  downloadReferralPdf(id: string): Promise<{ filename: string; blob: Blob }>;
  downloadHandoverPdf(encounterId: string, lang: 'en' | 'hi' | 'or'): Promise<{ filename: string; blob: Blob }>;
  translate(encounterId: string): Promise<{ translated: number; rejected: number; nothingToDo?: boolean; provider: string; model: string; machineTranslation: true }>;
  transcribe(encounterId: string, audio: Blob, language?: 'en' | 'hi' | 'or'): Promise<{ text: string; language: string | null; provider: string; model: string; machineTranscript: true }>;
  followups(encounterId: string): Promise<Followup[]>;
  createFollowup(encounterId: string, body: { kind: FollowupKind; firstDueInDays: number; cadenceDays?: number }): Promise<{ id: string; nextDueAt: string }>;
  scheduleReminder(followupId: string, body: { channel: ReminderChannel; dueAt?: string }): Promise<{ id: string; dueAt: string; channel: ReminderChannel; status: string }>;
  stopFollowup(followupId: string): Promise<{ id: string; active: false }>;
  auditFlags(hours?: number): Promise<FlagsResponse>;
  auditChain(): Promise<ChainStatus>;
  downloadAuditExport(days: 7 | 30 | 90): Promise<{ filename: string; blob: Blob; chain: 'intact' | 'broken' | 'unchecked'; rows: number; truncated: boolean }>;
  callIn(encounterId: string): Promise<{ encounterId: string; status: string }>;
  completeVisit(encounterId: string, outcome: Exclude<VisitOutcome, 'referred'>): Promise<{ encounterId: string; outcome: VisitOutcome; queueStatus: string }>;
  queueDone(hours?: number): Promise<DoneEntry[]>;
  members(): Promise<MemberView[]>;
  memberChanges(): Promise<MemberChangeView[]>;
  addMember(body: { email: string; role: MemberRole; facilityId?: string }): Promise<{ userId: string; role: string; previous: string }>;
  setMemberRole(userId: string, role: MemberRole, facilityId?: string): Promise<{ userId: string; role: string; previous: string }>;
  removeMember(userId: string, facilityId?: string): Promise<{ userId: string; removed: true }>;
  platformFacilities(): Promise<PlatformFacilityView[]>;
  createFacility(body: { name: string; type: string; state?: string; district?: string; pincode?: string; code?: string }): Promise<{ id: string }>;
  setFacilityActive(facilityId: string, active: boolean): Promise<{ id: string; active: boolean }>;
  appointFacilityAdmin(facilityId: string, email: string): Promise<{ userId: string }>;
  removeFacilityAdmin(facilityId: string, userId: string): Promise<{ userId: string; removed: true }>;
  breakGlassList(): Promise<BreakGlassGrantView[]>;
  reviewBreakGlass(id: string): Promise<{ id: string; reviewed: true }>;
  requestBreakGlass(body: { publicRef: string; reason: string; facilityId?: string }): Promise<{ id: string; patientId: string; patientRef: string; expiresAt: string }>;
  searchBreakGlassPatients(q: string): Promise<{ truncated: boolean; patients: PatientSearchHit[] }>;
  patientTriageHistory(patientId: string): Promise<TriageHistory>;
  patientEncounters(patientId: string): Promise<{ patientRef: string; encounters: { id: string; status: string; scenario: string; created_at: string }[] }>;
  incomingReferrals(statuses?: ReferralStatus[]): Promise<BoardReferral[]>;
  sentReferrals(statuses?: ReferralStatus[]): Promise<BoardReferral[]>;
  respondToReferral(id: string, action: ReferralAction, note?: string): Promise<{ id: string; status: ReferralStatus }>;
  history(patientId: string): Promise<HistoryEntry[]>;
  addHistory(patientId: string, body: { kind: HistoryKind; text: string; lang?: string }): Promise<{ id: string }>;
  confirmHistory(id: string): Promise<{ id: string; confirmed: true }>;
  trends(patientId: string, kinds?: string[]): Promise<TrendReading[]>;
  notes(encounterId: string): Promise<ReviewerNote[]>;
  addNote(encounterId: string, body: { kind: NoteKind; body?: string; assessmentId?: string }): Promise<{ id: string }>;
  analytics(days: 7 | 30 | 90): Promise<AnalyticsView>;
  documents(encounterId: string): Promise<DocumentMeta[]>;
  readRecord(file: File, language?: OcrLanguage, aiConsent?: boolean): Promise<RecordPreview>;
  recordContext(encounterId: string): Promise<RecordContext>;
  labTrends(patientId: string): Promise<LabTrends>;
  uploadDocument(encounterId: string, file: File, kind: DocumentKind): Promise<{ id: string; metadataBytesRemoved: number; quality?: { warnings: { code: string; text: string }[] } }>;
  documentFile(id: string): Promise<{ blob: Blob; filename: string }>;
  extractDocument(id: string, language?: OcrLanguage): Promise<Extraction>;
  extraction(id: string): Promise<Extraction | null>;
  verifyField(documentId: string, fieldId: string, body: { valueNum?: number | null; valueText?: string | null; unit?: string | null }): Promise<unknown>;
}
