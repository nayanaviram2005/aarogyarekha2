// Facility administrator screens and emergency ("break-glass") access.
//  * administrators see activity AT THEIR OWN facilities only, and never patient names (record numbers and counts only),
//  * emergency access needs a typed reason of at least 10 characters, a verified second factor, lasts one hour, and every grant
//    (and every refused attempt) is audited and appears in the administrator's review list,
//  * administrators can mark an emergency access as reviewed. They cannot edit or delete it.
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { BreakGlassError } from '../deps.js';
import { flagSuspicious, RULES } from '../admin/suspicious.js';

const uuid = z.string().uuid();
const grantBody = z.object({
  publicRef: z.string().trim().regex(/^[A-Za-z0-9-]{4,24}$/, 'Enter the patient record number, for example AR-0001.'),
  reason: z.string().trim().min(10, 'Give the reason in at least 10 characters.').max(500),
  facilityId: uuid.optional(),
}).strict();
const CLINICAL = new Set(['health_worker', 'nurse', 'doctor', 'medical_officer']);

export function registerAdminRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;
  const storeFor = (req: FastifyRequest) => (deps.adminStore ? deps.adminStore(req.headers.authorization!.slice(7).trim(), req.user!.userId) : null);

  /** The facilities this caller administers, or null after sending the refusal. */
  async function adminFacilities(req: FastifyRequest, reply: FastifyReply): Promise<string[] | null> {
    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) { fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.'); return null; }
    const ids = [...new Set(me.memberships.filter(m => m.role === 'facility_admin').map(m => m.facilityId))];
    if (ids.length === 0) { fail(reply, 403, 'forbidden', 'Administrator access is needed for this screen.'); return null; }
    return ids;
  }
  const notSetUp = (reply: FastifyReply) => fail(reply, 503, 'not-supported', 'This screen is not set up.');

  app.get('/admin/audit/flags', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return notSetUp(reply);
    const q = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }).safeParse(req.query);
    if (!q.success) return fail(reply, 400, 'invalid', 'Hours must be a whole number from 1 to 168.');
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const since = new Date(Date.now() - q.data.hours * 3_600_000).toISOString();
    const rows = await store.recentAudit(since, 5000).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'Activity could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'admin_audit_flags', outcome: 'success', details: { hours: q.data.hours } }))) return;
    const flags = flagSuspicious(rows.filter(r => r.facility_id && fac.includes(r.facility_id)));
    const names = await req.reader!.getNames(flags.map(f => f.who.actorId).filter((x): x is string => !!x)).catch(() => ({} as Record<string, string | null>));
    return reply.send({ hours: q.data.hours, examined: rows.length, rulesValidated: RULES.validated, flags: flags.map(f => ({ ...f, who: { ...f.who, name: f.who.actorId ? names[f.who.actorId] ?? null : null } })) });
  });

  app.get('/admin/analytics', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.systemAdmin) return notSetUp(reply);
    const q = z.object({ days: z.coerce.number().int().refine(n => [7, 30, 90].includes(n), 'Days must be 7, 30 or 90.').default(30) }).safeParse(req.query);
    if (!q.success) return fail(reply, 400, 'invalid', 'Days must be 7, 30 or 90.');
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const a = await deps.systemAdmin.analytics(fac, q.data.days).catch(() => undefined);
    if (a === undefined) return fail(reply, 502, 'transient', 'The figures could not be worked out. Try again.');
    await h.note(req, { action: 'read', entityType: 'admin_analytics', outcome: 'success', details: { days: q.data.days } });
    return reply.send({ ...a, note: 'Counts and times only. Agreement means how often a reviewer confirmed the rules priority instead of changing it. It is not a measure of clinical accuracy.' });
  });

  app.get('/admin/audit/chain', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.systemAdmin) return notSetUp(reply);
    if (!(await adminFacilities(req, reply))) return;
    const r = await deps.systemAdmin.verifyChain().catch(() => undefined);
    if (r === undefined) return fail(reply, 502, 'transient', 'The audit log could not be checked. Try again.');
    await h.note(req, { action: 'read', entityType: 'audit_chain_check', outcome: 'success', details: { checked: r.checked, broken: r.brokenIds.length } });
    return reply.send({ intact: r.brokenIds.length === 0, checked: r.checked, brokenIds: r.brokenIds.slice(0, 20), checkedAt: new Date().toISOString() });
  });

  app.get('/admin/break-glass', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.systemAdmin) return notSetUp(reply);
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const rows = await deps.systemAdmin.listBreakGlass(fac, 100).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'Emergency access records could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'admin_break_glass', outcome: 'success' }))) return;
    const names = await req.reader!.getNames(rows.map(r => r.user_id)).catch(() => ({} as Record<string, string | null>));
    return reply.send({ grants: rows.map(r => ({ id: r.id, who: names[r.user_id] ?? null, userId: r.user_id, patientRef: r.patient_ref, facilityId: r.facility_id, reason: r.reason, createdAt: r.created_at, expiresAt: r.expires_at, reviewedAt: r.reviewed_at, reviewed: !!r.reviewed_at })) });
  });

  app.post('/admin/break-glass/:id/review', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return notSetUp(reply);
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Id must be a UUID.');
    if (!(await adminFacilities(req, reply))) return;
    const ok = await store.reviewBreakGlass(id.data, req.user!.userId).catch(() => undefined);
    if (ok === undefined) return fail(reply, 502, 'transient', 'The review could not be recorded. Try again.');
    if (!ok) return fail(reply, 404, 'not-found', 'No such emergency access, or you do not have access.');
    await h.note(req, { action: 'update', entityType: 'break_glass_review', entityId: id.data, outcome: 'success' });
    return reply.send({ id: id.data, reviewed: true });
  });

  // ------------------------------------------------------------------ emergency access (any clinician)
  app.post('/break-glass', { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!deps.systemAdmin) return notSetUp(reply);
    const body = grantBody.safeParse(req.body); if (!body.success) return h.invalid(reply, body.error);
    if (!(await c.requireMfa(req, reply, 'break_glass'))) return;
    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) return fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.');
    const mine = [...new Set(me.memberships.filter(m => CLINICAL.has(m.role)).map(m => m.facilityId))];
    const facilityId = body.data.facilityId ?? (mine.length === 1 ? mine[0] : undefined);
    if (!facilityId) return fail(reply, 400, 'invalid', mine.length === 0 ? 'Only clinical staff can use emergency access.' : 'Choose which facility you are acting for.');
    if (!mine.includes(facilityId)) return fail(reply, 403, 'forbidden', 'Only clinical staff at that facility can use emergency access.');
    try {
      const g = await deps.systemAdmin.grantBreakGlass({ userId: req.user!.userId, facilityId, publicRef: body.data.publicRef, reason: body.data.reason });
      await h.note(req, { action: 'break_glass', entityType: 'break_glass_grant', entityId: g.id, patientId: g.patientId, facilityId, outcome: 'success', details: { expiresAt: g.expiresAt } });
      return reply.code(201).send({ id: g.id, patientId: g.patientId, patientRef: g.publicRef, expiresAt: g.expiresAt });
    } catch (err) {
      if (err instanceof BreakGlassError) {
        await h.note(req, { action: 'break_glass', entityType: 'break_glass_grant', facilityId, outcome: 'denied', details: { kind: err.kind } });
        return err.kind === 'not_found' ? fail(reply, 404, 'not-found', 'No patient has that record number.') : fail(reply, 403, 'forbidden', err.message);
      }
      req.log.error({ reqId: req.id, err: (err as Error).message }, 'break glass failed');
      return fail(reply, 502, 'transient', 'Emergency access could not be granted. Try again.');
    }
  });

  app.get('/patients/:id/encounters', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return notSetUp(reply);
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Patient id must be a UUID.');
    const p = await req.reader!.getPatient(id.data).catch(() => undefined);
    if (p === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!p) return fail(reply, 404, 'not-found', 'No such patient, or you do not have access.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'patient_encounters', entityId: p.id, patientId: p.id, facilityId: p.registered_facility_id, outcome: 'success' }))) return;
    const rows = await store.patientEncounters(p.id).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'Encounters could not be loaded. Try again.');
    return reply.send({ patientRef: p.public_ref, encounters: rows });
  });
}
