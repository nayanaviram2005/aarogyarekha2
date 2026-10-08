/**
 * The last few records opened in THIS tab, so a nurse on a shared computer can jump back quickly.
 * Kept in sessionStorage (gone when the tab closes). It holds only the visit id and the record number, never a name or any detail.
 */
const KEY = 'aarogyarekha.recent';
export interface Recent { encounterId: string; ref: string }
const MAX = 6;

export function readRecent(storage: Pick<Storage, 'getItem'> | null): Recent[] {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((r): r is Recent => !!r && typeof (r as Recent).encounterId === 'string' && typeof (r as Recent).ref === 'string' && /^[0-9a-f-]{36}$/i.test((r as Recent).encounterId) && /^[A-Za-z0-9-]{3,24}$/.test((r as Recent).ref)).slice(0, MAX) : [];
  } catch { return []; }
}

export function pushRecent(storage: Pick<Storage, 'getItem' | 'setItem'> | null, r: Recent): Recent[] {
  const next = [r, ...readRecent(storage).filter(x => x.encounterId !== r.encounterId)].slice(0, MAX);
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  return next;
}

export function clearRecent(storage: Pick<Storage, 'removeItem'> | null) { try { storage?.removeItem(KEY); } catch { /* ignore */ } }
