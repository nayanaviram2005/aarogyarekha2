import { createHash } from 'node:crypto';

export type Lookup<W> = (token: string) => Promise<{ ok: W } | { invalid: true } | { unavailable: string }>;
export interface VerifierOptions { cacheMs?: number; staleMs?: number; retryDelayMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> }
export class AuthUnavailable extends Error { constructor(detail: string) { super(`auth service unavailable (${detail})`); } }

export function makeTokenVerifier<W>(lookup: Lookup<W>, opts: VerifierOptions = {}): (token: string) => Promise<W | null> {
  const cacheMs = opts.cacheMs ?? 5000, staleMs = opts.staleMs ?? 120_000, retryDelayMs = opts.retryDelayMs ?? 300;
  const now = opts.now ?? Date.now, sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const proven = new Map<string, { who: W; provenAt: number }>();
  const inflight = new Map<string, Promise<W | null>>();

  async function check(token: string, key: string): Promise<W | null> {
    let r = await lookup(token);
    if ('unavailable' in r) { await sleep(retryDelayMs); r = await lookup(token); }
    if ('ok' in r) {
      proven.set(key, { who: r.ok, provenAt: now() });
      if (proven.size > 500) for (const [k, v] of proven) if (now() - v.provenAt > staleMs) proven.delete(k);
      return r.ok;
    }
    if ('invalid' in r) { proven.delete(key); return null; }
    const earlier = proven.get(key);
    if (earlier && now() - earlier.provenAt <= staleMs) return earlier.who;
    throw new AuthUnavailable(r.unavailable);
  }

  return async token => {
    const key = createHash('sha256').update(token).digest('hex');
    const hit = proven.get(key);
    if (hit && now() - hit.provenAt <= cacheMs) return hit.who;
    let p = inflight.get(key);
    if (!p) { p = check(token, key).finally(() => inflight.delete(key)); inflight.set(key, p); }
    return p;
  };
}
