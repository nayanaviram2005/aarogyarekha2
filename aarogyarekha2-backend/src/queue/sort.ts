// Queue ordering. Pure, so the rule can be tested and shown to a reviewer.
//
//   1. Most urgent tier first. An encounter that has NOT been assessed yet counts as `unassessedTier` (the engine's
//      "nothing assessed" tier), never as routine: an unassessed patient could be an emergency.
//   2. Within a tier: not-yet-assessed before assessed (their real urgency is unknown, so they need a look sooner).
//   3. Then vulnerable patients (young child, older adult, pregnant) first.
//   4. Then whoever has waited longest.
//
// Fairness guard (so routine patients are not starved by a stream of urgent ones):
//   * a routine (tier 4) patient who has waited AGING.promoteRoutineAfterMin or more is ordered as tier 3. Only that one step:
//     nobody is ever moved into tier 2 or 1 by waiting, so a genuine emergency is never delayed by an old routine case.
//   * a tier 3 or tier 4 patient past the "waiting long" mark is FLAGGED so a person looks at them. Flagging does not reorder.
// The minutes are DRAFT placeholders for the facility to set; they are not clinical standards.
export const AGING = { promoteRoutineAfterMin: 180, flagTier3AfterMin: 90, flagTier4AfterMin: 180, validated: false } as const;

export interface Sortable {
  assessed: boolean;
  tier: number | null;
  vulnerable: boolean;
  waitingSince: string | null;     // ISO time the patient joined the queue
}

const waitedMin = (e: Sortable, now: Date) => {
  const t = e.waitingSince ? Date.parse(e.waitingSince) : NaN;
  return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 60_000);
};

/** True when a person should look at this patient because they have waited long for their tier. Display only. */
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
