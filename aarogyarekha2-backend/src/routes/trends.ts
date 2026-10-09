import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';

const uuid = z.string().uuid();
const ALLOWED = ['bp_systolic_mmhg', 'bp_diastolic_mmhg', 'blood_glucose_mgdl', 'weight_kg', 'pulse_bpm', 'spo2_pct', 'temperature_c'] as const;
const query = z.object({ kinds: z.string().default('bp_systolic_mmhg,bp_diastolic_mmhg,blood_glucose_mgdl'), limit: z.coerce.number().int().min(1).max(200).default(60) }).strict();

export function registerTrendRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  app.get('/patients/:id/trends', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.vitalHistory) return fail(reply, 503, 'not-supported', 'Trends are not set up.');
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Patient id must be a UUID.');
    const q = query.safeParse(req.query); if (!q.success) return fail(reply, 400, 'invalid', 'Unknown filter.');
    const kinds = q.data.kinds.split(',').map(s => s.trim());
    if (kinds.length === 0 || !kinds.every(k => (ALLOWED as readonly string[]).includes(k))) return fail(reply, 400, 'invalid', 'Kinds must be from: ' + ALLOWED.join(', ') + '.');
    const p = await req.reader!.getPatient(id.data).catch(() => undefined);
    if (p === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!p) return fail(reply, 404, 'not-found', 'No such patient, or you do not have access.');
    const ok = await h.writerFor(req).hasActiveConsent(p.id, 'care_triage').catch(() => undefined);
    if (ok === undefined) return fail(reply, 502, 'transient', 'Consent could not be checked. Try again.');
    if (!ok) return fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record consent first.');
    const rows = await deps.vitalHistory(req.headers.authorization!.slice(7).trim()).forPatient(p.id, kinds, q.data.limit).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'Readings could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'vital_trends', patientId: p.id, facilityId: p.registered_facility_id, outcome: 'success', details: { count: rows.length } }))) return;
    return reply.send({ points: rows.map(r => ({ kind: r.kind, value: r.value, unit: r.unit, at: r.measured_at, encounterId: r.encounter_id })) });
  });
}
