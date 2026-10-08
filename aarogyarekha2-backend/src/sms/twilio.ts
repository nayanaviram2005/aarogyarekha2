// Sending a text message through Twilio, over its REST API (no extra package: one POST, the key in a header).
//   POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json   (basic auth: account sid and auth token)
// The same Twilio account and number serve the status messages and, if you choose, the reminders.
//
// What this file never does: log or return the recipient's number or the text; put a key in a URL; surface a provider reply body.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SmsErrorKind = 'not_configured' | 'invalid_number' | 'opted_out' | 'auth' | 'busy' | 'rejected' | 'network';
export class SmsError extends Error { constructor(public readonly kind: SmsErrorKind, message: string) { super(message); this.name = 'SmsError'; } }

export interface TwilioConfig { accountSid?: string; authToken?: string; from?: string; messagingServiceSid?: string; timeoutMs?: number }
export interface SmsSender { name: 'twilio' | 'mock'; configured: boolean; send(to: string, body: string): Promise<{ id: string }> }

/** Twilio error codes that mean something specific about THIS recipient, not about the account. */
const INVALID = new Set([21211, 21214, 21217, 21401, 21614, 21408]);        // not a valid / not reachable / not allowed number
const OPTED_OUT = 21610;                                                      // the recipient replied STOP to this sender

export function makeTwilioSender(cfg: TwilioConfig, fetchImpl: typeof fetch = fetch): SmsSender {
  const sid = cfg.accountSid?.trim(), token = cfg.authToken?.trim(), from = cfg.from?.trim(), svc = cfg.messagingServiceSid?.trim();
  const configured = !!sid && !!token && (!!from || !!svc);
  return {
    name: 'twilio', configured,
    async send(to, body) {
      if (!configured) throw new SmsError('not_configured', 'Text messages are not set up.');
      const form = new URLSearchParams({ To: to, Body: body });
      if (svc) form.set('MessagingServiceSid', svc); else form.set('From', from!);
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 15000);
      let res: Response;
      try {
        res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid!)}/Messages.json`, {
          method: 'POST', body: form, signal: ctl.signal,
          headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
        });
      } catch { throw new SmsError('network', 'The text-message service could not be reached.'); }
      finally { clearTimeout(t); }
      let json: { sid?: string; code?: number } = {};
      try { json = (await res.json()) as typeof json; } catch { /* body is never surfaced */ }
      if (res.ok && typeof json.sid === 'string') return { id: json.sid };
      if (json.code === OPTED_OUT) throw new SmsError('opted_out', 'The recipient has opted out of messages.');
      if (json.code !== undefined && INVALID.has(json.code)) throw new SmsError('invalid_number', 'That phone number cannot receive text messages.');
      if (res.status === 401 || res.status === 403) throw new SmsError('auth', 'The text-message service refused the account details.');
      if (res.status === 429 || res.status >= 500) throw new SmsError('busy', 'The text-message service is busy.');
      throw new SmsError('rejected', 'The text-message service refused the message.');
    },
  };
}

/** A sender that sends nothing. It is the default, so a missing or half-finished Twilio setup can never message anyone by accident. */
export function makeMockSender(): SmsSender & { sent: { to: string; body: string }[] } {
  const sent: { to: string; body: string }[] = [];
  return { name: 'mock', configured: true, sent, async send(to, body) { sent.push({ to, body }); return { id: `MOCK${sent.length}` }; } };
}

/**
 * Twilio signs every webhook it sends: HMAC-SHA1 of the full URL followed by each POST parameter (name then value, sorted by name),
 * base64, in the X-Twilio-Signature header, using the account's auth token. A request without a good signature is not from Twilio.
 */
export function twilioSignatureValid(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The words that mean "stop messaging me" (Twilio's own opt-out keywords, also the ones we promise in each message). */
export const isStopWord = (body: string | undefined): boolean => /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i.test(body ?? '');
