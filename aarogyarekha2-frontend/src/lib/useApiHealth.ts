import { useEffect, useState } from 'react';
import type { Api } from './types';

export type Health = 'connecting' | 'online' | 'offline';

export const PING_OK_MS = 20_000;
export const PING_RETRY_MS = 4_000;
export const PING_TIMEOUT_MS = 10_000;
export const MISSES_BEFORE_OFFLINE = 2;

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
