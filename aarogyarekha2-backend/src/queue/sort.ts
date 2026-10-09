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

export function sortQueue<T extends Sortable>(entries: T[], unassessedTier = 3, now: Date = new Date()): T[] {
  const t = (e: T) => {
    if (!e.assessed || e.tier == null) return unassessedTier;
    return e.tier === 4 && waitedMin(e, now) >= AGING.promoteRoutineAfterMin ? 3 : e.tier;
  };
  const since = (e: T) => (e.waitingSince ? Date.parse(e.waitingSince) : Number.MAX_SAFE_INTEGER);
  return [...entries].sort((a, b) =>
    t(a) - t(b)
    || Number(a.assessed) - Number(b.assessed)
    || Number(b.vulnerable) - Number(a.vulnerable)
    || since(a) - since(b));
}
