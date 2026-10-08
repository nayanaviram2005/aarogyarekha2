import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, UserReader, UserWriter } from '../src/deps.js';
import type { EncounterRow } from '../src/fhir/project.js';
import type { ReviewResult } from '../src/review/record.js';
import type { StatusSms, StatusSmsResult } from '../src/sms/notify.js';

const P = '11111111-1111-4111-8111-111111111111', F = '22222222-2222-4222-8222-222222222222', E = '33333333-3333-4333-8333-333333333333', A = '44444444-4444-4444-8444-444444444444';
const enc = { id: E, patient_id: P, facility_id: F, status: 'submitted' } as unknown as EncounterRow;
const URL_ = 'https://api.example.org/sms/inbound', TOKEN = 'twilio-secret';
const sign = (params: Record<string, string>, token = TOKEN, url = URL_) => createHmac('sha1', token).update(url + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');
const form = (p: Record<string, string>) => new URLSearchParams(p).toString();

interface World { calls: { encounterId: string; effectiveUrgency: string }[]; sms: StatusSmsResult | Error; revoked: string[]; audits: AuditEvent[]; reviewFails: boolean; inboundOn: boolean; revokeFails: boolean }
let w: World;
const result: ReviewResult = { reviewId: 'r1', action: 'approve', fromUrgency: 'orange', effectiveUrgency: 'orange', rulesUrgency: 'orange', downgrade: false, belowRuleFloor: false, facilityId: F, patientId: P } as ReviewResult;

const make = async (withSms = true) => {
  const statusSms: StatusSms = { afterSignOff: async a => { w.calls.push(a); if (w.sms instanceof Error) throw w.sms; return w.sms; } };
  const deps = {
    verifyToken: async (t: string) => (t === 'clinician' ? { userId: 'u-c', aal: 'aal2' } : null),
    userReader: () => ({ getEncounter: async () => enc, getMe: async () => ({ displayName: 'N', memberships: [] }) }) as unknown as UserReader,
    userWriter: () => ({ hasActiveConsent: async () => true }) as unknown as UserWriter,
    review: async () => { if (w.reviewFails) throw new Error('db down'); return result; },
    ...(withSms ? { statusSms } : {}),
    ...(w.inboundOn ? { smsInbound: { authToken: TOKEN, webhookUrl: URL_, store: { context: async () => null, log: async () => {}, revokeByPhone: async (p: string) => { if (w.revokeFails) throw new Error('db'); w.revoked.push(p); return 1; } } } } : {}),
    audit: async (e: AuditEvent) => { w.audits.push(e); },
  } as unknown as Deps;
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const review = (app: App, token: string | null = 'clinician') => app.inject({ method: 'POST', url: `/encounters/${E}/review`, payload: { action: 'approve', assessmentId: A }, headers: token ? { authorization: `Bearer ${token}` } : {} });
const inbound = (app: App, params: Record<string, string>, signature: string | undefined = sign(params), type = 'application/x-www-form-urlencoded') =>
  app.inject({ method: 'POST', url: '/sms/inbound', payload: form(params), headers: { 'content-type': type, ...(signature ? { 'x-twilio-signature': signature } : {}) } });

beforeEach(() => { w = { calls: [], sms: { status: 'sent', language: 'hi', segments: 2, kind: 'status' }, revoked: [], audits: [], reviewFails: false, inboundOn: true, revokeFails: false }; });

describe('the sign-off sends the status message', () => {
  it('after the decision is recorded, with the effective urgency, and tells the screen what happened (no number, no text)', async () => {
    const r = await review(await make());
    expect(r.statusCode).toBe(201); expect(w.calls).toEqual([{ encounterId: E, effectiveUrgency: 'orange' }]); expect(r.json().sms).toEqual({ status: 'sent', reason: null, language: 'hi' });
    expect(JSON.stringify(r.json())).not.toMatch(/\+91|Hi |नमस्ते/);
  });
  it('audits the send with counts and codes only', async () => {
    await review(await make()); const a = w.audits.find(x => x.entityType === 'status_sms')!;
    expect(a).toMatchObject({ patientId: P, facilityId: F, outcome: 'success', details: { status: 'sent', language: 'hi', kind: 'status', segments: 2 } }); expect(JSON.stringify(a)).not.toMatch(/Test Patient|\+91/);
  });
  it('a skipped message says why (for example no consent) and is not an error', async () => {
    w.sms = { status: 'skipped', reason: 'no_consent', language: 'en' }; const r = await review(await make()); expect(r.statusCode).toBe(201); expect(r.json().sms).toMatchObject({ status: 'skipped', reason: 'no_consent' });
  });
  it('a failing or throwing sender never undoes or blocks the sign-off', async () => {
    w.sms = new Error('provider exploded'); const r = await review(await make()); expect(r.statusCode).toBe(201); expect(r.json().sms).toMatchObject({ status: 'failed' }); expect(r.json().reviewId).toBe('r1');
    w.sms = { status: 'failed', reason: 'provider_error' }; expect((await review(await make())).statusCode).toBe(201);
  });
  it('nothing is sent when the sign-off itself failed', async () => { w.reviewFails = true; const r = await review(await make()); expect(r.statusCode).toBe(502); expect(w.calls).toEqual([]); });
  it('nothing is sent for someone who is not signed in', async () => { const r = await review(await make(), null); expect(r.statusCode).toBe(401); expect(w.calls).toEqual([]); });
  it('with text messages not set up the sign-off works and has no sms field', async () => { const r = await review(await make(false)); expect(r.statusCode).toBe(201); expect(r.json()).not.toHaveProperty('sms'); });
});

describe('replies from patients (POST /sms/inbound)', () => {
  it('a signed STOP ends the number\'s text consents and answers Twilio with empty TwiML', async () => {
    const app = await make(); const r = await inbound(app, { From: '+919876543210', To: '+15005550006', Body: 'STOP' });
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toMatch(/text\/xml/); expect(r.body).toContain('<Response>'); expect(w.revoked).toEqual(['+919876543210']);
  });
  it('accepts the other opt-out words in any case', async () => { const app = await make(); for (const b of ['stop', ' Stopall ', 'UNSUBSCRIBE', 'cancel', 'end', 'quit']) await inbound(app, { From: '+911111111111', Body: b }); expect(w.revoked).toHaveLength(6); });
  it('any other reply is ignored, politely', async () => { const r = await inbound(await make(), { From: '+919876543210', Body: 'when will I be called?' }); expect(r.statusCode).toBe(200); expect(w.revoked).toEqual([]); });
  it('refuses a request without a good signature, and says nothing about why', async () => {
    const app = await make(); const p = { From: '+919876543210', Body: 'STOP' };
    for (const sig of [undefined, 'AAAA', sign(p, 'wrong-token'), sign(p, TOKEN, URL_ + 'x')]) { const r = await inbound(app, p, sig ?? ''); expect(r.statusCode).toBe(403); expect(r.body).toBe(''); }
    expect(w.revoked).toEqual([]);
  });
  it('a body tampered with after signing is refused', async () => { const p = { From: '+919876543210', Body: 'hello' }; const sig = sign(p); const r = await inbound(await make(), { ...p, Body: 'STOP' }, sig); expect(r.statusCode).toBe(403); expect(w.revoked).toEqual([]); });
  it('is not set up without the auth token and address: 503', async () => { w.inboundOn = false; expect((await inbound(await make(), { From: '+91', Body: 'STOP' })).statusCode).toBe(503); });
  it('an opt-out that cannot be recorded is an error (so Twilio retries), not a silent success', async () => { w.revokeFails = true; const r = await inbound(await make(), { From: '+919876543210', Body: 'STOP' }); expect(r.statusCode).toBe(500); });
  it('the sender\'s number is never written to the audit log', async () => { await inbound(await make(), { From: '+919876543210', Body: 'STOP' }); expect(JSON.stringify(w.audits)).not.toContain('9876543210'); });
  it('a form is accepted only here: other routes still refuse form bodies', async () => {
    const app = await make(); const r = await app.inject({ method: 'POST', url: `/encounters/${E}/review`, payload: form({ action: 'approve' }), headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer clinician' } });
    expect([400, 415]).toContain(r.statusCode); expect(w.calls).toEqual([]);
  });
});
