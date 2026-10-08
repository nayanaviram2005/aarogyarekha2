// Calls app.record_review (migration 0013) and turns its database errors into typed, plain-language failures.
import type { PoolLike } from '../triage/persist.js';

export type ReviewFailure = 'not_found' | 'forbidden' | 'wrong_state' | 'stale' | 'already_reviewed' | 'confirm_downgrade' | 'invalid';

export class ReviewError extends Error {
  constructor(public readonly kind: ReviewFailure, message: string) { super(message); this.name = 'ReviewError'; }
}

export interface ReviewArgs {
  reviewerId: string; encounterId: string; assessmentId: string;
  action: 'approve' | 'override_urgency';
  toUrgency?: 'red' | 'orange' | 'yellow' | 'green';
  reason?: string; confirmDowngrade?: boolean;
}
export interface ReviewResult {
  reviewId: string; action: 'approve' | 'override_urgency'; fromUrgency: string; effectiveUrgency: string; rulesUrgency: string;
  downgrade: boolean; belowRuleFloor: boolean; facilityId: string; patientId: string;
}

// Wording is ours; the database's messages are never passed through, so no internals can leak.
const TEXT: Record<ReviewFailure, string> = {
  not_found: 'No such encounter, or you do not have access.',
  forbidden: 'Only a nurse, doctor or medical officer at this facility can review a triage assessment.',
  wrong_state: 'This encounter has no assessment to review, or it can no longer be reviewed.',
  stale: 'The assessment changed while you were reviewing. Open the latest assessment and review that one.',
  already_reviewed: 'This assessment has already been reviewed.',
  confirm_downgrade: 'Making the case less urgent than the rules set needs your explicit confirmation.',
  invalid: 'The review could not be recorded. Check the priority and the reason.',
};

export function classify(err: unknown): ReviewError {
  const e = err as { code?: string; hint?: string; message?: string };
  switch (e.code) {
    case 'P0002': return new ReviewError('not_found', TEXT.not_found);
    case '42501': return new ReviewError('forbidden', TEXT.forbidden);
    case '55000': return new ReviewError('wrong_state', TEXT.wrong_state);
    case '40001': return new ReviewError('stale', TEXT.stale);
    case '23505': return new ReviewError('already_reviewed', TEXT.already_reviewed);
    case '22023': return e.hint === 'confirm_downgrade' ? new ReviewError('confirm_downgrade', TEXT.confirm_downgrade) : new ReviewError('invalid', TEXT.invalid);
    default: throw err;      // unknown failures are not ours to explain; the caller treats them as a server problem
  }
}

export async function recordReview(pool: PoolLike, a: ReviewArgs): Promise<ReviewResult> {
  const db = await pool.connect();
  try {
    const r = await db.query(
      'select app.record_review($1::uuid, $2::uuid, $3::uuid, $4::public.review_action_type, $5, $6, $7) as r',
      [a.reviewerId, a.encounterId, a.assessmentId, a.action, a.toUrgency ?? null, a.reason ?? null, a.confirmDowngrade ?? false]);
    return r.rows[0].r as ReviewResult;
  } catch (err) { throw classify(err); }
  finally { db.release(); }
}
