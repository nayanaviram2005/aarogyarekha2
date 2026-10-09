import { useEffect, useState } from 'react';
import type { Api } from './types';

export type Health = 'connecting' | 'online' | 'offline';

export const PING_OK_MS = 20_000;       // how often to check while things are fine
export const PING_RETRY_MS = 4_000;     // how soon to look again after a miss (a sleeping server needs a few tries to wake)
export const PING_TIMEOUT_MS = 10_000;  // one check that takes longer than this counts as a miss
export const MISSES_BEFORE_OFFLINE = 2;

/**
 * Whether the API can be reached. One slow or failed check is not "offline": a server on a free host can need a minute to wake, and one
 * dropped request on a weak connection is normal. It says "connecting" after the first miss and "offline" only after two in a row, and it
 * looks again quickly when it is not sure, when the browser regains its connection and when the tab comes back to the front.
 */
export function useApiHealth(api: Api | null): Health {
  const [state, setState] = useState<Health>('connecting');
  useEffect(() => {
    if (!api) return;
    let live = true; let misses = 0; let timer: number | undefined;
    const check = async (): Promise<boolean> => {
      let t: number | undefined;
      const limit = new Promise<boolean>(r => { t = window.setTimeout(() => r(false), PING_TIMEOUT_MS); });
      try { return await Promise.race([api.health(), limit]); } catch { return false; } finally { window.clearTimeout(t); }
    };
    const run = async () => {
      window.clearTimeout(timer);
      const ok = await check();
      if (!live) return;
      if (ok) { misses = 0; setState('online'); } else { misses += 1; setState(misses >= MISSES_BEFORE_OFFLINE ? 'offline' : 'connecting'); }
      timer = window.setTimeout(() => void run(), ok ? PING_OK_MS : PING_RETRY_MS);
    };
    const wake = () => { if (document.visibilityState !== 'hidden') void run(); };
    void run();
    window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake);
    return () => { live = false; window.clearTimeout(timer); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); };
  }, [api]);
  return state;
}
