// Calls app.send_referral (migration 0014) and turns its database errors into typed, plain-language failures.
import type { Bundle } from 'fhir/r4';
import type { PoolLike } from '../triage/persist.js';

export type SendFailure = 'not_found' | 'forbidden' | 'needs_consent' | 'needs_review' | 'wrong_state' | 'stale' | 'invalid';

export class SendError extends Error {
  constructor(public readonly kind: SendFailure, message: string) { super(message); this.name = 'SendError'; }
}

export interface SendReferralArgs { senderId: string; referralId: string; assessmentId: string; bundle: Bundle; sha256: string }
export interface SendReferralResult { referralId: string; status: string; sentAt: string; sha256: string; facilityId: string; toFacilityId: string; patientId: string; encounterId: string }

// Wording is ours; database messages are never passed through.
export const SEND_TEXT: Record<SendFailure, string> = {
  not_found: 'No such referral, or you do not have access.',
  forbidden: 'Only a nurse, doctor or medical officer at the referring facility can send a referral.',
  needs_consent: 'The patient has not consented to sharing this referral. Record their consent for referral sharing first.',
  needs_review: 'A reviewer must sign off the triage priority before a referral can be sent.',
  wrong_state: 'This referral or encounter can no longer be sent.',
  stale: 'The assessment changed while the referral was being prepared. Review the latest assessment, then prepare the referral again.',
  invalid: 'The referral is not complete. Choose the receiving facility and write the reason for referral.',
};

export function classifySend(err: unknown): SendError {
  const e = err as { code?: string; hint?: string };
  switch (e.code) {
    case 'P0002': return new SendError('not_found', SEND_TEXT.not_found);
    case '42501': return e.hint === 'referral_consent' ? new SendError('needs_consent', SEND_TEXT.needs_consent) : new SendError('forbidden', SEND_TEXT.forbidden);
    case '55000': return e.hint === 'needs_review' ? new SendError('needs_review', SEND_TEXT.needs_review) : new SendError('wrong_state', SEND_TEXT.wrong_state);
    case '40001': return new SendError('stale', SEND_TEXT.stale);
    case '22023': return new SendError('invalid', SEND_TEXT.invalid);
    default: throw err;
  }
}

export async function sendReferral(pool: PoolLike, a: SendReferralArgs): Promise<SendReferralResult> {
  const db = await pool.connect();
  try {
    const r = await db.query('select app.send_referral($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5) as r',
      [a.senderId, a.referralId, a.assessmentId, JSON.stringify(a.bundle), a.sha256]);
    return r.rows[0].r as SendReferralResult;
  } catch (err) { throw classifySend(err); }
  finally { db.release(); }
}
