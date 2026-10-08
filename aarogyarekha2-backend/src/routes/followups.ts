// Follow-up schedules and their reminders (maternal visits, chronic check-ins, fever follow-up, vaccination).
//  * planning a follow-up needs the encounter's triage consent and a clinician at the facility (row-level security),
//  * a reminder to the PATIENT additionally needs their separate 'reminders' consent, checked here and again when sent,
//  * nothing is sent from this file: reminders are stored as 'scheduled' and a worker sends them (src/reminders/core.ts).
import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import type { FollowupStore } from '../deps.js';
import { isConsentActive } from '../intake/consent.js';

const uuid = z.string().uuid();
const KINDS = ['anc_visit', 'chronic_checkin', 'fever_followup', 'vaccination', 'custom'] as const;
const createBody = z.object({
  kind: z.enum(KINDS),
  firstDueInDays: z.number().int().min(0).max(365),
  cadenceDays: z.number().int().min(1).max(365).optional(),
}).strict();
const remindBody = z.object({
  channel: z.enum(['sms', 'whatsapp', 'ivr', 'in_app']),
  dueAt: z.string().datetime().optional(),
}).strict();

const meta = (f: { id: string; kind: string; cadence_days: number | null; next_due_at: string | null; active: boolean; created_at: string; reminders: unknown[] }) =>
  ({ id: f.id, kind: f.kind, cadenceDays: f.cadence_days, nextDueAt: f.next_due_at, active: f.active, createdAt: f.created_at, reminders: f.reminders });

export function registerFollowupRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;
  const storeFor = (req: Parameters<typeof authenticate>[0]): FollowupStore | null => (deps.followups ? deps.followups(req.headers.authorization!.slice(7).trim(), req.user!.userId) : null);
  const notSetUp = (reply: Parameters<typeof fail>[0]) => fail(reply, 503, 'not-supported', 'Follow-up planning is not set up.');

  app.get('/encounters/:id/followups', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return notSetUp(reply);
    const ctx = await h.openEncounter(req, reply, false); if (!ctx) return;
    const list = await store.list(ctx.enc.patient_id).catch(() => undefined);
    if (list === undefined) return fail(reply, 502, 'transient', 'Follow-ups could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'followups', entityId: ctx.enc.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success' }))) return;
    return reply.send({ followups: list.map(meta) });
  });

  app.post('/encounters/:id/followups', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return notSetUp(reply);
    const body = createBody.safeParse(req.body); if (!body.success) return h.invalid(reply, body.error);
    const ctx = await h.openEncounter(req, reply, false); if (!ctx) return;
    const nextDueAt = new Date(Date.now() + body.data.firstDueInDays * 86_400_000).toISOString();
    try {
      const r = await store.create({ patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, kind: body.data.kind, cadenceDays: body.data.cadenceDays ?? null, nextDueAt });
      await h.note(req, { action: 'create', entityType: 'followup_schedule', entityId: r.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'success', details: { kind: body.data.kind } });
      return reply.code(201).send({ id: r.id, nextDueAt });
    } catch (err) { return h.dbFail(req, reply, err); }
  });

  app.post('/followups/:id/reminders', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store || !deps.scheduleReminder) return notSetUp(reply);
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Follow-up id must be a UUID.');
    const body = remindBody.safeParse(req.body); if (!body.success) return h.invalid(reply, body.error);
    const f = await store.get(id.data).catch(() => undefined);
    if (f === undefined) return fail(reply, 502, 'transient', 'The follow-up could not be loaded. Try again.');
    if (!f) return fail(reply, 404, 'not-found', 'No such follow-up, or you do not have access.');
    if (!f.active) return fail(reply, 409, 'conflict', 'This follow-up has been stopped.');

    const consents = await req.reader!.getConsents(f.patient_id).catch(() => undefined);
    if (consents === undefined) return fail(reply, 502, 'transient', 'Consent could not be checked. Try again.');
    const rc = consents.find(x => x.purpose === 'reminders' && isConsentActive([x]));
    if (!rc?.id) return fail(reply, 403, 'forbidden', 'The patient has not agreed to reminders. Record that consent first.');

    const dueAt = body.data.dueAt ?? f.next_due_at;
    if (!dueAt) return fail(reply, 400, 'invalid', 'Give a due date for the reminder.');
    const t = Date.parse(dueAt);
    if (t < Date.now() - 60_000 || t > Date.now() + 400 * 86_400_000) return fail(reply, 400, 'invalid', 'The reminder date must be from now up to about a year ahead.');
    try {
      const r = await deps.scheduleReminder({ scheduleId: f.id, consentId: rc.id, dueAt: new Date(t).toISOString(), channel: body.data.channel });
      await h.note(req, { action: 'create', entityType: 'reminder', entityId: r.id, patientId: f.patient_id, facilityId: f.facility_id, outcome: 'success', details: { channel: body.data.channel } });
      return reply.code(201).send({ id: r.id, dueAt: new Date(t).toISOString(), channel: body.data.channel, status: 'scheduled' });
    } catch (err) { return h.dbFail(req, reply, err); }
  });

  app.post('/followups/:id/stop', { preHandler: authenticate }, async (req, reply) => {
    const store = storeFor(req); if (!store) return notSetUp(reply);
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Follow-up id must be a UUID.');
    const f = await store.get(id.data).catch(() => undefined);
    if (f === undefined) return fail(reply, 502, 'transient', 'The follow-up could not be loaded. Try again.');
    if (!f) return fail(reply, 404, 'not-found', 'No such follow-up, or you do not have access.');
    try {
      await store.stop(f.id);
      await h.note(req, { action: 'update', entityType: 'followup_schedule', entityId: f.id, patientId: f.patient_id, facilityId: f.facility_id, outcome: 'success', details: { stopped: true } });
      return reply.send({ id: f.id, active: false });
    } catch (err) { return h.dbFail(req, reply, err); }
  });
}
