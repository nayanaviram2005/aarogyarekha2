import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { shapeLabTrends } from '../ocr/labTrends.js';

const uuid = z.string().uuid();

export function registerLabTrendRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  app.get('/patients/:id/lab-trends', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.labHistory) return fail(reply, 503, 'not-supported', 'Results over time are not set up.');
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Patient id must be a UUID.');
    const p = await req.reader!.getPatient(id.data).catch(() => undefined);
    if (p === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!p) return fail(reply, 404, 'not-found', 'No such patient, or you do not have access.');
    const ok = await h.writerFor(req).hasActiveConsent(p.id, 'care_triage').catch(() => undefined);
    if (ok === undefined) return fail(reply, 502, 'transient', 'Consent could not be checked. Try again.');
    if (!ok) return fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record consent first.');
    const points = await deps.labHistory(req.headers.authorization!.slice(7).trim()).forPatient(p.id, 500).catch(() => undefined);
    if (points === undefined) return fail(reply, 502, 'transient', 'Earlier results could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'lab_trends', patientId: p.id, facilityId: p.registered_facility_id, outcome: 'success', details: { rows: points.length } }))) return;
    return reply.send(shapeLabTrends(points));
  });
}
