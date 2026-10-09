import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import type { NotesStore } from '../deps.js';
import { DbError } from '../deps.js';

const body = z.object({
  kind: z.enum(['comment', 'escalation', 'feedback_up', 'feedback_down']),
  body: z.string().trim().max(1000).optional(),
  assessmentId: z.string().uuid().optional(),
}).strict().superRefine((b, ctx) => {
  if ((b.kind === 'comment' || b.kind === 'escalation') && !b.body) ctx.addIssue({ code: 'custom', message: b.kind === 'escalation' ? 'Say why this needs a senior look.' : 'Write the note.', path: ['body'] });
  if ((b.kind === 'feedback_up' || b.kind === 'feedback_down') && !b.assessmentId) ctx.addIssue({ code: 'custom', message: 'Feedback is about a specific assessment.', path: ['assessmentId'] });
});

export function registerNoteRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;
  const storeFor = (req: Parameters<typeof authenticate>[0]): NotesStore | null => (deps.notes ? deps.notes(req.headers.authorization!.slice(7).trim(), req.user!.userId) : null);

  app.get('/encounters/:id/notes', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return fail(reply, 503, 'not-supported', 'Reviewer notes are not set up.');
    const ctx = await h.openEncounter(req, reply, false); if (!ctx) return;
    const rows = await store.list(ctx.enc.id).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'Notes could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'reviewer_notes', entityId: ctx.enc.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success', details: { count: rows.length } }))) return;
    const names = await req.reader!.getNames(rows.map(r => r.author_id)).catch(() => ({} as Record<string, string | null>));
    return reply.send({ notes: rows.map(r => ({ id: r.id, kind: r.kind, body: r.body, assessmentId: r.assessment_id, author: names[r.author_id] ?? null, at: r.created_at })) });
  });

  app.post('/encounters/:id/notes', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return fail(reply, 503, 'not-supported', 'Reviewer notes are not set up.');
    const parsed = body.safeParse(req.body); if (!parsed.success) return h.invalid(reply, parsed.error);
    const ctx = await h.openEncounter(req, reply, false); if (!ctx) return;
    try {
      const r = await store.add({ encounterId: ctx.enc.id, assessmentId: parsed.data.assessmentId, kind: parsed.data.kind, body: parsed.data.body });
      await h.note(req, { action: 'create', entityType: 'reviewer_notes', entityId: r.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success', details: { kind: parsed.data.kind } });
      return reply.code(201).send({ id: r.id });
    } catch (err) {
      if (err instanceof DbError && err.code === '42501') return fail(reply, 403, 'forbidden', 'Only a nurse, doctor or medical officer at this facility can add notes or feedback.');
      return h.dbFail(req, reply, err);
    }
  });
}
