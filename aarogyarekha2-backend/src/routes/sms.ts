// Replies from patients, sent by Twilio to POST /sms/inbound.
//
// Only one reply is acted on: STOP (and Twilio's other opt-out words). It ends the patient's text-message consents ('status_messages' and
// 'reminders') for every patient registered with that number, so the app and the provider agree. Anything else is ignored.
//
// Not logged in: Twilio is not a person. Instead every request must carry a valid X-Twilio-Signature (HMAC of the public address and the
// form fields with the account's auth token), checked in constant time. A request without one is refused and says nothing about why.
// The sender's number is never written to a log or an audit entry; the audit entry holds a count.
import type { RouteCtx } from './intake.js';
import { isStopWord, twilioSignatureValid } from '../sms/twilio.js';

export function registerSmsRoutes(c: RouteCtx): void {
  const { app, deps, fail } = c;
  // Twilio posts a web form. This parser is scoped to this plugin, so no other route starts accepting forms.
  void app.register(async scope => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8 * 1024 }, (_req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (e) { done(e as Error); }
    });
    scope.post('/sms/inbound', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
      const inbound = deps.smsInbound;
      if (!inbound) return fail(reply, 503, 'not-supported', 'Text-message replies are not set up.');
      const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
      const sig = req.headers['x-twilio-signature'];
      if (!twilioSignatureValid(inbound.authToken, inbound.webhookUrl, params, Array.isArray(sig) ? sig[0] : sig)) return reply.code(403).send();
      if (isStopWord(params.Body) && params.From) {
        try { await inbound.store.revokeByPhone(params.From); } catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'could not record an opt-out'); return reply.code(500).send(); }
      }
      return reply.code(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    });
  });
}
