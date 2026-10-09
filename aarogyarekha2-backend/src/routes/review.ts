import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { ReviewError, type ReviewArgs } from '../review/record.js';
import type { StatusSmsResult } from '../sms/notify.js';

const uuid = z.string().uuid();
const URGENCY = ['red', 'orange', 'yellow', 'green'] as const;
export const REASON_CODES = ['clinical_judgement', 'new_information', 'data_entry_error', 'other'] as const;

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), assessmentId: uuid }).strict(),
  z.object({
    action: z.literal('override'), assessmentId: uuid, toUrgency: z.enum(URGENCY),
    reasonCode: z.enum(REASON_CODES),
    reason: z.string().trim().min(10, 'Explain the change in at least 10 characters.').max(500),
    confirmDowngrade: z.boolean().optional(),
  }).strict(),
]);

const STATUS: Record<ReviewError['kind'], number> = { not_found: 404, forbidden: 403, wrong_state: 409, stale: 409, already_reviewed: 409, confirm_downgrade: 409, invalid: 400 };
const CODE = { not_found: 'not-found', forbidden: 'forbidden', wrong_state: 'conflict', stale: 'conflict', already_reviewed: 'conflict', confirm_downgrade: 'conflict', invalid: 'invalid' } as const;

export function registerReviewRoutes(c: RouteCtx, h: RouteHelpers): void {
  c.app.post('/encounters/:id/review', { preHandler: c.authenticate }, async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return h.invalid(reply, parsed.error);
    if (!(await c.requireMfa(req, reply, 'review'))) return;
    const ctx = await h.openEncounter(req, reply, false); if (!ctx) return;
    const b = parsed.data;

    const args: ReviewArgs = b.action === 'approve'
      ? { reviewerId: req.user!.userId, encounterId: ctx.enc.id, assessmentId: b.assessmentId, action: 'approve' }
      : { reviewerId: req.user!.userId, encounterId: ctx.enc.id, assessmentId: b.assessmentId, action: 'override_urgency', toUrgency: b.toUrgency,
          reason: `[${b.reasonCode}] ${b.reason}`, confirmDowngrade: b.confirmDowngrade === true };

    let r;
    try { r = await c.deps.review(args); }
    catch (err) {
      if (err instanceof ReviewError) {
        await h.note(req, { action: 'update', entityType: 'review', entityId: ctx.enc.id, patientId: ctx.enc.patient_id, facilityId: ctx.enc.facility_id, outcome: 'denied', details: { kind: err.kind, action: b.action } });
        return c.fail(reply, STATUS[err.kind], CODE[err.kind], err.message);
      }
      req.log.error({ reqId: req.id, err: (err as Error).message }, 'review failed');
      return c.fail(reply, 502, 'transient', 'The review could not be recorded. Try again.');
    }

    await h.note(req, {
      action: 'update', entityType: 'review', entityId: r.reviewId, patientId: r.patientId, facilityId: r.facilityId, outcome: 'success',
      details: { action: r.action, assessmentId: b.assessmentId, from: r.fromUrgency, to: r.effectiveUrgency, rules: r.rulesUrgency, downgrade: r.downgrade, belowRuleFloor: r.belowRuleFloor, ...(b.action === 'override' ? { reasonCode: b.reasonCode } : {}) },
    });
    const sms = c.deps.statusSms
      ? await c.deps.statusSms.afterSignOff({ encounterId: ctx.enc.id, effectiveUrgency: r.effectiveUrgency }).catch((): StatusSmsResult => ({ status: 'failed', reason: 'provider_error' }))
      : null;
    if (sms) await h.note(req, { action: 'create', entityType: 'status_sms', entityId: ctx.enc.id, patientId: r.patientId, facilityId: r.facilityId, outcome: sms.status === 'failed' ? 'error' : 'success', details: { status: sms.status, reason: sms.reason ?? null, language: sms.language ?? null, kind: sms.kind ?? null, segments: sms.segments ?? null } });
    return reply.code(201).send({ reviewId: r.reviewId, action: r.action, effectiveUrgency: r.effectiveUrgency, rulesUrgency: r.rulesUrgency, downgrade: r.downgrade, belowRuleFloor: r.belowRuleFloor, ...(sms ? { sms: { status: sms.status, reason: sms.reason ?? null, language: sms.language ?? null } } : {}) });
  });
}
