import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { DbError, type ReferralBoard, type ReferralStatus } from '../deps.js';
import { isConsentActive } from '../intake/consent.js';

const uuid = z.string().uuid();
const ALL: ReferralStatus[] = ['requested', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled'];
const OPEN: ReferralStatus[] = ['requested', 'accepted', 'in_progress'];
const query = z.object({ status: z.string().optional() }).strict();
const ACTIONS = { accept: 'accepted', reject: 'rejected', start: 'in_progress', complete: 'completed' } as const;
const respondBody = z.object({ action: z.enum(['accept', 'reject', 'start', 'complete']), note: z.string().trim().max(500).optional() }).strict();
const PRIOR: Record<keyof typeof ACTIONS, ReferralStatus> = { accept: 'requested', reject: 'requested', start: 'accepted', complete: 'in_progress' };
const PRIORITY_RANK = { stat: 0, asap: 1, urgent: 2, routine: 3 } as const;

export function registerReferralBoardRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;
  const boardFor = (req: FastifyRequest): ReferralBoard | null => (deps.referralBoard ? deps.referralBoard(req.headers.authorization!.slice(7).trim(), req.user!.userId) : null);

  async function myFacilities(req: FastifyRequest, reply: FastifyReply): Promise<string[] | null> {
    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) { fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.'); return null; }
    const ids = [...new Set(me.memberships.filter(m => m.role !== 'facility_admin').map(m => m.facilityId))];
    if (ids.length === 0) { fail(reply, 403, 'forbidden', 'Only clinical staff can see referrals.'); return null; }
    return ids;
  }

  async function list(req: FastifyRequest, reply: FastifyReply, side: 'incoming' | 'sent') {
    const board = boardFor(req); if (!board) return fail(reply, 503, 'not-supported', 'Referral lists are not set up.');
    const q = query.safeParse(req.query); if (!q.success) return fail(reply, 400, 'invalid', 'Unknown filter.');
    let statuses = OPEN;
    if (q.data.status) {
      const asked = q.data.status.split(',').map(s => s.trim());
      if (!asked.every(s => (ALL as string[]).includes(s))) return fail(reply, 400, 'invalid', 'Status must be one of: ' + ALL.join(', ') + '.');
      statuses = asked as ReferralStatus[];
    }
    const fac = await myFacilities(req, reply); if (!fac) return;
    const rows = await board.list(side, fac, statuses, 200).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'Referrals could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: side === 'incoming' ? 'referrals_incoming' : 'referrals_sent', outcome: 'success', details: { count: rows.length } }))) return;
    const facs = await req.reader!.listFacilities().catch(() => []);
    const name = (id: string | null) => (id ? facs.find(f => f.id === id)?.name ?? null : null);
    const sorted = [...rows].sort((a, b) => (side === 'incoming' ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] : 0) || Date.parse(b.sent_at ?? b.updated_at) - Date.parse(a.sent_at ?? a.updated_at));
    return reply.send({ referrals: sorted.map(r => ({
      id: r.id, encounterId: r.encounter_id, patientId: r.patient_id, status: r.status, statusReason: r.status_reason, priority: r.priority, reasonText: r.reason_text, sentAt: r.sent_at, updatedAt: r.updated_at,
      from: { id: r.from_facility_id, name: name(r.from_facility_id) }, to: r.to_facility_id ? { id: r.to_facility_id, name: name(r.to_facility_id) } : null,
      patient: r.patient ? { id: r.patient.id, publicRef: r.patient.public_ref, fullName: r.patient.full_name, sex: r.patient.sex, birthDate: r.patient.birth_date, ageYears: r.patient.age_years_reported, language: r.patient.preferred_language } : null,
    })) });
  }

  app.get('/referrals/incoming', { preHandler: authenticate }, (req, reply) => list(req, reply, 'incoming'));
  app.get('/referrals/sent', { preHandler: authenticate }, (req, reply) => list(req, reply, 'sent'));

  app.post('/referrals/:id/respond', { preHandler: authenticate }, async (req, reply) => {
    const board = boardFor(req); if (!board) return fail(reply, 503, 'not-supported', 'Referral responses are not set up.');
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Referral id must be a UUID.');
    const body = respondBody.safeParse(req.body); if (!body.success) return h.invalid(reply, body.error);
    const { action } = body.data; const note = body.data.note?.trim() || null;
    if (action === 'reject' && (note ?? '').length < 5) return fail(reply, 400, 'invalid', 'Give a reason for declining, so the sending facility knows what to do next.');
    if (!(await c.requireMfa(req, reply, 'referral_' + action))) return;

    const ref = await req.reader!.getReferral(id.data).catch(() => undefined);
    if (ref === undefined) return fail(reply, 502, 'transient', 'The referral could not be loaded. Try again.');
    if (!ref || ref.status === 'draft') return fail(reply, 404, 'not-found', 'No such referral, or you do not have access.');
    const fac = await myFacilities(req, reply); if (!fac) return;
    if (!ref.to_facility_id || !fac.includes(ref.to_facility_id)) return fail(reply, 403, 'forbidden', 'Only the receiving facility can respond to this referral.');
    if (ref.status !== PRIOR[action]) return fail(reply, 409, 'conflict', `This referral is ${ref.status.replace(/_/g, ' ')}, so it cannot be ${action === 'accept' ? 'accepted' : action === 'reject' ? 'declined' : action === 'start' ? 'marked as arrived' : 'completed'}.`);

    if (action === 'accept' || action === 'start') {
      const consents = await req.reader!.getConsents(ref.patient_id).catch(() => undefined);
      if (consents === undefined) return fail(reply, 502, 'transient', 'Consent could not be checked. Try again.');
      if (!consents.some(x => x.purpose === 'referral_sharing' && isConsentActive([x]))) {
        await h.note(req, { action: 'update', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.to_facility_id, outcome: 'denied', details: { action, why: 'consent_withdrawn' } });
        return fail(reply, 409, 'conflict', 'The patient\'s consent to share this referral is no longer in force. Do not use the record. You can decline it.');
      }
    }

    try {
      await board.respond(ref.id, ACTIONS[action], note);
      await h.note(req, { action: 'update', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.to_facility_id, outcome: 'success', details: { action, to: ACTIONS[action], hasNote: !!note } });
      return reply.send({ id: ref.id, status: ACTIONS[action] });
    } catch (err) {
      const code = (err as DbError).code;
      await h.note(req, { action: 'update', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.to_facility_id, outcome: 'denied', details: { action, code } });
      if (code === '23514') return fail(reply, 409, 'conflict', 'That is not a legal next step for this referral. Reload to see where it stands.');
      if (code === '42501') return fail(reply, 403, 'forbidden', 'Only a reviewing doctor or nurse at the receiving facility can respond to a referral.');
      return h.dbFail(req, reply, err);
    }
  });
}
