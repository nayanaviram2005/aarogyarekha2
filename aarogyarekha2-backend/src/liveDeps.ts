import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { isIP } from 'node:net';
import type { Config } from './config.js';
import { DbError, type Deps, type AuditEvent, type UserReader, type UserWriter, type PatientBrief, type QueueEntry, type QueueDocument, type FacilityRow, type ReferralRow, type DocumentRow, type ExtractionView, type FieldRow } from './deps.js';
import { assessEncounter, loadRuleSet, type PoolLike } from './triage/persist.js';
import { recordReview } from './review/record.js';
import { sendReferral } from './referral/send.js';
import { chooseReader } from './ocr/engines.js';
import { aalOf } from './auth/aal.js';
import { makeTokenVerifier } from './auth/verifier.js';
import { shapeMe, type MembershipRow, type ProfileRow } from './auth/me.js';
import { makeAdminStore, makeSystemAdmin } from './admin/store.js';
import { makeMemberAdmin } from './admin/members.js';
import { makePlatformAdmin } from './admin/platform.js';
import { makeVisitFlow } from './visits/store.js';
import { makeStatusSms } from './sms/notify.js';
import { makeSmsStore } from './sms/store.js';
import { makeMockSender, makeTwilioSender } from './sms/twilio.js';
import { makeReferralBoard } from './referral/board.js';
import { makeHistoryStore } from './history/store.js';
import { makeNotesStore } from './notes/store.js';
import { envForTask, makeProvider } from './ai/provider.js';
import { makeVision } from './ai/vision.js';
import { makeTranscriber } from './ai/stt.js';
import type { FollowupStore, FollowupView } from './deps.js';
import { makeFileSink } from './training/sink.js';
import { isConsentActive } from './intake/consent.js';
import type { PatientFacts, TriageContext } from './intake/input.js';
import type { PatientRow, IdentifierRow, EncounterRow, VitalRow } from './fhir/project.js';

const PATIENT_COLS = 'id, public_ref, registered_facility_id, full_name, preferred_language, sex, birth_date, age_years_reported, phone, address_line, village_town, district, state, pincode, updated_at';
const ENCOUNTER_COLS = 'id, patient_id, facility_id, status, scenario, language, chief_complaint_original, chief_complaint_translated, submitted_at, closed_at, created_at, updated_at';
const BRIEF_COLS = 'id, public_ref, full_name, sex, birth_date, age_years_reported, preferred_language';
const TIER_OF: Record<string, number> = { red: 1, orange: 2, yellow: 3, green: 4 };
const REFERRAL_COLS = 'id, encounter_id, patient_id, from_facility_id, to_facility_id, requested_by, priority, reason_text, status, status_reason, sent_at, created_at, updated_at';
const FACILITY_COLS = 'id, name, type, state, district, capabilities:facility_capabilities(capability)';
const toFacility = (r: any): FacilityRow => ({ id: r.id, name: r.name, type: r.type ?? null, state: r.state ?? null, district: r.district ?? null, capabilities: ((r.capabilities ?? []) as { capability: string }[]).map(c => c.capability) });
const hex = (v: unknown): string | null => (typeof v === 'string' ? (v.startsWith('\\x') ? v.slice(2) : v) : null);
const DOC_COLS = 'id, patient_id, encounter_id, facility_id, kind, storage_path, mime_type, size_bytes, original_filename, scan_status, uploaded_by, created_at';
const FIELD_COLS_BASE = 'id, extraction_id, field_name, extracted_value_text, value_text, value_num, unit, reference_range_text, printed_flag, confidence, verified_by, verified_at';
const FIELD_COLS = FIELD_COLS_BASE + ', second_read, agreement';
const VITAL_COLS = 'id, encounter_id, kind, value, unit, measured_at';

export function makePool(config: Config): pg.Pool {
  return new pg.Pool({ connectionString: config.databaseUrl, max: 5, ssl: { rejectUnauthorized: false }, idleTimeoutMillis: 30_000 });
}

function smsDeps(config: Config, pool: pg.Pool): Pick<Deps, 'statusSms' | 'smsInbound'> {
  const store = makeSmsStore({ query: (sql, p) => pool.query(sql, p as unknown[]) });
  const twilio = config.sms.provider === 'twilio' ? makeTwilioSender({ accountSid: config.sms.accountSid, authToken: config.sms.authToken, from: config.sms.from, messagingServiceSid: config.sms.messagingServiceSid }) : null;
  const sender = twilio?.configured ? twilio : makeMockSender();
  return {
    statusSms: makeStatusSms(store, sender, config.sms.defaultCountry),
    ...(twilio?.configured && config.sms.authToken && config.sms.webhookUrl ? { smsInbound: { store, authToken: config.sms.authToken, webhookUrl: config.sms.webhookUrl } } : {}),
  };
}

export function makeLiveDeps(config: Config, pool: pg.Pool): Deps {
  const verifyToken = makeTokenVerifier<{ userId: string; aal: 'aal1' | 'aal2' }>(async token => {
    const { data, error } = await client().auth.getUser(token);
    if (!error && data.user) return { ok: { userId: data.user.id, aal: aalOf(token) } };
    const status = (error as { status?: number } | null)?.status;
    const unavailable = !error || status === undefined || status === 0 || status === 429 || status >= 500 || /fetch|network|timeout|retryable/i.test(`${(error as Error).name} ${error.message}`);
    return unavailable ? { unavailable: `${(error as Error | null)?.name ?? 'no user'} ${status ?? 'no status'}` } : { invalid: true };
  });
  const poolLike: PoolLike = {
    connect: async () => {
      const c = await pool.connect();
      return { query: async (sql, params) => ({ rows: (await c.query(sql, params as unknown[])).rows }), release: () => c.release() };
    },
  };
  const client = (token?: string) => createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });

  return {
    verifyToken,

    userReader(token, userId): UserReader {
      const sb = client(token);
      return {
        async getPatient(id) {
          const { data, error } = await sb.from('patients').select(PATIENT_COLS).eq('id', id).is('deleted_at', null).maybeSingle();
          if (error) throw new Error(error.message);
          return (data as PatientRow | null) ?? null;
        },
        async getIdentifiers(patientId) {
          const { data, error } = await sb.from('patient_identifiers').select('system, value').eq('patient_id', patientId);
          if (error) throw new Error(error.message);
          return (data ?? []) as IdentifierRow[];
        },
        async getEncounter(id) {
          const { data, error } = await sb.from('encounters').select(ENCOUNTER_COLS).eq('id', id).is('deleted_at', null).maybeSingle();
          if (error) throw new Error(error.message);
          return (data as EncounterRow | null) ?? null;
        },
        async getVitals(encounterId) {
          const { data, error } = await sb.from('vitals').select(VITAL_COLS).eq('encounter_id', encounterId).order('measured_at');
          if (error) throw new Error(error.message);
          return (data ?? []) as VitalRow[];
        },

        async getMe() {
          const [prof, mem] = await Promise.all([
            sb.from('profiles').select('user_id, display_name').eq('user_id', userId),
            sb.from('memberships').select('user_id, facility_id, role, is_active, facility:facilities(name, type)').eq('user_id', userId).eq('is_active', true),
          ]);
          if (prof.error) throw new Error(prof.error.message);
          if (mem.error) throw new Error(mem.error.message);
          return shapeMe(userId, (prof.data ?? []) as ProfileRow[], (mem.data ?? []) as unknown as MembershipRow[]);
        },

        async listDocuments(encounterId) {
          const { data, error } = await sb.from('documents').select(DOC_COLS).eq('encounter_id', encounterId).is('deleted_at', null).order('created_at');
          if (error) throw new Error(error.message);
          return (data ?? []) as unknown as DocumentRow[];
        },
        async getDocument(id) {
          const { data, error } = await sb.from('documents').select(DOC_COLS).eq('id', id).is('deleted_at', null).maybeSingle();
          if (error) throw new Error(error.message);
          return (data as unknown as DocumentRow | null) ?? null;
        },
        async getExtraction(documentId) {
          const e = await sb.from('extractions').select('id, document_id, engine, engine_version, status, language, avg_confidence, error, created_at, completed_at').eq('document_id', documentId).order('created_at', { ascending: false }).limit(1);
          if (e.error) throw new Error(e.error.message);
          const row = ((e.data ?? []) as any[])[0];
          if (!row) return null;
          let f: { data: unknown; error: { message: string } | null } = await sb.from('extracted_fields').select(FIELD_COLS).eq('extraction_id', row.id).order('created_at');
          if (f.error) f = await sb.from('extracted_fields').select(FIELD_COLS_BASE).eq('extraction_id', row.id).order('created_at');
          if (f.error) throw new Error(f.error.message);
          return { ...row, fields: (f.data ?? []) as unknown as FieldRow[] } as ExtractionView;
        },
        async listFacilities() {
          const { data, error } = await sb.from('facilities').select(FACILITY_COLS).eq('is_active', true).order('name');
          if (error) throw new Error(error.message);
          return ((data ?? []) as any[]).map(toFacility);
        },
        async getFacility(id) {
          const { data, error } = await sb.from('facilities').select(FACILITY_COLS).eq('id', id).maybeSingle();
          if (error) throw new Error(error.message);
          return data ? toFacility(data) : null;
        },
        async getReferral(id) {
          const { data, error } = await sb.from('referrals').select(REFERRAL_COLS + ', bundle, bundle_sha256').eq('id', id).maybeSingle();
          if (error) throw new Error(error.message);
          if (!data) return null;
          const r = data as any;
          return { ...r, bundle_sha256: hex(r.bundle_sha256) } as ReferralRow;
        },
        async listReferrals(encounterId) {
          const { data, error } = await sb.from('referrals').select(REFERRAL_COLS).eq('encounter_id', encounterId).order('created_at');
          if (error) throw new Error(error.message);
          return (data ?? []) as any[];
        },
        async getConsents(patientId) {
          const { data, error } = await sb.from('consents').select('id, purpose, granted_at, revoked_at, expires_at').eq('patient_id', patientId);
          if (error) throw new Error(error.message);
          return (data ?? []) as any[];
        },
        async getNames(ids) {
          const out: Record<string, string | null> = {};
          if (ids.length === 0) return out;
          const { data, error } = await sb.from('profiles').select('user_id, display_name').in('user_id', [...new Set(ids)]);
          if (error) throw new Error(error.message);
          for (const id of ids) out[id] = null;
          for (const p of (data ?? []) as { user_id: string; display_name: string }[]) out[p.user_id] = p.display_name;
          return out;
        },

        async listPatients(q, limit) {
          let query = sb.from('patients').select(BRIEF_COLS).is('deleted_at', null).order('full_name').limit(limit);
          if (q) query = query.or(`full_name.ilike.%${q}%,public_ref.ilike.%${q}%`);
          const { data, error } = await query;
          if (error) throw new Error(error.message);
          return (data ?? []) as unknown as PatientBrief[];
        },

        async getQueue() {
          const encs = await sb.from('encounters')
            .select(`id, facility_id, scenario, chief_complaint_original, chief_complaint_translated, status, submitted_at, created_at, patient:patients(${BRIEF_COLS})`)
            .in('status', ['submitted', 'in_review']).is('deleted_at', null).order('submitted_at', { ascending: true }).limit(200);
          if (encs.error) throw new Error(encs.error.message);
          const rows = (encs.data ?? []) as any[];
          if (rows.length === 0) return [];
          const ids = rows.map(r => r.id as string);
          const [qi, rv, as, dc] = await Promise.all([
            sb.from('queue_items').select('encounter_id, urgency_code, status, entered_at').in('encounter_id', ids),
            sb.from('review_actions').select('assessment_id').in('encounter_id', ids).in('action', ['approve', 'override_urgency']),
            sb.from('triage_assessments').select('id, encounter_id, version, urgency_code, note').in('encounter_id', ids).order('version', { ascending: false }),
            sb.from('documents').select('id, encounter_id, kind, mime_type, original_filename').in('encounter_id', ids).eq('scan_status', 'clean').order('created_at', { ascending: true }),
          ]);
          const docsBy = new Map<string, QueueDocument[]>();
          for (const d of (dc.error ? [] : (dc.data ?? [])) as { id: string; encounter_id: string; kind: string; mime_type: string; original_filename: string | null }[]) {
            const list = docsBy.get(d.encounter_id) ?? [];
            if (list.length < 3) list.push({ id: d.id, name: d.original_filename, mimeType: d.mime_type, kind: d.kind });
            docsBy.set(d.encounter_id, list);
          }
          if (qi.error) throw new Error(qi.error.message);
          if (as.error) throw new Error(as.error.message);
          if (rv.error) throw new Error(rv.error.message);
          const reviewedAssessments = new Set(((rv.data ?? []) as { assessment_id: string }[]).map(x => x.assessment_id));
          const queueBy = new Map<string, any>((qi.data ?? []).map((x: any) => [x.encounter_id, x]));
          const latest = new Map<string, any>();
          for (const a of (as.data ?? []) as any[]) if (!latest.has(a.encounter_id)) latest.set(a.encounter_id, a);
          return rows.map((r): QueueEntry => {
            const a = latest.get(r.id); const q = queueBy.get(r.id); const note = (a?.note ?? {}) as Record<string, any>;
            return {
              encounterId: r.id, patient: r.patient as PatientBrief, scenario: r.scenario, facilityId: r.facility_id,
              chiefComplaint: r.chief_complaint_original, chiefComplaintTranslated: r.chief_complaint_translated,
              assessed: !!a, urgencyCode: (q?.urgency_code ?? a?.urgency_code ?? null) as QueueEntry['urgencyCode'],
              tier: (q?.urgency_code ?? a?.urgency_code) ? TIER_OF[(q?.urgency_code ?? a?.urgency_code) as string] ?? null : null,
              engineTier: typeof note.tier === 'number' ? note.tier : null,
              reviewed: !!a && reviewedAssessments.has(a.id),
              potentialTier: typeof note.potentialTier === 'number' ? note.potentialTier : null,
              missingCount: Array.isArray(note.missing) ? note.missing.length : 0,
              winningLabel: typeof note.winning?.detail === 'string' ? note.winning.detail : null,
              vulnerable: note.vulnerable === true,
              queueStatus: q?.status ?? null, waitingSince: q?.entered_at ?? r.submitted_at ?? r.created_at ?? null,
              assessmentVersion: a?.version ?? null,
              documents: docsBy.get(r.id) ?? [],
            };
          });
        },

        async getEncounterSummary(id) {
          const e = await sb.from('encounters').select(`${ENCOUNTER_COLS}, context`).eq('id', id).is('deleted_at', null).maybeSingle();
          if (e.error) throw new Error(e.error.message);
          if (!e.data) return null;
          const { context, ...encounter } = e.data as any;
          const [pat, sym, vit, asm, fu, qi, rv] = await Promise.all([
            sb.from('patients').select(BRIEF_COLS).eq('id', encounter.patient_id).maybeSingle(),
            sb.from('symptom_entries').select('id, text_original, text_translated, lang, duration_value, duration_unit, severity, created_at').eq('encounter_id', id).order('created_at'),
            sb.from('vitals').select(VITAL_COLS).eq('encounter_id', id).order('measured_at'),
            sb.from('triage_assessments').select('id, version, created_at, urgency_code, note').eq('encounter_id', id).order('version', { ascending: false }).limit(1),
            sb.from('info_requests').select('field_code, question_text, status, answer_text').eq('encounter_id', id).order('created_at'),
            sb.from('queue_items').select('urgency_code, status, entered_at').eq('encounter_id', id).maybeSingle(),
            sb.from('review_actions').select('id, action, assessment_id, reviewer_id, from_urgency_code, to_urgency_code, reason, created_at').eq('encounter_id', id).order('created_at'),
          ]);
          for (const r of [pat, sym, vit, asm, fu, qi, rv]) if (r.error) throw new Error(r.error.message);
          if (!pat.data) return null;
          const a = ((asm.data ?? []) as any[])[0] ?? null;
          let signals: any[] = [];
          if (a) {
            const s = await sb.from('triage_signals').select('signal_code, kind, source, weight, display_text').eq('assessment_id', a.id);
            if (s.error) throw new Error(s.error.message);
            signals = s.data ?? [];
          }
          const reviewRows = (rv.data ?? []) as any[];
          const names = new Map<string, string | null>();
          if (reviewRows.length) {
            const p = await sb.from('profiles').select('user_id, display_name').in('user_id', [...new Set(reviewRows.map(r => r.reviewer_id as string))]);
            if (p.error) throw new Error(p.error.message);
            for (const x of (p.data ?? []) as { user_id: string; display_name: string }[]) names.set(x.user_id, x.display_name);
          }
          return {
            reviews: reviewRows.map(r => ({ ...r, reviewer_name: names.get(r.reviewer_id) ?? null })),
            encounter: encounter as EncounterRow, patient: pat.data as unknown as PatientBrief,
            symptoms: (sym.data ?? []) as any, vitals: (vit.data ?? []) as VitalRow[],
            triageContext: (context?.triage ?? {}) as TriageContext,
            assessment: a ? { ...a, signals } : null,
            followUps: (fu.data ?? []) as any,
            queue: (qi.data ?? null) as any,
          };
        },
      };
    },

    userWriter(token, userId): UserWriter {
      const sb = client(token);
      const ok = <T,>(r: { data: T | null; error: { code?: string; message: string } | null }): T => {
        if (r.error) throw new DbError(r.error.code ?? 'XX000', r.error.message);
        return r.data as T;
      };
      return {
        async hasActiveConsent(patientId, purpose) {
          const rows = ok(await sb.from('consents').select('revoked_at, expires_at, granted_at').eq('patient_id', patientId).eq('purpose', purpose));
          return isConsentActive((rows ?? []) as { revoked_at: string | null; expires_at: string | null; granted_at: string | null }[]);
        },
        async recordConsent(c) {
          const r = ok(await sb.from('consents').insert({
            patient_id: c.patientId, purpose: c.purpose, given_by: c.givenBy, method: c.method, notice_version: c.noticeVersion,
            witness_name: c.witnessName ?? null, expires_at: c.expiresAt ?? null, captured_by: userId,
          }).select('id').single());
          return { id: (r as unknown as { id: string }).id };
        },
        async registerPatient(p) {
          const r = ok(await sb.from('patients').insert({
            registered_facility_id: p.facilityId, full_name: p.fullName, sex: p.sex, birth_date: p.birthDate ?? null, age_years_reported: p.birthDate ? null : p.ageYears ?? null,
            preferred_language: p.preferredLanguage, phone: p.phone ?? null, village_town: p.villageTown ?? null, district: p.district ?? null, state: p.state ?? null, pincode: p.pincode ?? null, created_by: userId,
          }).select('id, public_ref').single()) as unknown as { id: string; public_ref: string };
          return { id: r.id, publicRef: r.public_ref };
        },
        async createEncounter(e) {
          const r = ok(await sb.from('encounters').insert({
            patient_id: e.patientId, facility_id: e.facilityId, scenario: e.scenario, language: e.language, status: 'draft',
            channel: 'staff_assisted', chief_complaint_original: e.chiefComplaint ?? null, created_by: userId,
          }).select(ENCOUNTER_COLS).single());
          return r as unknown as EncounterRow;
        },
        async addSymptom(encounterId, s) {
          const r = ok(await sb.from('symptom_entries').insert({
            encounter_id: encounterId, text_original: s.text, lang: s.lang ?? null, source: 'health_worker',
            duration_value: s.durationValue ?? null, duration_unit: s.durationUnit ?? null, severity: s.severity ?? null, recorded_by: userId,
          }).select('id').single());
          return { id: (r as unknown as { id: string }).id };
        },
        async addVital(encounterId, v) {
          const r = ok(await sb.from('vitals').insert({ encounter_id: encounterId, kind: v.kind, value: v.value, unit: v.unit, measured_by: userId }).select('id').single());
          return { id: (r as unknown as { id: string }).id };
        },
        async patientFacts(patientId): Promise<PatientFacts | null> {
          const p = ok(await sb.from('patients').select('birth_date, age_years_reported, sex').eq('id', patientId).is('deleted_at', null).maybeSingle());
          if (!p) return null;
          const preg = ok(await sb.from('pregnancy_episodes').select('id').eq('patient_id', patientId).eq('status', 'ongoing').limit(1));
          return { ...(p as Omit<PatientFacts, 'pregnancyOngoing'>), pregnancyOngoing: (preg ?? []).length > 0 };
        },
        async getTriageContext(encounterId): Promise<TriageContext> {
          const r = ok(await sb.from('encounters').select('context').eq('id', encounterId).maybeSingle()) as { context?: { triage?: TriageContext } } | null;
          return r?.context?.triage ?? {};
        },
        async setTriageContext(encounterId, ctx) {
          const cur = ok(await sb.from('encounters').select('context').eq('id', encounterId).maybeSingle()) as { context?: Record<string, unknown> } | null;
          if (!cur) throw new DbError('42501', 'encounter not visible');
          const upd = ok(await sb.from('encounters').update({ context: { ...(cur.context ?? {}), triage: ctx } }).eq('id', encounterId).select('id'));
          if (!upd || (upd as unknown[]).length === 0) throw new DbError('42501', 'update affected no rows');
        },
        async submitEncounter(encounterId) {
          const upd = ok(await sb.from('encounters').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', encounterId).eq('status', 'draft').select('id'));
          if (!upd || (upd as unknown[]).length === 0) throw new DbError('42501', 'update affected no rows');
        },
        async listOpenInfoCodes(encounterId) {
          const r = ok(await sb.from('info_requests').select('field_code').eq('encounter_id', encounterId).eq('status', 'open'));
          return ((r ?? []) as { field_code: string | null }[]).map(x => x.field_code).filter((x): x is string => !!x);
        },
        async dismissInfoRequests(encounterId, keepCodes) {
          const open = ok(await sb.from('info_requests').select('id, field_code').eq('encounter_id', encounterId).eq('status', 'open')) as { id: string; field_code: string | null }[] | null;
          const stale = (open ?? []).filter(r => r.field_code && !keepCodes.includes(r.field_code)).map(r => r.id);
          if (stale.length === 0) return 0;
          ok(await sb.from('info_requests').update({ status: 'dismissed' }).in('id', stale).eq('status', 'open'));
          return stale.length;
        },
        async addInfoRequests(encounterId, items) {
          ok(await sb.from('info_requests').insert(items.map(i => ({ encounter_id: encounterId, audience: 'health_worker', field_code: i.fieldCode, question_text: i.question, lang: i.lang }))));
        },
        async createReferral(r) {
          const x = ok(await sb.from('referrals').insert({
            encounter_id: r.encounterId, patient_id: r.patientId, from_facility_id: r.fromFacilityId, to_facility_id: r.toFacilityId,
            requested_by: userId, priority: r.priority, reason_text: r.reasonText, status: 'draft',
          }).select(REFERRAL_COLS).single());
          return x as unknown as ReferralRow;
        },
        async updateReferralDraft(id, p) {
          const patch: Record<string, unknown> = {};
          if (p.toFacilityId !== undefined) patch.to_facility_id = p.toFacilityId;
          if (p.priority !== undefined) patch.priority = p.priority;
          if (p.reasonText !== undefined) patch.reason_text = p.reasonText;
          const upd = ok(await sb.from('referrals').update(patch).eq('id', id).eq('status', 'draft').select('id'));
          if (!upd || (upd as unknown[]).length === 0) throw new DbError('42501', 'update affected no rows');
        },
        async createDocument(d) {
          const x = ok(await sb.from('documents').insert({
            id: d.id, patient_id: d.patientId, encounter_id: d.encounterId, facility_id: d.facilityId, kind: d.kind, storage_path: d.storagePath,
            mime_type: d.mimeType, size_bytes: d.sizeBytes, original_filename: d.originalFilename, uploaded_by: userId,
          }).select(DOC_COLS).single());
          return x as unknown as DocumentRow;
        },
        async uploadObject(path, bytes, mime) {
          const { error } = await sb.storage.from('patient-documents').upload(path, bytes, { contentType: mime, upsert: false });
          if (error) throw new Error(error.message);
        },
        async downloadObject(path) {
          const { data, error } = await sb.storage.from('patient-documents').download(path);
          if (error || !data) throw new Error(error?.message ?? 'no data');
          return Buffer.from(await data.arrayBuffer());
        },
        async verifyField(fieldId, v) {
          const upd = ok(await sb.from('extracted_fields').update({ value_text: v.valueText, value_num: v.valueNum, unit: v.unit, verified_by: userId, verified_at: new Date().toISOString() }).eq('id', fieldId).select('id'));
          if (!upd || (upd as unknown[]).length === 0) throw new DbError('42501', 'update affected no rows');
        },
        async setComplaintTranslation(encounterId, text) {
          const upd = ok(await sb.from('encounters').update({ chief_complaint_translated: text }).eq('id', encounterId).select('id'));
          if (!upd || (upd as unknown[]).length === 0) throw new DbError('42501', 'update affected no rows');
        },
        async cancelReferral(id, reason) {
          const upd = ok(await sb.from('referrals').update({ status: 'cancelled', status_reason: reason }).eq('id', id).eq('status', 'draft').select('id'));
          if (!upd || (upd as unknown[]).length === 0) throw new DbError('42501', 'update affected no rows');
        },
        async answerInfoRequests(encounterId, answers) {
          for (const a of answers)
            ok(await sb.from('info_requests').update({ status: 'answered', answer_text: a.answer, answered_by: userId, answered_at: new Date().toISOString() })
              .eq('encounter_id', encounterId).eq('field_code', a.fieldCode).eq('status', 'open'));
        },
      };
    },

    assess: args => assessEncounter(poolLike, args),
    review: args => recordReview(poolLike, args),
    sendReferral: args => sendReferral(poolLike, args),
    readText: chooseReader(config.OCR_PROVIDER, { langPath: config.TESSDATA_PATH }),
    translator: makeProvider(envForTask(config.ai, 'TRANSLATE')),
    loadRuleSet: async (name, version) => (await loadRuleSet(pool, name, version)).ruleSet,
    triageAi: makeProvider(envForTask(config.ai, 'TRIAGE')),
    ...(config.TRAINING_EXPORT === 'on' ? { trainingSink: makeFileSink(config.TRAINING_DATA_DIR?.trim() || 'training-data') } : {}),
    transcriber: makeTranscriber(envForTask(config.ai, 'STT')),
    vision: makeVision(envForTask(config.ai, 'VISION')),
    adminStore: token => makeAdminStore(client(token)),
    ...smsDeps(config, pool),
    visitFlow: makeVisitFlow({ query: (sql, p) => pool.query(sql, p as unknown[]) }),
    memberAdmin: makeMemberAdmin({ query: (sql, p) => pool.query(sql, p as unknown[]) }),
    platformAdmin: makePlatformAdmin({ query: (sql, p) => pool.query(sql, p as unknown[]) }),
    notes: (token, userId) => makeNotesStore(client(token), userId),
    vitalHistory: token => ({
      async forPatient(patientId, kinds, limit) {
        const { data, error } = await client(token).from('vitals').select('kind, value, unit, measured_at, encounter_id, encounter:encounters!inner(patient_id)').eq('encounter.patient_id', patientId).in('kind', kinds).order('measured_at', { ascending: false }).limit(limit);
        if (error) throw new Error(error.message);
        return ((data ?? []) as any[]).map(r => ({ kind: r.kind, value: Number(r.value), unit: r.unit, measured_at: r.measured_at, encounter_id: r.encounter_id })).reverse();
      },
    }),
    labHistory: token => ({
      async forPatient(patientId, limit) {
        const sb = client(token);
        const enc = await sb.from('encounters').select('id').eq('patient_id', patientId).limit(200);
        if (enc.error) throw new Error(enc.error.message);
        const encIds = ((enc.data ?? []) as { id: string }[]).map(r => r.id);
        if (encIds.length === 0) return [];
        const docs = await sb.from('documents').select('id, encounter_id, created_at').in('encounter_id', encIds).eq('scan_status', 'clean').is('deleted_at', null);
        if (docs.error) throw new Error(docs.error.message);
        const docRows = (docs.data ?? []) as { id: string; encounter_id: string; created_at: string }[];
        if (docRows.length === 0) return [];
        const ex = await sb.from('extractions').select('id, document_id, created_at').in('document_id', docRows.map(d => d.id)).eq('status', 'completed').order('created_at', { ascending: false });
        if (ex.error) throw new Error(ex.error.message);
        const latest = new Map<string, string>();
        for (const r of (ex.data ?? []) as { id: string; document_id: string }[]) if (!latest.has(r.document_id)) latest.set(r.document_id, r.id);
        const byEx = new Map([...latest.entries()].map(([docId, exId]) => [exId, docRows.find(d => d.id === docId)!]));
        if (byEx.size === 0) return [];
        const f = await sb.from('extracted_fields').select('extraction_id, field_name, value_num, value_text, extracted_value_text, unit, printed_flag, verified_at').in('extraction_id', [...byEx.keys()]);
        if (f.error) throw new Error(f.error.message);
        return ((f.data ?? []) as any[]).slice(0, limit).map(r => {
          const d = byEx.get(r.extraction_id)!;
          return { name: r.field_name, valueNum: r.value_num === null ? null : Number(r.value_num), valueText: r.value_text ?? r.extracted_value_text ?? null, unit: r.unit ?? null, printedFlag: r.printed_flag ?? null, verified: !!r.verified_at, at: d.created_at, documentId: d.id, encounterId: d.encounter_id };
        });
      },
    }),
    history: (token, userId) => makeHistoryStore(client(token), userId),
    referralBoard: token => makeReferralBoard(client(token), BRIEF_COLS),
    systemAdmin: makeSystemAdmin({ query: (sql, p) => pool.query(sql, p as unknown[]) }),
    async saveSymptomTranslations(items) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        for (const it of items) await c.query('update public.symptom_entries set text_translated = $2 where id = $1 and text_translated is null', [it.id, it.text]);
        await c.query('commit');
      } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
    },
    followups(token, userId): FollowupStore {
      const sb = client(token);
      const COLS = 'id, patient_id, facility_id, kind, cadence_days, next_due_at, active, created_at, reminders(id, due_at, channel, status, sent_at)';
      const ok = <T,>(r: { data: T | null; error: { code?: string; message: string } | null }): T => { if (r.error) throw new DbError(r.error.code ?? 'XX000', r.error.message); return r.data as T; };
      return {
        async list(patientId) { return (ok(await sb.from('followup_schedules').select(COLS).eq('patient_id', patientId).order('created_at', { ascending: false })) ?? []) as unknown as FollowupView[]; },
        async get(id) { return (ok(await sb.from('followup_schedules').select(COLS).eq('id', id).maybeSingle()) ?? null) as unknown as FollowupView | null; },
        async create(a) {
          const r = ok(await sb.from('followup_schedules').insert({ patient_id: a.patientId, facility_id: a.facilityId, kind: a.kind, cadence_days: a.cadenceDays, next_due_at: a.nextDueAt, created_by: userId }).select('id').single());
          return { id: (r as unknown as { id: string }).id };
        },
        async stop(id) { ok(await sb.from('followup_schedules').update({ active: false }).eq('id', id).select('id').single()); },
      };
    },
    async scheduleReminder(a) {
      const r = await pool.query('insert into public.reminders (schedule_id, consent_id, due_at, channel) values ($1,$2,$3::timestamptz,$4) returning id', [a.scheduleId, a.consentId, a.dueAt, a.channel]);
      return { id: r.rows[0].id as string };
    },
    async logExternalRun(a) {
      await pool.query(
        'insert into public.external_signal_runs (encounter_id, provider, model, consent_id, deidentified, sent_fields, status, reliability_passed) values ($1,$2,$3,$4,true,$5::jsonb,$6,false)',
        [a.encounterId, a.provider, a.model, a.consentId, JSON.stringify({ purpose: a.purpose ?? 'translation', items: a.items, chars: a.chars }), a.status]);
    },

    async finishUpload(a) {
      const r = await pool.query(`update public.documents set scan_status = 'clean', sha256 = decode($2, 'hex'), size_bytes = $3 where id = $1 and scan_status = 'pending'`, [a.documentId, a.sha256, a.sizeBytes]);
      if (r.rowCount !== 1) throw new Error('document was not pending');
    },
    async failUpload(documentId) { await pool.query(`update public.documents set scan_status = 'failed' where id = $1 and scan_status = 'pending'`, [documentId]); },
    async saveExtraction(a) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const d = await c.query("select 1 from public.documents where id = $1 and scan_status = 'clean' and deleted_at is null", [a.documentId]);
        if (d.rowCount !== 1) throw new Error('document is not available');
        const e = await c.query(
          'insert into public.extractions (document_id, engine, engine_version, status, language, raw_text, avg_confidence, error, completed_at) values ($1,$2,$3,$4::public.job_status,$5,$6,$7,$8, now()) returning id',
          [a.documentId, a.engine, a.engineVersion, a.status, a.language, a.rawText, a.avgConfidence, a.error]);
        const id: string = e.rows[0].id;
        for (const f of a.fields) {
          if (f.agreement || f.secondRead)
            await c.query('insert into public.extracted_fields (extraction_id, field_name, extracted_value_text, value_text, value_num, unit, reference_range_text, printed_flag, confidence, second_read, agreement) values ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10)',
              [id, f.fieldName, f.extractedValueText, f.valueNum, f.unit, f.referenceRangeText, f.printedFlag, f.confidence, f.secondRead ?? null, f.agreement ?? null]);
          else
            await c.query('insert into public.extracted_fields (extraction_id, field_name, extracted_value_text, value_text, value_num, unit, reference_range_text, printed_flag, confidence) values ($1,$2,$3,$3,$4,$5,$6,$7,$8)',
              [id, f.fieldName, f.extractedValueText, f.valueNum, f.unit, f.referenceRangeText, f.printedFlag, f.confidence]);
        }
        await c.query('commit');
        return { extractionId: id };
      } catch (err) { await c.query('rollback').catch(() => {}); throw err; } finally { c.release(); }
    },

    async audit(e: AuditEvent) {
      await pool.query(
        'select app.write_audit($1::public.audit_action, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::public.audit_outcome, $8, $9::inet, $10, $11, $12::jsonb)',
        [e.action, e.entityType, e.entityId ?? null, e.patientId ?? null, e.facilityId ?? null, e.actor ?? null,
         e.outcome, e.requestId ?? null, e.ip && isIP(e.ip) ? e.ip : null, e.userAgent?.slice(0, 300) ?? null,
         e.reason ?? null, JSON.stringify(e.details ?? {})],
      );
    },
  };
}
