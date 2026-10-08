// Read views for the frontend: patient search, the queue board, and an encounter summary.
// These go through the API (not straight from the browser to the database) so every read of patient data is audited.
// RLS still decides what each caller can see; a facility admin or an unaffiliated user simply gets empty results.
import { z } from 'zod';
import type { RouteCtx } from './intake.js';
import { isWaitingLong, sortQueue } from '../queue/sort.js';

const patientQuery = z.object({
  // Letters (any script), marks, digits, space, dot, hyphen. No commas, brackets or wildcards: the value is used in a filter.
  q: z.string().trim().regex(/^[\p{L}\p{M}\p{N} .-]{1,60}$/u, 'Use letters, numbers, spaces, dots or hyphens (up to 60).').optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

export function registerViewRoutes(c: RouteCtx): void {
  const { app, deps, authenticate, fail } = c;

  // Identity of the caller: name, facilities and roles. No patient data, so no read audit.
  app.get('/me', { preHandler: authenticate }, async (req, reply) => {
    let me: Awaited<ReturnType<NonNullable<typeof req.reader>['getMe']>> | undefined;
    try { me = await req.reader!.getMe(); } catch (err) { req.log.warn({ reqId: req.id, err: (err as Error).message }, 'profile could not be loaded'); }
    if (me === undefined) return fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.');
    return reply.send({ userId: req.user!.userId, aal: req.user!.aal ?? 'aal1', mfaRequired: c.mfaRequired, ...me });
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
    return reply.send({ generatedAt: now.toISOString(), entries: sortQueue(rows, 3, now).map(e => ({ ...e, waitingLong: isWaitingLong(e, now) })) });
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
