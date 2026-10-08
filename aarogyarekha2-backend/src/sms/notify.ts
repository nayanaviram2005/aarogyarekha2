// Tells a patient their queue status by text message, once a nurse or doctor has signed it off.
//
// Rules that never bend:
//  * only after a human sign-off: an unreviewed draft is never sent to a patient,
//  * only with the patient's separate 'status_messages' consent, re-checked at the moment of sending, and a valid registered number,
//  * ONE message, in the patient's preferred language (English if it is anything else): no repeats in other languages,
//  * the same news is never sent twice; a lower status gets the gentle "moved down" wording, a higher one the new status,
//  * the text holds a first name, the status and what to do, never a symptom or a reason; every message says how to stop,
//  * a failure never blocks or undoes the sign-off, and the log row holds ids and a result, never the number or the text.
import { asLang, firstName, planKind, renderStatusMessage, segmentCount, TIER_OF_URGENCY, type Kind, type Lang, type Tier } from './messages.js';
import { toE164 } from './phone.js';
import { SmsError, type SmsSender } from './twilio.js';

export interface NotifyContext { patientId: string; facilityId: string; facilityName: string; fullName: string | null; language: string | null; phone: string | null; consentActive: boolean; lastTier: Tier | null }
export type SkipReason = 'no_consent' | 'no_phone' | 'bad_phone' | 'opted_out' | 'not_configured' | 'provider_error' | 'duplicate';
export interface SmsLogRow { encounterId: string; patientId: string; facilityId: string; kind: Kind; tier: Tier; language: Lang; result: 'sent' | 'failed' | 'skipped'; reason: SkipReason | null; provider: string; providerId: string | null; segments: number | null }
export interface SmsStore {
  context(encounterId: string): Promise<NotifyContext | null>;
  log(row: SmsLogRow): Promise<void>;
  revokeByPhone(phone: string): Promise<number>;
}
export interface StatusSmsResult { status: 'sent' | 'skipped' | 'failed'; reason?: SkipReason; language?: Lang; segments?: number; kind?: Kind }
export interface StatusSms { afterSignOff(a: { encounterId: string; effectiveUrgency: string }): Promise<StatusSmsResult> }

export function makeStatusSms(store: SmsStore, sender: SmsSender, defaultCountry = '+91'): StatusSms {
  return {
    async afterSignOff({ encounterId, effectiveUrgency }) {
      const tier = TIER_OF_URGENCY[effectiveUrgency];
      if (!tier) return { status: 'skipped', reason: 'not_configured' };
      let ctx: NotifyContext | null;
      try { ctx = await store.context(encounterId); } catch { return { status: 'skipped', reason: 'not_configured' }; }      // migration 0019 not applied yet
      if (!ctx) return { status: 'skipped', reason: 'not_configured' };

      const language = asLang(ctx.language);
      const record = (kind: Kind, result: SmsLogRow['result'], reason: SkipReason | null, providerId: string | null = null, segments: number | null = null) =>
        store.log({ encounterId, patientId: ctx!.patientId, facilityId: ctx!.facilityId, kind, tier, language, result, reason, provider: sender.name, providerId, segments }).catch(() => {});
      const skip = async (reason: SkipReason): Promise<StatusSmsResult> => { await record('status', 'skipped', reason); return { status: 'skipped', reason, language }; };

      if (!ctx.consentActive) return skip('no_consent');
      if (!ctx.phone) return skip('no_phone');
      const to = toE164(ctx.phone, defaultCountry); if (!to) return skip('bad_phone');
      const kind = planKind(ctx.lastTier, tier);
      if (kind === 'none') return { status: 'skipped', reason: 'duplicate', language };            // already told: nothing to say, nothing to log

      const body = renderStatusMessage({ lang: language, tier, kind, name: firstName(ctx.fullName), facility: ctx.facilityName });
      const segments = segmentCount(body);
      try {
        const r = await sender.send(to, body);
        await record(kind, 'sent', null, r.id, segments);
        return { status: 'sent', language, segments, kind };
      } catch (err) {
        const e = err instanceof SmsError ? err : null;
        if (e?.kind === 'opted_out') { await store.revokeByPhone(to).catch(() => 0); await record(kind, 'skipped', 'opted_out'); return { status: 'skipped', reason: 'opted_out', language }; }
        if (e?.kind === 'invalid_number') { await record(kind, 'skipped', 'bad_phone'); return { status: 'skipped', reason: 'bad_phone', language }; }
        if (e?.kind === 'not_configured') { await record(kind, 'skipped', 'not_configured'); return { status: 'skipped', reason: 'not_configured', language }; }
        await record(kind, 'failed', 'provider_error');
        return { status: 'failed', reason: 'provider_error', language };
      }
    },
  };
}
