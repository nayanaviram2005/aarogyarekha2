export const AGING = { promoteRoutineAfterMin: 180, flagTier3AfterMin: 90, flagTier4AfterMin: 180, validated: false } as const;

export interface Sortable {
  assessed: boolean;
  tier: number | null;
  vulnerable: boolean;
  waitingSince: string | null;
}

const waitedMin = (e: Sortable, now: Date) => {
  const t = e.waitingSince ? Date.parse(e.waitingSince) : NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 60_000);
};

export function isWaitingLong(e: Sortable, now: Date = new Date()): boolean {
  if (!e.assessed || e.tier == null) return false;
  const w = waitedMin(e, now);
  return (e.tier === 3 && w >= AGING.flagTier3AfterMin) || (e.tier === 4 && w >= AGING.flagTier4AfterMin);
}

export function effectiveTier(e: Sortable, unassessedTier = 3, now: Date = new Date()): number {
  if (!e.assessed || e.tier == null) return unassessedTier;
  return e.tier === 4 && waitedMin(e, now) >= AGING.promoteRoutineAfterMin ? 3 : e.tier;
}

export type OrderWhy = 'first' | 'tier' | 'unassessed' | 'vulnerable' | 'wait';
export interface OrderInfo { position: number; of: number; effectiveTier: number; promoted: boolean; why: OrderWhy; waitedMin: number }

export function explainOrder<T extends Sortable>(sorted: T[], unassessedTier = 3, now: Date = new Date()): OrderInfo[] {
  return sorted.map((e, i) => {
    const eff = effectiveTier(e, unassessedTier, now);
    const prev = i > 0 ? sorted[i - 1]! : null;
    let why: OrderWhy = 'first';
    if (prev) {
      if (effectiveTier(prev, unassessedTier, now) < eff) why = 'tier';
      else if (!prev.assessed && e.assessed) why = 'unassessed';
      else if (prev.vulnerable && !e.vulnerable) why = 'vulnerable';
      else why = 'wait';
    }
    return { position: i + 1, of: sorted.length, effectiveTier: eff, promoted: e.assessed && e.tier === 4 && eff === 3, why, waitedMin: Math.round(waitedMin(e, now)) };
  });
}

export function sortQueue<T extends Sortable>(entries: T[], unassessedTier = 3, now: Date = new Date()): T[] {
  const t = (e: T) => effectiveTier(e, unassessedTier, now);
  const since = (e: T) => (e.waitingSince ? Date.parse(e.waitingSince) : Number.MAX_SAFE_INTEGER);
  return [...entries].sort((a, b) =>
    t(a) - t(b)
    || Number(a.assessed) - Number(b.assessed)
    || Number(b.vulnerable) - Number(a.vulnerable)
    || since(a) - since(b));
}
