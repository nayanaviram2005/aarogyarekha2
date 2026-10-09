import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { VisitError } from '../deps.js';

const uuid = z.string().uuid();
const completeBody = z.object({ outcome: z.enum(['treated_here', 'sent_home', 'did_not_wait']) }).strict();
const hoursQuery = z.object({ hours: z.coerce.number().int().min(1).max(72).default(24) });
const CLINICAL = new Set(['health_worker', 'nurse', 'doctor', 'medical_officer']);

export function registerVisitRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  async function openForVisit(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) { fail(reply, 400, 'invalid', 'Encounter id must be a UUID.'); return null; }
    const enc = await req.reader!.getEncounter(id.data).catch(() => undefined);
    if (enc === undefined) { fail(reply, 502, 'transient', 'The record could not be loaded. Try again.'); return null; }
    if (!enc) { fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.'); return null; }
    return enc.id;
  }
  const refuse = (reply: FastifyReply, err: unknown) => {
    if (!(err instanceof VisitError)) return null;
    switch (err.kind) {
      case 'forbidden': return fail(reply, 403, 'forbidden', 'You are not allowed to do that for this patient.');
      case 'not_found': return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
      case 'review_first': return fail(reply, 409, 'conflict', 'A nurse or doctor must review the priority before the visit is completed.');
      case 'taken': return fail(reply, 409, 'conflict', 'This patient is already being seen by someone else.');
      case 'not_set_up': return fail(reply, 503, 'not-supported', 'Visit flow is not set up. It needs migration 0018.');
      case 'invalid': return fail(reply, 400, 'invalid', 'That outcome is not allowed here.');
      default: return fail(reply, 409, 'conflict', 'This patient is no longer in the queue, or has not been assessed yet.');
    }
  };

  app.post('/encounters/:id/call-in', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.visitFlow) return fail(reply, 503, 'not-supported', 'Visit flow is not set up. It needs migration 0018.');
    const id = await openForVisit(req, reply); if (!id) return;
    try { const r = await deps.visitFlow.callIn({ actor: req.user!.userId, encounterId: id }); return reply.send({ encounterId: id, status: r.status }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });

  app.post('/encounters/:id/complete', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.visitFlow) return fail(reply, 503, 'not-supported', 'Visit flow is not set up. It needs migration 0018.');
    const b = completeBody.safeParse(req.body); if (!b.success) return h.invalid(reply, b.error);
    const id = await openForVisit(req, reply); if (!id) return;
    if (b.data.outcome !== 'did_not_wait' && !(await c.requireMfa(req, reply, 'complete_visit'))) return;
    try { const r = await deps.visitFlow.complete({ actor: req.user!.userId, encounterId: id, outcome: b.data.outcome }); return reply.send({ encounterId: id, outcome: r.outcome, queueStatus: r.queueStatus }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });

  app.get('/queue/done', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.visitFlow) return fail(reply, 503, 'not-supported', 'Visit flow is not set up. It needs migration 0018.');
    const q = hoursQuery.safeParse(req.query ?? {}); if (!q.success) return h.invalid(reply, q.error);
    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) return fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.');
    const facilityIds = [...new Set(me.memberships.filter(m => CLINICAL.has(m.role)).map(m => m.facilityId))];
    if (facilityIds.length === 0) return fail(reply, 403, 'forbidden', 'Clinical access is needed for this list.');
    let rows: Awaited<ReturnType<typeof deps.visitFlow.done>> | undefined;
    try { rows = await deps.visitFlow.done(facilityIds, q.data.hours); }
    catch (err) { const r = refuse(reply, err); if (r) return r; rows = undefined; }
    if (rows === undefined) return fail(reply, 502, 'transient', 'The list could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'queue_done', outcome: 'success', details: { count: rows.length, hours: q.data.hours } }))) return;
    return reply.send({ hours: q.data.hours, done: rows });
  });
}
