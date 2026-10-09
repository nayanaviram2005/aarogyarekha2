import { useCallback, useEffect, useState } from 'react';

const KEY = 'aarogyarekha.low-data';

interface Conn { saveData?: boolean; effectiveType?: string }
export const connectionSuggestsLowData = (c: Conn | undefined | null): boolean => !!c && (c.saveData === true || c.effectiveType === 'slow-2g' || c.effectiveType === '2g');

export function readLowData(storage: Pick<Storage, 'getItem'> | null, conn: Conn | undefined | null): boolean {
  try { const v = storage?.getItem(KEY); if (v === '1') return true; if (v === '0') return false; } catch { }
  return connectionSuggestsLowData(conn);
}

export function useLowData(): [boolean, (v: boolean) => void] {
  const conn = (typeof navigator !== 'undefined' ? (navigator as unknown as { connection?: Conn }).connection : undefined);
  const [on, setOn] = useState(() => readLowData(typeof localStorage !== 'undefined' ? localStorage : null, conn));
  useEffect(() => { const h = () => setOn(readLowData(localStorage, conn)); window.addEventListener('ar-low-data', h); return () => window.removeEventListener('ar-low-data', h); }, [conn]);
  const set = useCallback((v: boolean) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { } setOn(v); window.dispatchEvent(new Event('ar-low-data')); }, []);
  return [on, set];
}

export const pollMs = (lowData: boolean) => (lowData ? 120_000 : 30_000);
