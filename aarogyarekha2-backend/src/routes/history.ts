// Reported medical history: conditions, allergies, medicines, family history, exposures, immunisations.
// Recorded exactly as told. The system never comments on a medicine, a dose or an interaction.
//  * reading and adding need the patient's triage consent and access to the patient (row-level security),
//  * a reviewer (nurse, doctor, medical officer) can mark an entry "confirmed by staff". Unconfirmed entries are shown as such.
import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import type { HistoryStore } from '../deps.js';

const uuid = z.string().uuid();
export const KINDS = ['reported_condition', 'allergy', 'medication', 'family_history', 'occupational_exposure', 'immunisation', 'other'] as const;
const addBody = z.object({ kind: z.enum(KINDS), text: z.string().trim().min(1).max(500), lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/).optional() }).strict();

export function registerHistoryRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;
  const storeFor = (req: Parameters<typeof authenticate>[0]): HistoryStore | null => (deps.history ? deps.history(req.headers.authorization!.slice(7).trim(), req.user!.userId) : null);

  async function patientFor(req: Parameters<typeof authenticate>[0], reply: Parameters<typeof fail>[0]) {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) { fail(reply, 400, 'invalid', 'Patient id must be a UUID.'); return null; }
    const p = await req.reader!.getPatient(id.data).catch(() => undefined);
    if (p === undefined) { fail(reply, 502, 'transient', 'The record could not be loaded. Try again.'); return null; }
    if (!p) { fail(reply, 404, 'not-found', 'No such patient, or you do not have access.'); return null; }
    const ok = await h.writerFor(req).hasActiveConsent(p.id, 'care_triage').catch(() => undefined);
    if (ok === undefined) { fail(reply, 502, 'transient', 'Consent could not be checked. Try again.'); return null; }
    if (!ok) { fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record consent first.'); return null; }
    return p;
  }

  app.get('/patients/:id/history', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return fail(reply, 503, 'not-supported', 'Medical history is not set up.');
    const p = await patientFor(req, reply); if (!p) return;
    const rows = await store.list(p.id).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'History could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'reported_history', patientId: p.id, facilityId: p.registered_facility_id, outcome: 'success', details: { count: rows.length } }))) return;
    const names = await req.reader!.getNames(rows.map(r => r.confirmed_by).filter((x): x is string => !!x)).catch(() => ({} as Record<string, string | null>));
    return reply.send({ history: rows.map(r => ({ id: r.id, kind: r.kind, text: r.text_original, lang: r.lang, source: r.source, createdAt: r.created_at, confirmed: !!r.confirmed_at, confirmedAt: r.confirmed_at, confirmedBy: r.confirmed_by ? names[r.confirmed_by] ?? null : null })) });
  });

  app.post('/patients/:id/history', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return fail(reply, 503, 'not-supported', 'Medical history is not set up.');
    const body = addBody.safeParse(req.body); if (!body.success) return h.invalid(reply, body.error);
    const p = await patientFor(req, reply); if (!p) return;
    try {
      const r = await store.add({ patientId: p.id, kind: body.data.kind, text: body.data.text, lang: body.data.lang });
      await h.note(req, { action: 'create', entityType: 'reported_history', entityId: r.id, patientId: p.id, facilityId: p.registered_facility_id, outcome: 'success', details: { kind: body.data.kind } });
      return reply.code(201).send({ id: r.id });
    } catch (err) { return h.dbFail(req, reply, err); }
  });

  app.post('/history/:id/confirm', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return fail(reply, 503, 'not-supported', 'Medical history is not set up.');
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Id must be a UUID.');
    try {
      const ok = await store.confirm(id.data);
      if (!ok) return fail(reply, 404, 'not-found', 'No such entry, it is already confirmed, or you cannot confirm it. Only a nurse, doctor or medical officer at the patient\'s facility can.');
      await h.note(req, { action: 'update', entityType: 'reported_history', entityId: id.data, outcome: 'success', details: { confirmed: true } });
      return reply.send({ id: id.data, confirmed: true });
    } catch (err) { return h.dbFail(req, reply, err); }
  });
}
