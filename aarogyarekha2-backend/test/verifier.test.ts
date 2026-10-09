import { describe, expect, it } from 'vitest';
import { AuthUnavailable, makeTokenVerifier, type Lookup } from '../src/auth/verifier.js';

type Who = { id: string };
const setup = (script: (n: number) => Awaited<ReturnType<Lookup<Who>>>) => {
  let t = 0, calls = 0;
  const v = makeTokenVerifier<Who>(async () => script(++calls), { cacheMs: 5000, staleMs: 120_000, retryDelayMs: 0, now: () => t, sleep: async () => {} });
  return { v, calls: () => calls, at: (ms: number) => { t = ms; } };
};
const ok = { ok: { id: 'u' } } as const;

describe('token verifier', () => {
  it('remembers a genuine token for a few seconds, then asks again', async () => {
    const s = setup(() => ok);
    await s.v('a'); await s.v('a'); await s.v('a'); expect(s.calls()).toBe(1);
    s.at(6000); await s.v('a'); expect(s.calls()).toBe(2);
  });
  it('different tokens are checked separately', async () => { const s = setup(() => ok); await s.v('a'); await s.v('b'); expect(s.calls()).toBe(2); });
  it('identical checks in flight share one answer', async () => { const s = setup(() => ok); const r = await Promise.all([s.v('a'), s.v('a'), s.v('a'), s.v('a')]); expect(s.calls()).toBe(1); expect(r.every(x => x?.id === 'u')).toBe(true); });
  it('a hiccup is retried once and then succeeds', async () => { const s = setup(n => (n === 1 ? { unavailable: 'fetch failed' } : ok)); expect(await s.v('a')).toEqual({ id: 'u' }); expect(s.calls()).toBe(2); });
  it('an invalid token is final: null, not retried, nothing remembered', async () => {
    const s = setup(() => ({ invalid: true })); expect(await s.v('a')).toBeNull(); expect(s.calls()).toBe(1); expect(await s.v('a')).toBeNull(); expect(s.calls()).toBe(2);
  });
  it('a token never proven before is refused as UNAVAILABLE (never as invalid) when the service is down', async () => {
    const s = setup(() => ({ unavailable: 'AuthRetryableFetchError 0' }));
    await expect(s.v('a')).rejects.toBeInstanceOf(AuthUnavailable); await expect(s.v('a')).rejects.toThrow(/AuthRetryableFetchError 0/); expect(s.calls()).toBe(4);
  });
  it('a token proven recently keeps working through an outage, but not for ever', async () => {
    let down = false; const s = setup(() => (down ? { unavailable: 'down' } : ok));
    await s.v('a'); down = true;
    s.at(30_000); expect(await s.v('a')).toEqual({ id: 'u' });
    s.at(200_000); await expect(s.v('a')).rejects.toBeInstanceOf(AuthUnavailable);
  });
  it('an outage never turns an invalid answer into success', async () => {
    let mode: 'ok' | 'invalid' = 'ok'; const s = setup(() => (mode === 'ok' ? ok : { invalid: true }));
    await s.v('a'); mode = 'invalid'; s.at(6000); expect(await s.v('a')).toBeNull(); s.at(7000); expect(await s.v('a')).toBeNull();
  });
});
