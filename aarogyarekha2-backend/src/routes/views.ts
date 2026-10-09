import { z } from 'zod';
import type { RouteCtx } from './intake.js';
import { explainOrder, isWaitingLong, sortQueue } from '../queue/sort.js';

const patientQuery = z.object({
  q: z.string().trim().regex(/^[\p{L}\p{M}\p{N} .-]{1,60}$/u, 'Use letters, numbers, spaces, dots or hyphens (up to 60).').optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export function registerViewRoutes(c: RouteCtx): void {
  const { app, deps, authenticate, fail } = c;

  app.get('/me', { preHandler: authenticate }, async (req, reply) => {
    let me: Awaited<ReturnType<NonNullable<typeof req.reader>['getMe']>> | undefined;
    try { me = await req.reader!.getMe(); } catch (err) { req.log.warn({ reqId: req.id, err: (err as Error).message }, 'profile could not be loaded'); }
    if (me === undefined) return fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.');
    const isPlatformAdmin = deps.platformAdmin ? await deps.platformAdmin.isPlatform(req.user!.userId).catch(() => false) : false;
    return reply.send({ userId: req.user!.userId, aal: req.user!.aal ?? 'aal1', mfaRequired: c.mfaRequired, isPlatformAdmin, ...me });
  });

  app.get('/patients', { preHandler: authenticate }, async (req, reply) => {
    const q = patientQuery.safeParse(req.query);
    if (!q.success) return fail(reply, 400, 'invalid', 'Check these fields: ' + q.error.issues.map(i => `${i.path.join('.') || 'query'} (${i.message})`).join('; '));
    const rows = await req.reader!.listPatients(q.data.q, q.data.limit).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The list could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'patient_list', outcome: 'success', details: { count: rows.length, searched: q.data.q !== undefined } }))) return;
    return reply.send({ patients: rows });
  });

  app.get('/queue', { preHandler: authenticate }, async (req, reply) => {
    const rows = await req.reader!.getQueue().catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The queue could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'queue', outcome: 'success', details: { count: rows.length } }))) return;
    const now = new Date();
    const sorted = sortQueue(rows, 3, now); const order = explainOrder(sorted, 3, now);
    return reply.send({ generatedAt: now.toISOString(), entries: sorted.map((e, i) => ({ ...e, waitingLong: isWaitingLong(e, now), order: order[i] })) });
  });

  app.get('/encounters/:id/summary', { preHandler: authenticate }, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Encounter id must be a UUID.');
    const s = await req.reader!.getEncounterSummary(id.data).catch(() => undefined);
    if (s === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!s) {
      if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'encounter_summary', entityId: id.data, outcome: 'denied' }))) return;
      return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
    }
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'encounter_summary', entityId: s.encounter.id, patientId: s.encounter.patient_id, facilityId: s.encounter.facility_id, outcome: 'success' }))) return;
    const token = req.headers.authorization!.slice(7).trim();
    const consentActive = await deps.userWriter(token, req.user!.userId).hasActiveConsent(s.encounter.patient_id, 'care_triage').catch(() => null);
    return reply.send({ ...s, consentActive });
  });
}
