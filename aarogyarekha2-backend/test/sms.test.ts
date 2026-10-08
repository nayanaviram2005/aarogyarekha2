import { describe, expect, it, vi } from 'vitest';
import { asLang, firstName, planKind, renderStatusMessage, segmentCount, STATUS_WORD, type Kind, type Lang, type Tier } from '../src/sms/messages.js';
import { makeStatusSms, type NotifyContext, type SmsLogRow, type SmsStore } from '../src/sms/notify.js';
import { toE164 } from '../src/sms/phone.js';
import { isStopWord, makeMockSender, makeTwilioSender, SmsError, twilioSignatureValid, type SmsSender } from '../src/sms/twilio.js';

const LANGS: Lang[] = ['en', 'hi', 'or']; const TIERS: Tier[] = [1, 2, 3, 4];
const render = (lang: Lang, tier: Tier, kind: Kind = 'status', name = 'Asha', facility = 'Seed PHC') => renderStatusMessage({ lang, tier, kind, name, facility });

describe('the messages', () => {
  it('every language and every status has a message, with the name filled in and nothing left to fill', () => {
    for (const l of LANGS) for (const t of TIERS) for (const k of ['status', 'moved_down'] as const) {
      const m = render(l, t, k); expect(m, `${l} ${t} ${k}`).toContain('Asha'); expect(m).not.toMatch(/[{}]/); expect(m.length).toBeGreaterThan(40);
    }
  });
  it('says the status, in words, with the English word beside the Hindi and Odia', () => {
    expect(render('en', 4)).toContain('ROUTINE'); expect(render('en', 3)).toContain('URGENT'); expect(render('en', 2)).toContain('VERY URGENT'); expect(render('en', 1)).toContain('IMMEDIATE');
    for (const l of ['hi', 'or'] as const) for (const t of TIERS) expect(render(l, t)).toContain(STATUS_WORD.en[t]);
  });
  it('says what to do: wait, moved up, stay close to the desk, or move ahead quickly', () => {
    expect(render('en', 4)).toMatch(/wait a little while/); expect(render('en', 3)).toMatch(/moved up the queue/); expect(render('en', 2)).toMatch(/moved up the queue.*close to the desk/); expect(render('en', 1)).toMatch(/immediate attention.*move ahead quickly/);
    expect(render('en', 3, 'moved_down')).toMatch(/moved slightly down the queue.*still be seen/);
  });
  it('only the IMMEDIATE message names the facility (where to go)', () => {
    expect(render('en', 1)).toContain('Seed PHC'); for (const t of [2, 3, 4] as Tier[]) expect(render('en', t)).not.toContain('Seed PHC');
    expect(render('hi', 1)).toContain('Seed PHC'); expect(render('or', 1)).toContain('Seed PHC');
  });
  it('every message ends with how to stop, in its own language', () => {
    for (const l of LANGS) for (const t of TIERS) expect(render(l, t)).toMatch(/STOP/);
    expect(render('en', 4)).toMatch(/Reply STOP to stop these messages\.$/);
  });
  it('is in the right script: Hindi in Devanagari, Odia in Odia, and no Bengali or stray script anywhere', () => {
    for (const t of TIERS) {
      expect(render('hi', t)).toMatch(/[ऀ-ॿ]/); expect(render('or', t)).toMatch(/[଀-୿]/); expect(render('en', t)).not.toMatch(/[ऀ-෿]/);
      expect(render('or', t)).not.toMatch(/[ঀ-৿]/); expect(render('hi', t)).not.toMatch(/[଀-୿]/);
    }
  });
  it('never says why the person is here: no symptom, condition, result or advice words', () => {
    for (const l of LANGS) for (const t of TIERS) for (const k of ['status', 'moved_down'] as const) expect(render(l, t, k, 'Asha')).not.toMatch(/fever|pain|pregnan|bleed|diagnos|medicine|tablet|dose|blood pressure|chest/i);
  });
  it('uses the first name only, and cleans odd names', () => {
    expect(firstName('Meera Kumari Das')).toBe('Meera'); expect(firstName('  Ravi ')).toBe('Ravi'); expect(firstName(null)).toBe('there'); expect(firstName('{evil}')).toBe('evil'); expect(firstName('x'.repeat(100))).toHaveLength(30);
  });
  it('a name or facility cannot inject a placeholder into the template', () => {
    const m = render('en', 1, 'status', '{facility}', 'A{b}c'); expect(m).not.toMatch(/[{}]/); expect(m).toContain('Hi facility,'); expect(m).toContain('Abc triage desk');
  });
  it('any language other than Hindi or Odia means English', () => { expect(asLang('ta')).toBe('en'); expect(asLang(null)).toBe('en'); expect(asLang('hi')).toBe('hi'); expect(asLang('or')).toBe('or'); });
});

describe('what each message costs (segments)', () => {
  it('plain English is 1 or 2 segments; Hindi and Odia use more because they travel as Unicode', () => {
    for (const t of TIERS) expect(segmentCount(render('en', t)), `en ${t}`).toBeLessThanOrEqual(2);
    for (const t of TIERS) { expect(segmentCount(render('hi', t))).toBeGreaterThanOrEqual(2); expect(segmentCount(render('or', t))).toBeGreaterThanOrEqual(2); }
  });
  it('counts the boundaries correctly', () => {
    expect(segmentCount('a'.repeat(160))).toBe(1); expect(segmentCount('a'.repeat(161))).toBe(2); expect(segmentCount('नमस्ते'.repeat(11))).toBeGreaterThanOrEqual(1);
    expect(segmentCount('अ'.repeat(70))).toBe(1); expect(segmentCount('अ'.repeat(71))).toBe(2); expect(segmentCount('अ'.repeat(134))).toBe(2); expect(segmentCount('अ'.repeat(135))).toBe(3);
  });
});

describe('which message to send', () => {
  it('the first one is the status; the same news is never sent twice', () => {
    expect(planKind(null, 4)).toBe('status'); expect(planKind(3, 3)).toBe('none');
  });
  it('a more urgent status sends the new status; a less urgent one sends the gentle "moved down"', () => {
    expect(planKind(4, 2)).toBe('status'); expect(planKind(2, 3)).toBe('moved_down'); expect(planKind(1, 4)).toBe('moved_down');
  });
});

describe('phone numbers', () => {
  it('a 10-digit Indian mobile becomes +91, with or without 0, 91 or +91 and spaces or dashes', () => {
    for (const x of ['9876543210', '09876543210', '919876543210', '+91 98765 43210', '98765-43210', ' 9876543210 ']) expect(toE164(x), x).toBe('+919876543210');
  });
  it('refuses anything that is not clearly a mobile number; a wrong number is never guessed', () => {
    for (const x of ['', null, undefined, '12345', '5876543210', '98765432100', '+91123', 'abc', '98765 4321']) expect(toE164(x as never), String(x)).toBeNull();
  });
  it('keeps a number written with + and a country code', () => { expect(toE164('+44 7700 900123')).toBe('+447700900123'); expect(toE164('+1')).toBeNull(); });
});

const ctx = (o: Partial<NotifyContext> = {}): NotifyContext => ({ patientId: 'p1', facilityId: 'f1', facilityName: 'Seed PHC', fullName: 'Asha Rao', language: 'hi', phone: '9876543210', consentActive: true, lastTier: null, ...o });
function setup(c: NotifyContext | null = ctx(), sender: SmsSender = makeMockSender()) {
  const logs: SmsLogRow[] = []; const revoked: string[] = [];
  const store: SmsStore = { context: async () => c, log: async r => { logs.push(r); }, revokeByPhone: async p => { revoked.push(p); return 1; } };
  return { svc: makeStatusSms(store, sender), logs, revoked, sender };
}

describe('after a sign-off', () => {
  it('sends ONE message in the patient\'s language to the registered number, and logs ids only', async () => {
    const { svc, logs, sender } = setup(); const r = await svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'orange' });
    expect(r).toMatchObject({ status: 'sent', language: 'hi', kind: 'status' }); const sent = (sender as ReturnType<typeof makeMockSender>).sent;
    expect(sent).toHaveLength(1); expect(sent[0]!.to).toBe('+919876543210'); expect(sent[0]!.body).toContain('Asha'); expect(sent[0]!.body).not.toContain('Rao'); expect(sent[0]!.body).toContain('VERY URGENT');
    expect(logs).toEqual([expect.objectContaining({ encounterId: 'e1', kind: 'status', tier: 2, language: 'hi', result: 'sent', provider: 'mock', providerId: 'MOCK1' })]);
    expect(JSON.stringify(logs)).not.toMatch(/9876543210|Asha/);
  });
  it('sends nothing without the status-message consent, or without a usable number, and says why', async () => {
    for (const [o, reason] of [[{ consentActive: false }, 'no_consent'], [{ phone: null }, 'no_phone'], [{ phone: '12345' }, 'bad_phone']] as const) {
      const { svc, logs, sender } = setup(ctx(o)); const r = await svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'red' });
      expect(r).toMatchObject({ status: 'skipped', reason }); expect((sender as ReturnType<typeof makeMockSender>).sent).toHaveLength(0); expect(logs[0]).toMatchObject({ result: 'skipped', reason });
    }
  });
  it('English when the language is anything else', async () => {
    const { svc, sender } = setup(ctx({ language: 'ta' })); await svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'green' }); expect((sender as ReturnType<typeof makeMockSender>).sent[0]!.body).toMatch(/^Hi Asha, your status is ROUTINE/);
  });
  it('the same status is not sent twice; a lower status sends "moved down"; a higher one sends the new status', async () => {
    const same = setup(ctx({ lastTier: 3 })); expect((await same.svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'yellow' })).reason).toBe('duplicate'); expect(same.logs).toHaveLength(0);
    const down = setup(ctx({ lastTier: 2, language: 'en' })); expect((await down.svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'yellow' })).kind).toBe('moved_down'); expect((down.sender as ReturnType<typeof makeMockSender>).sent[0]!.body).toMatch(/moved slightly down/);
    const up = setup(ctx({ lastTier: 4, language: 'en' })); expect((await up.svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'red' })).kind).toBe('status'); expect((up.sender as ReturnType<typeof makeMockSender>).sent[0]!.body).toMatch(/IMMEDIATE/);
  });
  it('a failure never throws: it is logged as failed, with the reason in words and no number or text', async () => {
    const boom: SmsSender = { name: 'twilio', configured: true, send: async () => { throw new SmsError('busy', 'busy'); } };
    const { svc, logs } = setup(ctx(), boom); expect(await svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'red' })).toMatchObject({ status: 'failed', reason: 'provider_error' });
    expect(logs[0]).toMatchObject({ result: 'failed', reason: 'provider_error', provider: 'twilio' }); expect(JSON.stringify(logs)).not.toMatch(/9876543210/);
  });
  it('a recipient who replied STOP to the provider is opted out here too', async () => {
    const stopped: SmsSender = { name: 'twilio', configured: true, send: async () => { throw new SmsError('opted_out', 'x'); } };
    const { svc, revoked, logs } = setup(ctx(), stopped); expect(await svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'red' })).toMatchObject({ status: 'skipped', reason: 'opted_out' });
    expect(revoked).toEqual(['+919876543210']); expect(logs[0]).toMatchObject({ result: 'skipped', reason: 'opted_out' });
  });
  it('an invalid number is skipped as a bad phone; an unknown encounter or an unset-up database skips quietly', async () => {
    const bad: SmsSender = { name: 'twilio', configured: true, send: async () => { throw new SmsError('invalid_number', 'x'); } };
    expect((await setup(ctx(), bad).svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'red' })).reason).toBe('bad_phone');
    expect((await setup(null).svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'red' })).status).toBe('skipped');
    const store: SmsStore = { context: async () => { throw new Error('relation does not exist'); }, log: async () => {}, revokeByPhone: async () => 0 };
    expect((await makeStatusSms(store, makeMockSender()).afterSignOff({ encounterId: 'e1', effectiveUrgency: 'red' })).reason).toBe('not_configured');
  });
  it('an unknown urgency is ignored', async () => { expect((await setup().svc.afterSignOff({ encounterId: 'e1', effectiveUrgency: 'purple' })).status).toBe('skipped'); });
});

const okFetch = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
const cfg = { accountSid: 'ACxxxxxxxx', authToken: 'secret-token', from: '+15005550006' };

describe('Twilio sender', () => {
  it('posts the form to the account\'s Messages address with basic auth, and the key is never in the URL', async () => {
    const f = okFetch(201, { sid: 'SM123' }); const r = await makeTwilioSender(cfg, f as never).send('+919876543210', 'Hello');
    expect(r).toEqual({ id: 'SM123' }); const [url, init] = f.mock.calls[0]!; expect(String(url)).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxxxxxxxx/Messages.json'); expect(String(url)).not.toContain('secret-token');
    expect((init.headers as Record<string, string>).authorization).toBe('Basic ' + Buffer.from('ACxxxxxxxx:secret-token').toString('base64'));
    const form = new URLSearchParams(String(init.body)); expect(form.get('To')).toBe('+919876543210'); expect(form.get('From')).toBe('+15005550006'); expect(form.get('Body')).toBe('Hello');
  });
  it('uses a messaging service instead of a From number when one is set', async () => {
    const f = okFetch(201, { sid: 'SM1' }); await makeTwilioSender({ ...cfg, from: undefined, messagingServiceSid: 'MGabc' }, f as never).send('+919876543210', 'x');
    const form = new URLSearchParams(String(f.mock.calls[0]![1].body)); expect(form.get('MessagingServiceSid')).toBe('MGabc'); expect(form.has('From')).toBe(false);
  });
  it('is not configured without an account, a token and a sender, and then sends nothing', async () => {
    for (const c of [{}, { accountSid: 'AC', authToken: 't' }, { authToken: 't', from: '+1' }]) { const f = vi.fn(); const s = makeTwilioSender(c, f as never); expect(s.configured).toBe(false); await expect(s.send('+919876543210', 'x')).rejects.toMatchObject({ kind: 'not_configured' }); expect(f).not.toHaveBeenCalled(); }
  });
  it('turns the provider\'s answers into specific errors without surfacing its body', async () => {
    const run = (status: number, body: unknown): Promise<SmsError> => makeTwilioSender(cfg, okFetch(status, body) as never).send('+919876543210', 'x').then(() => { throw new Error('expected a failure'); }, e => e as SmsError);
    expect((await run(400, { code: 21610, message: 'SECRET BODY' })).kind).toBe('opted_out'); expect((await run(400, { code: 21211 })).kind).toBe('invalid_number'); expect((await run(401, {})).kind).toBe('auth');
    expect((await run(429, {})).kind).toBe('busy'); expect((await run(503, {})).kind).toBe('busy'); expect((await run(400, { code: 99999 })).kind).toBe('rejected');
    const e = await run(400, { code: 21610, message: 'SECRET BODY' }); expect(e.message).not.toMatch(/SECRET|9876543210/);
  });
  it('a network failure is a "network" error', async () => { await expect(makeTwilioSender(cfg, vi.fn().mockRejectedValue(new Error('down')) as never).send('+919876543210', 'x')).rejects.toMatchObject({ kind: 'network' }); });
});

describe('Twilio request signature', () => {
  // The worked example in Twilio's own documentation.
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  it('accepts the signature Twilio documents for that example', () => { expect(twilioSignatureValid('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(true); });
  it('refuses a wrong token, a changed field, a changed address, a missing or malformed signature', () => {
    const good = '0/KCTR6DLpKmkAf8muzZqo1nDgQ=';
    expect(twilioSignatureValid('wrong', url, params, good)).toBe(false); expect(twilioSignatureValid('12345', url, { ...params, Digits: '9999' }, good)).toBe(false);
    expect(twilioSignatureValid('12345', url + 'x', params, good)).toBe(false); expect(twilioSignatureValid('12345', url, params, undefined)).toBe(false); expect(twilioSignatureValid('12345', url, params, 'short')).toBe(false); expect(twilioSignatureValid('', url, params, good)).toBe(false);
  });
});

describe('stop words', () => {
  it('recognises the words that mean stop, in any case, and nothing else', () => {
    for (const w of ['STOP', 'stop', ' Stop ', 'STOPALL', 'unsubscribe', 'CANCEL', 'end', 'QUIT']) expect(isStopWord(w), w).toBe(true);
    for (const w of ['please do not stop', 'stop it now', 'yes', '', undefined, 'STOP2']) expect(isStopWord(w as never), String(w)).toBe(false);
  });
});
