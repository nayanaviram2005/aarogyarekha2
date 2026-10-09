import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { pollMs, useLowData } from '../lib/lowBandwidth';
import type { QueueEntry } from '../lib/types';

interface QueueState { entries: QueueEntry[]; loading: boolean; error: string | null; generatedAt: string | null; refresh(): Promise<void> }
const Ctx = createContext<QueueState | null>(null);
export const useQueue = () => { const v = useContext(Ctx); if (!v) throw new Error('useQueue outside QueueProvider'); return v; };


export function QueueProvider({ children }: { children: ReactNode }) {
  const { api } = useAuth();
  const [lowData] = useLowData();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const r = await api.queue();
      if (!alive.current) return;
      setEntries(r.entries); setGeneratedAt(r.generatedAt); setError(null);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally { if (alive.current) setLoading(false); }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, pollMs(lowData));
    return () => { alive.current = false; window.clearInterval(t); };
  }, [refresh]);

  const value = useMemo(() => ({ entries, loading, error, generatedAt, refresh }), [entries, loading, error, generatedAt, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
