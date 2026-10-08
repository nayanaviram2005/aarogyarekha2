import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import sjson from 'secure-json-parse';
import type { Config } from './config.js';
import type { Deps, AuditEvent, UserReader } from './deps.js';
import { APP_NAME } from './appInfo.js';
import { registerIntakeRoutes } from './routes/intake.js';
import { registerViewRoutes } from './routes/views.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerReferralRoutes } from './routes/referral.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerExtractionRoutes } from './routes/extraction.js';
import { registerTranslateRoutes } from './routes/translate.js';
import { registerVoiceRoutes } from './routes/voice.js';
import { registerFollowupRoutes } from './routes/followups.js';
import { registerPatientRoutes } from './routes/patients.js';
import { registerRecordRoutes } from './routes/records.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerReferralBoardRoutes } from './routes/referralBoard.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerTrendRoutes } from './routes/trends.js';
import { registerNoteRoutes } from './routes/notes.js';
import { registerMemberRoutes } from './routes/members.js';
import { registerVisitRoutes } from './routes/visits.js';
import { registerSmsRoutes } from './routes/sms.js';
import { makeAccessBudget } from './guard/accessBudget.js';
import { JobQueue } from './jobs/queue.js';
import multipart from '@fastify/multipart';
import { RULESET_DRAFT } from './triage/ruleset.draft.js';
import { operationOutcome, toFhirEncounter, toFhirPatient, toFhirVitals } from './fhir/project.js';

declare module 'fastify' {
  interface FastifyRequest { user?: { userId: string; aal?: 'aal1' | 'aal2' }; reader?: UserReader }
}

const FHIR = 'application/fhir+json; charset=utf-8';
const uuid = z.string().uuid();

export async function buildApp(config: Pick<Config, 'allowedOrigins'> & { triageRuleSet?: { name: string; version: string }; uploadMaxMb?: number; requireMfa?: boolean; rateLimitPerMinute?: number; accessBudgetPerHour?: number }, deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),            // never trust a client-supplied request id
    // Deprecated in Fastify 5.x but still supported until v6; the replacement (logController) is not in the
    // installed typings yet. Revisit on upgrade.
    disableRequestLogging: true,             // we log our own PHI-free line below
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Defence in depth: even if a header or body sneaks into a log call, it is censored.
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', '*.password', '*.token'], censor: '[redacted]' },
    },
  });

  // Awaited on purpose: @fastify/rate-limit protects only routes registered AFTER it has loaded.
  // The API returns data, never pages: nothing may load, run or frame from its answers.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' }, crossOriginResourcePolicy: { policy: 'same-site' },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
  });
  await app.register(cors, { origin: config.allowedOrigins, methods: ['GET', 'POST', 'PUT'], allowedHeaders: ['authorization', 'content-type'] });
  const maxUploadBytes = (config.uploadMaxMb ?? 10) * 1024 * 1024;
  await app.register(multipart, { limits: { fileSize: maxUploadBytes, files: 1, fields: 6, parts: 8, headerPairs: 50 } });
  await app.register(rateLimit, { max: config.rateLimitPerMinute ?? 600, timeWindow: '1 minute' });         // one screen makes about a dozen calls; costly or sensitive routes set their own, lower limits

  // A POST/PUT may legitimately carry a JSON content-type with NO body (submit, assess). The default parser turns that into
  // a 500. Parse ourselves: empty body = no body; poisoned or malformed JSON = 400.
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256 * 1024 }, (_req, body, done) => {
    const text = String(body).trim();
    if (!text) return done(null, undefined);
    try { done(null, sjson.parse(text, undefined, { protoAction: 'error', constructorAction: 'error' })); }
    catch { const e = Object.assign(new Error('Request body is not valid JSON.'), { statusCode: 400 }); done(e, undefined); }
  });

  // PHI must never be cached by browsers or intermediaries.
  app.addHook('onSend', async (_req, reply) => { reply.header('cache-control', 'no-store'); });

  // PHI-free access log: method, path WITHOUT query string, status, duration, request id. No body, no headers.
  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ method: req.method, path: req.url.split('?')[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime), reqId: req.id }, 'request');
  });

  const fail = (reply: FastifyReply, status: number, code: Parameters<typeof operationOutcome>[1], text: string) =>
    reply.code(status).type(FHIR).send(operationOutcome('error', code, text));

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) return fail(reply, 401, 'login', 'Sign in required.');
    let who: Awaited<ReturnType<typeof deps.verifyToken>>;
    try { who = await deps.verifyToken(token); }
    catch (err) {
      // The sign-in service could not be reached or is rate-limiting us. That is not a bad session: say so, and do not record a failed login.
      req.log.warn({ reqId: req.id, err: (err as Error).message }, 'token check unavailable');
      return fail(reply, 503, 'transient', 'The sign-in service is busy. Wait a moment and try again. You are still signed in.');
    }
    if (!who) {
      await deps.audit({ action: 'login_failed', entityType: 'session', outcome: 'denied', requestId: req.id, ip: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
      return fail(reply, 401, 'login', 'Session expired or invalid. Sign in again.');
    }
    req.user = who;
    req.reader = deps.userReader(token, who.userId);
  };

  const base = (req: FastifyRequest): Pick<AuditEvent, 'actor' | 'requestId' | 'ip' | 'userAgent'> =>
    ({ actor: req.user!.userId, requestId: req.id, ip: req.ip, userAgent: req.headers['user-agent'] });

  /** Audit, and refuse to release data if the audit record could not be written (fail closed). */
  const budget = makeAccessBudget(config.accessBudgetPerHour ?? 80);
  const auditOrFail = async (req: FastifyRequest, reply: FastifyReply, ev: Omit<AuditEvent, 'actor' | 'requestId' | 'ip' | 'userAgent'>) => {
    // Access budget: opening many different patients' records in an hour is stopped and reported, even for a valid login.
    if (ev.action === 'read' && ev.outcome === 'success' && ev.patientId && req.user) {
      const b = budget.record(req.user.userId, ev.patientId);
      if (b.exceeded) {
        if (b.firstTime) await deps.audit({ ...base(req), action: 'read', entityType: 'access_budget', patientId: undefined, facilityId: ev.facilityId, outcome: 'denied', details: { distinctPatients: b.count, limitPerHour: config.accessBudgetPerHour ?? 80 } }).catch(() => {});
        fail(reply, 429, 'throttled', 'You have opened more patient records this hour than usual, so access is paused to protect them. It resumes within the hour. If this is part of your work, ask your facility administrator.');
        return false;
      }
    }
    try { await deps.audit({ ...base(req), ...ev }); return true; }
    catch (err) {
      req.log.error({ reqId: req.id, err: (err as Error).message }, 'audit write failed; withholding response');
      fail(reply, 503, 'transient', 'Access could not be recorded, so the record was not released. Try again.');
      return false;
    }
  };

  /**
   * Decisions that change a patient's priority or send a record to another facility need a second factor (aal2) when the
   * deployment requires it. Refused calls are logged. Returns true when the caller may go on.
   */
  const requireMfa = async (req: FastifyRequest, reply: FastifyReply, what: string): Promise<boolean> => {
    if (!config.requireMfa || req.user?.aal === 'aal2') return true;
    await deps.audit({ ...base(req), action: 'update', entityType: 'mfa_gate', outcome: 'denied', details: { action: what } }).catch(() => {});
    fail(reply, 403, 'forbidden', 'Two-factor sign-in is required for this action. Verify with your authenticator app, then try again.');
    return false;
  };

  const routeCtx = { app, deps, authenticate, fail, base, auditOrFail, requireMfa, mfaRequired: config.requireMfa === true, jobs: new JobQueue(), triageRuleSet: config.triageRuleSet ?? { name: RULESET_DRAFT.name, version: RULESET_DRAFT.version } };
  const helpers = registerIntakeRoutes(routeCtx);
  registerViewRoutes(routeCtx);
  registerReviewRoutes(routeCtx, helpers);
  registerReferralBoardRoutes(routeCtx, helpers);   // before the :id routes so /referrals/incoming is not read as an id
  registerReferralRoutes(routeCtx, helpers);
  registerDocumentRoutes(routeCtx, helpers, maxUploadBytes);
  registerExtractionRoutes(routeCtx, helpers);
  registerTranslateRoutes(routeCtx, helpers);
  registerVoiceRoutes(routeCtx, helpers);
  registerFollowupRoutes(routeCtx, helpers);
  registerPatientRoutes(routeCtx, helpers);
  registerRecordRoutes(routeCtx, helpers);
  registerAdminRoutes(routeCtx, helpers);
  registerHistoryRoutes(routeCtx, helpers);
  registerTrendRoutes(routeCtx, helpers);
  registerNoteRoutes(routeCtx, helpers);
  registerMemberRoutes(routeCtx, helpers);
  registerVisitRoutes(routeCtx, helpers);
  registerSmsRoutes(routeCtx);

  app.get('/health', async () => ({ status: 'ok', app: APP_NAME }));

  app.get('/fhir/Patient/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Patient id must be a UUID.');
    const row = await req.reader!.getPatient(id.data).catch(() => undefined);
    if (row === undefined) {
      await deps.audit({ ...base(req), action: 'read', entityType: 'patient', entityId: id.data, outcome: 'error' }).catch(() => {});
      return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    }
    if (!row) {   // missing OR hidden by RLS: indistinguishable on purpose
      if (!(await auditOrFail(req, reply, { action: 'read', entityType: 'patient', entityId: id.data, outcome: 'denied' }))) return;
      return fail(reply, 404, 'not-found', 'No such patient, or you do not have access.');
    }
    const identifiers = await req.reader!.getIdentifiers(row.id).catch(() => []);
    if (!(await auditOrFail(req, reply, { action: 'read', entityType: 'patient', entityId: row.id, patientId: row.id, facilityId: row.registered_facility_id, outcome: 'success' }))) return;
    return reply.type(FHIR).send(toFhirPatient(row, identifiers));
  });

  app.get('/fhir/Encounter/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Encounter id must be a UUID.');
    const row = await req.reader!.getEncounter(id.data).catch(() => undefined);
    if (row === undefined) {
      await deps.audit({ ...base(req), action: 'read', entityType: 'encounter', entityId: id.data, outcome: 'error' }).catch(() => {});
      return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    }
    if (!row) {
      if (!(await auditOrFail(req, reply, { action: 'read', entityType: 'encounter', entityId: id.data, outcome: 'denied' }))) return;
      return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
    }
    if (!(await auditOrFail(req, reply, { action: 'read', entityType: 'encounter', entityId: row.id, patientId: row.patient_id, facilityId: row.facility_id, outcome: 'success' }))) return;
    return reply.type(FHIR).send(toFhirEncounter(row));
  });

  app.get('/fhir/Observation', { preHandler: authenticate }, async (req, reply) => {
    const q = z.object({ encounter: z.string().uuid() }).safeParse(req.query);
    if (!q.success) return fail(reply, 400, 'invalid', 'Search requires ?encounter=<uuid>.');
    const enc = await req.reader!.getEncounter(q.data.encounter).catch(() => undefined);
    if (enc === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!enc) {
      if (!(await auditOrFail(req, reply, { action: 'read', entityType: 'observation', entityId: q.data.encounter, outcome: 'denied' }))) return;
      return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
    }
    const vitals = await req.reader!.getVitals(enc.id).catch(() => undefined);
    if (vitals === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!(await auditOrFail(req, reply, { action: 'read', entityType: 'observation', entityId: enc.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { count: vitals.length } }))) return;
    const entries = toFhirVitals(enc.patient_id, vitals).map(resource => ({ resource }));
    return reply.type(FHIR).send({ resourceType: 'Bundle', type: 'searchset', total: entries.length, entry: entries });
  });

  app.setNotFoundHandler((_req, reply) => fail(reply, 404, 'not-found', 'Unknown route.'));
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ reqId: req.id, err: (err as Error).message }, 'unhandled error');   // message only; never request data
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return fail(reply, 429, 'throttled', 'Too many requests. Wait a minute and try again.');
    if (status === 413) return fail(reply, 413, 'too-costly', 'The request is too large.');
    if (status === 415) return fail(reply, 415, 'not-supported', 'Send the request as application/json.');
    if (status && status >= 400 && status < 500) return fail(reply, status === 400 ? 400 : 400, 'invalid', 'The request could not be read. Check that it is valid JSON.');
    return fail(reply, 500, 'exception', 'Something went wrong. The incident was logged.');
  });

  return app;
}
