import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OperationOutcome } from 'fhir/r4';
import { z } from 'zod';
import type { AuditEvent, Deps, UserWriter } from '../deps.js';
import { DbError } from '../deps.js';
import type { EncounterRow } from '../fhir/project.js';
import { VITALS, MMHG } from '../fhir/codes.js';
import { RULESET_DRAFT } from '../triage/ruleset.draft.js';
import { RULESET_PROPOSED } from '../triage/ruleset.proposed.js';
import { compareWithRules, secondOpinion } from './aiOpinion.js';
import { askableFloors, CORE_SIGNS, MIN_SIGN_QUESTIONS, QUESTION_BUDGET, selectRelevantSigns } from '../triage/relevance.js';
import { triage } from '../triage/engine.js';
import { buildTriageInput, type TriageContext } from '../intake/input.js';
import { buildFollowUps } from '../intake/followups.js';
import { DISCLAIMER, RuleSetUnavailable } from '../triage/persist.js';
import { NonDiagnosticViolation } from '../guard/nonDiagnostic.js';

type Code = OperationOutcome['issue'][number]['code'];
export interface RouteCtx {
  app: FastifyInstance;
  deps: Deps;
  authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  fail: (reply: FastifyReply, status: number, code: Code, text: string) => FastifyReply;
  base: (req: FastifyRequest) => Pick<AuditEvent, 'actor' | 'requestId' | 'ip' | 'userAgent'>;
  auditOrFail: (req: FastifyRequest, reply: FastifyReply, ev: Omit<AuditEvent, 'actor' | 'requestId' | 'ip' | 'userAgent'>) => Promise<boolean>;
  triageRuleSet: { name: string; version: string };
  requireMfa: (req: FastifyRequest, reply: FastifyReply, what: string) => Promise<boolean>;
  mfaRequired: boolean;
  ocrPhotos: 'local' | 'ai' | 'ai_then_local';
  jobs: import('../jobs/queue.js').JobQueue;
}

const uuid = z.string().uuid();
const SCENARIOS = ['opd_queue', 'occupational', 'campus_fever', 'maternal_followup', 'chronic_checkin', 'health_camp', 'referral_intake', 'other'] as const;
const SIGN_CODES = new Set([...RULESET_DRAFT.floors, ...RULESET_PROPOSED.floors].map(f => f.sign));
const EDITABLE = new Set(['draft', 'submitted', 'in_review']);

const consentBody = z.object({
  purpose: z.enum(['care_triage', 'referral_sharing', 'external_ai_processing', 'reminders', 'status_messages', 'research_deidentified']).default('care_triage'),
  givenBy: z.enum(['self', 'guardian', 'representative']).default('self'),
  method: z.enum(['digital', 'verbal_witnessed', 'paper']),
  noticeVersion: z.string().min(1).max(40),
  witnessName: z.string().min(1).max(120).optional(),
  expiresAt: z.string().datetime().optional(),
}).strict();

const encounterBody = z.object({
  patientId: uuid, facilityId: uuid.optional(),
  scenario: z.enum(SCENARIOS).default('opd_queue'),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/).default('en'),
  chiefComplaint: z.string().trim().min(1, 'A main complaint is needed. For a routine check-up, write Routine.').max(2000),
}).strict();

const symptomBody = z.object({
  text: z.string().min(1).max(2000),
  lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/).optional(),
  durationValue: z.number().min(0).max(100000).optional(),
  durationUnit: z.enum(['minutes', 'hours', 'days', 'weeks', 'months', 'years']).optional(),
  severity: z.number().int().min(0).max(10).optional(),
}).strict().refine(b => (b.durationValue === undefined) === (b.durationUnit === undefined), { message: 'Give both durationValue and durationUnit, or neither.', path: ['durationValue'] });

const VITAL_KINDS = ['temperature_c', 'spo2_pct', 'pulse_bpm', 'resp_rate_pm', 'bp_systolic_mmhg', 'bp_diastolic_mmhg', 'weight_kg', 'height_cm', 'blood_glucose_mgdl', 'muac_cm'] as const;
const vitalBody = z.object({ kind: z.enum(VITAL_KINDS), value: z.number().finite() }).strict();
const unitFor = (k: (typeof VITAL_KINDS)[number]) => (k === 'bp_systolic_mmhg' || k === 'bp_diastolic_mmhg' ? MMHG.ucum : VITALS[k].ucum);

const inputsBody = z.object({
  consciousness: z.enum(['alert', 'confusion', 'voice', 'pain', 'unresponsive']).nullable().optional(),
  onSupplementalOxygen: z.boolean().nullable().optional(),
  pregnant: z.boolean().nullable().optional(),
  signs: z.record(z.string(), z.boolean()).optional(),
}).strict().superRefine((b, ctx) => {
  for (const k of Object.keys(b.signs ?? {})) if (!SIGN_CODES.has(k)) ctx.addIssue({ code: 'custom', message: 'Unknown sign code.', path: ['signs'] });
});

export interface RouteHelpers {
  invalid: (reply: FastifyReply, e: z.ZodError) => FastifyReply;
  dbFail: (req: FastifyRequest, reply: FastifyReply, err: unknown) => FastifyReply;
  note: (req: FastifyRequest, ev: Omit<AuditEvent, 'actor' | 'requestId' | 'ip' | 'userAgent'>) => Promise<void>;
  writerFor: (req: FastifyRequest) => UserWriter;
  openEncounter: (req: FastifyRequest, reply: FastifyReply, requireEditable: boolean) => Promise<{ enc: EncounterRow; w: UserWriter } | null>;
}

export function registerIntakeRoutes(c: RouteCtx): RouteHelpers {
  const { app, deps, authenticate, fail } = c;

  const invalid = (reply: FastifyReply, e: z.ZodError) =>
    fail(reply, 400, 'invalid', 'Check these fields: ' + [...new Set(e.issues.map(i => (i.path.join('.') || 'body') + ' (' + i.message + ')'))].join('; '));

  const dbFail = (req: FastifyRequest, reply: FastifyReply, err: unknown) => {
    const e = err as DbError;
    req.log.error({ reqId: req.id, code: e.code, err: e.message }, 'database rejected a write');
    if (e instanceof DbError && e.code === '42501') return fail(reply, 403, 'forbidden', 'You are not allowed to do this at this facility.');
    if (e instanceof DbError && /^2[23]/.test(e.code)) return fail(reply, 422, 'invalid', 'A value is not valid or is outside the allowed range.');
    return fail(reply, 502, 'transient', 'The change could not be saved. Try again.');
  };
  const note = (req: FastifyRequest, ev: Omit<AuditEvent, 'actor' | 'requestId' | 'ip' | 'userAgent'>) =>
    deps.audit({ ...c.base(req), ...ev }).catch(err => req.log.error({ reqId: req.id, err: (err as Error).message }, 'audit write failed'));

  const writerFor = (req: FastifyRequest): UserWriter => deps.userWriter(req.headers.authorization!.slice(7).trim(), req.user!.userId);

  async function openEncounter(req: FastifyRequest, reply: FastifyReply, requireEditable: boolean): Promise<{ enc: EncounterRow; w: UserWriter } | null> {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) { fail(reply, 400, 'invalid', 'Encounter id must be a UUID.'); return null; }
    const enc = await req.reader!.getEncounter(id.data).catch(() => undefined);
    if (enc === undefined) { fail(reply, 502, 'transient', 'The record could not be loaded. Try again.'); return null; }
    if (!enc) { fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.'); return null; }
    const w = writerFor(req);
    const consent = await w.hasActiveConsent(enc.patient_id, 'care_triage').catch(() => undefined);
    if (consent === undefined) { fail(reply, 502, 'transient', 'Consent could not be checked. Try again.'); return null; }
    if (!consent) { fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record consent first.'); return null; }
    if (requireEditable && !EDITABLE.has(enc.status)) { fail(reply, 409, 'conflict', `This encounter is ${enc.status} and can no longer be changed.`); return null; }
    return { enc, w };
  }

  app.post('/patients/:id/consents', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Patient id must be a UUID.');
    const body = consentBody.safeParse(req.body);
    if (!body.success) return invalid(reply, body.error);
    if (body.data.method === 'verbal_witnessed' && !body.data.witnessName)
      return fail(reply, 400, 'invalid', 'A witness name is required when consent is given verbally.');
    const patient = await req.reader!.getPatient(id.data).catch(() => undefined);
    if (patient === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!patient) return fail(reply, 404, 'not-found', 'No such patient, or you do not have access.');
    try {
      const r = await writerFor(req).recordConsent({ patientId: patient.id, ...body.data });
      await note(req, { action: 'consent_change', entityType: 'consent', entityId: r.id, patientId: patient.id, facilityId: patient.registered_facility_id, outcome: 'success', details: { purpose: body.data.purpose, method: body.data.method } });
      return reply.code(201).send({ id: r.id });
    } catch (err) { return dbFail(req, reply, err); }
  });

  app.post('/encounters', { preHandler: authenticate }, async (req, reply) => {
    const body = encounterBody.safeParse(req.body);
    if (!body.success) return invalid(reply, body.error);
    const patient = await req.reader!.getPatient(body.data.patientId).catch(() => undefined);
    if (patient === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!patient) return fail(reply, 404, 'not-found', 'No such patient, or you do not have access.');
    const w = writerFor(req);
    const consent = await w.hasActiveConsent(patient.id, 'care_triage').catch(() => undefined);
    if (consent === undefined) return fail(reply, 502, 'transient', 'Consent could not be checked. Try again.');
    if (!consent) return fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record consent first.');
    try {
      const enc = await w.createEncounter({ patientId: patient.id, facilityId: body.data.facilityId ?? patient.registered_facility_id, scenario: body.data.scenario, language: body.data.language, chiefComplaint: body.data.chiefComplaint });
      await note(req, { action: 'create', entityType: 'encounter', entityId: enc.id, patientId: patient.id, facilityId: enc.facility_id, outcome: 'success' });
      return reply.code(201).send({ id: enc.id, status: enc.status });
    } catch (err) { return dbFail(req, reply, err); }
  });

  app.post('/encounters/:id/symptoms', { preHandler: authenticate }, async (req, reply) => {
    const body = symptomBody.safeParse(req.body);
    if (!body.success) return invalid(reply, body.error);
    const ctx = await openEncounter(req, reply, true); if (!ctx) return;
    try {
      const r = await ctx.w.addSymptom(ctx.enc.id, body.data);
      await note(req, { action: 'create', entityType: 'symptom_entry', entityId: r.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success' });
      return reply.code(201).send({ id: r.id });
    } catch (err) { return dbFail(req, reply, err); }
  });

  app.post('/encounters/:id/vitals', { preHandler: authenticate }, async (req, reply) => {
    const body = vitalBody.safeParse(req.body);
    if (!body.success) return invalid(reply, body.error);
    const ctx = await openEncounter(req, reply, true); if (!ctx) return;
    try {
      const r = await ctx.w.addVital(ctx.enc.id, { kind: body.data.kind, value: body.data.value, unit: unitFor(body.data.kind) });
      await ctx.w.answerInfoRequests(ctx.enc.id, [{ fieldCode: `vital.${body.data.kind}`, answer: String(body.data.value) }]).catch(() => {});
      await note(req, { action: 'create', entityType: 'vital', entityId: r.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success' });
      return reply.code(201).send({ id: r.id });
    } catch (err) { return dbFail(req, reply, err); }
  });

  app.put('/encounters/:id/triage-inputs', { preHandler: authenticate }, async (req, reply) => {
    const body = inputsBody.safeParse(req.body);
    if (!body.success) return invalid(reply, body.error);
    const ctx = await openEncounter(req, reply, true); if (!ctx) return;
    try {
      const cur = await ctx.w.getTriageContext(ctx.enc.id);
      const b = body.data;
      const next: TriageContext = {
        ...cur,
        ...(b.consciousness !== undefined ? { consciousness: b.consciousness } : {}),
        ...(b.onSupplementalOxygen !== undefined ? { onSupplementalOxygen: b.onSupplementalOxygen } : {}),
        ...(b.pregnant !== undefined ? { pregnant: b.pregnant } : {}),
        signs: { ...(cur.signs ?? {}), ...(b.signs ?? {}) },
      };
      await ctx.w.setTriageContext(ctx.enc.id, next);
      const answers = [
        ...Object.entries(b.signs ?? {}).map(([k, v]) => ({ fieldCode: `sign.${k}`, answer: v ? 'yes' : 'no' })),
        ...(b.consciousness != null ? [{ fieldCode: 'vital.consciousness', answer: b.consciousness }] : []),
        ...(b.onSupplementalOxygen != null ? [{ fieldCode: 'vital.oxygen', answer: b.onSupplementalOxygen ? 'yes' : 'no' }] : []),
        ...(b.pregnant != null ? [{ fieldCode: 'context.pregnancy_status', answer: b.pregnant ? 'yes' : 'no' }] : []),
      ];
      if (answers.length) await ctx.w.answerInfoRequests(ctx.enc.id, answers).catch(() => {});
      await note(req, { action: 'update', entityType: 'encounter', entityId: ctx.enc.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success', details: { fields: Object.keys(b) } });
      return reply.send({ ok: true, context: next });
    } catch (err) { return dbFail(req, reply, err); }
  });

  app.post('/encounters/:id/submit', { preHandler: authenticate }, async (req, reply) => {
    const ctx = await openEncounter(req, reply, false); if (!ctx) return;
    if (ctx.enc.status !== 'draft') return fail(reply, 409, 'conflict', `This encounter is already ${ctx.enc.status}.`);
    try {
      await ctx.w.submitEncounter(ctx.enc.id);
      await note(req, { action: 'update', entityType: 'encounter', entityId: ctx.enc.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success', details: { status: 'submitted' } });
      return reply.send({ id: ctx.enc.id, status: 'submitted' });
    } catch (err) { return dbFail(req, reply, err); }
  });

  app.post('/encounters/:id/assess', { preHandler: authenticate }, async (req, reply) => {
    const ctx = await openEncounter(req, reply, true); if (!ctx) return;
    const { enc, w } = ctx;
    const [facts, vitals, tctx] = await Promise.all([
      w.patientFacts(enc.patient_id), req.reader!.getVitals(enc.id), w.getTriageContext(enc.id),
    ]).catch(() => [undefined, undefined, undefined] as const);
    if (!facts || !vitals || !tctx) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');

    const input = buildTriageInput(facts, vitals, tctx);
    const rs = await deps.loadRuleSet?.(c.triageRuleSet.name, c.triageRuleSet.version).catch(() => null) ?? null;
    const sum = rs ? await req.reader!.getEncounterSummary(enc.id).catch(() => null) : null;
    const wordsText = [enc.chief_complaint_translated ?? enc.chief_complaint_original ?? '', ...(sum?.symptoms ?? []).map(x => x.text_translated ?? x.text_original)].join('. ');
    const candidates = rs ? askableFloors(input, rs).map(f => ({ code: f.sign, label: f.label, question: f.question, must: CORE_SIGNS.includes(f.sign) })) : [];
    const ai = await secondOpinion(deps, req, enc, input, facts.sex, candidates);
    const nonSign = rs ? triage({ ...input, relevantSigns: [] }, rs).missing.filter(m => !m.code.startsWith('sign.')).length : 0;
    const relevance = rs ? selectRelevantSigns(input, rs, wordsText, ai.ask, Math.max(MIN_SIGN_QUESTIONS, QUESTION_BUDGET - nonSign)) : null;
    if (relevance) input.relevantSigns = relevance.signs;
    if (ai.tier != null) input.externalHints = [{ code: 'ai_second_opinion', tier: ai.tier, source: 'external_secondary' }];

    let result;
    try {
      result = await deps.assess({ encounterId: enc.id, facilityId: enc.facility_id, ruleSetName: c.triageRuleSet.name, ruleSetVersion: c.triageRuleSet.version, input, aiOpinion: ai.tier != null && ai.reason ? { tier: ai.tier, reason: ai.reason, provider: ai.provider ?? '', model: ai.model ?? '' } : null, aiStatus: ai.status });
    } catch (err) {
      if (err instanceof RuleSetUnavailable) {
        req.log.warn({ reqId: req.id, reason: err.reason }, 'triage rules unavailable');
        return fail(reply, 503, 'not-supported', 'Triage rules are not approved yet, so no assessment was stored. A qualified reviewer must approve the rule set first.');
      }
      if (err instanceof NonDiagnosticViolation) {
        req.log.error({ reqId: req.id, rules: err.findings.map(f => f.rule) }, 'assessment blocked by non-diagnostic guard');
        return fail(reply, 500, 'exception', 'The assessment was blocked by a safety check and nothing was stored. The incident was logged.');
      }
      req.log.error({ reqId: req.id, err: (err as Error).message }, 'assessment failed');
      return fail(reply, 502, 'transient', 'The assessment could not be completed. Try again.');
    }

    const MAX_QUESTIONS = QUESTION_BUDGET + 3;
    const followUps = buildFollowUps(result.decision.missing, result.ruleSet, relevance ? MAX_QUESTIONS : undefined, ai.phrasing);
    let followUpsSaved = true;
    try {
      const open = new Set(await w.listOpenInfoCodes(enc.id));
      const fresh = followUps.filter(f => !open.has(f.fieldCode));
      if (relevance) await w.dismissInfoRequests?.(enc.id, followUps.map(f => f.fieldCode)).catch(() => 0);
      if (fresh.length) await w.addInfoRequests(enc.id, fresh.map(f => ({ fieldCode: f.fieldCode, question: f.question, lang: f.lang })));
    } catch (err) { followUpsSaved = false; req.log.error({ reqId: req.id, err: (err as Error).message }, 'follow-up questions could not be saved'); }

    if (!(await c.auditOrFail(req, reply, { action: 'create', entityType: 'triage_assessment', entityId: result.assessmentId, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { version: result.version, tier: result.decision.tier, aiStatus: ai.status, aiTier: ai.tier, questionsFrom: relevance?.source ?? 'all', questionsWorded: followUps.filter(f => f.wording === 'ai').length, rulesTier: compareWithRules(ai, result.decision.log).rulesTier, ruleSet: `${result.ruleSet.name}@${result.ruleSet.version}` } }))) return;

    const d = result.decision;
    return reply.send({
      disclaimer: DISCLAIMER,
      assessmentId: result.assessmentId, version: result.version,
      tier: d.tier, urgencyCode: d.urgencyCode, potentialTier: d.potentialTier,
      winning: d.winning, log: d.log, vulnerable: d.vulnerable, insufficientData: d.insufficientData,
      news2: { applicable: d.news2.applicable, score: d.news2.score },
      queue: { urgency: result.queueUrgency, downgradeSuggested: result.downgradeSuggested },
      followUps, followUpsSaved,
      ruleSet: d.ruleSet,
      aiOpinion: { ...ai, ask: undefined, ...compareWithRules(ai, d.log), machineGenerated: true },
      questionsFrom: relevance?.source ?? 'all',
    });
  });

  return { invalid, dbFail, note, writerFor, openEncounter };
}
