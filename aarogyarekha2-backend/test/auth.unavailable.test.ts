import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, UserReader } from '../src/deps.js';

const reader = (): UserReader => ({ getMe: async () => ({ displayName: 'X', memberships: [] }) } as unknown as UserReader);
const make = async (verify: Deps['verifyToken'], audits: AuditEvent[]) => buildApp({ allowedOrigins: [] }, { verifyToken: verify, userReader: reader, audit: async (e: AuditEvent) => { audits.push(e); } } as unknown as Deps);
const me = (app: Awaited<ReturnType<typeof make>>, token = 't') => app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });

describe('the sign-in service being unavailable is not an expired session', () => {
  it('answers 503 "busy, you are still signed in" and records NO failed login', async () => {
    const audits: AuditEvent[] = []; const app = await make(async () => { throw new Error('auth service unavailable'); }, audits);
    const r = await me(app); expect(r.statusCode).toBe(503); expect(r.json().issue[0].details.text).toMatch(/still signed in/); expect(audits.filter(a => a.action === 'login_failed')).toEqual([]);
  });
  it('a token that is really invalid is still 401 and is recorded', async () => {
    const audits: AuditEvent[] = []; const app = await make(async () => null, audits);
    const r = await me(app); expect(r.statusCode).toBe(401); expect(audits.filter(a => a.action === 'login_failed')).toHaveLength(1);
  });
  it('a good token works', async () => { const app = await make(async () => ({ userId: 'u', aal: 'aal1' }), []); expect((await me(app)).statusCode).toBe(200); });
});

describe('the request ceiling', () => {
  it('is configurable, and over it the answer is a clear 429, not a crash', async () => {
    const app = await buildApp({ allowedOrigins: [], rateLimitPerMinute: 5 }, { verifyToken: async () => ({ userId: 'u', aal: 'aal1' }), userReader: reader, audit: async () => {} } as unknown as Deps);
    const codes: number[] = []; for (let i = 0; i < 8; i++) codes.push((await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer t' } })).statusCode);
    expect(codes.slice(0, 5).every(c => c === 200)).toBe(true); expect(codes.slice(5).every(c => c === 429)).toBe(true);
  });
});
