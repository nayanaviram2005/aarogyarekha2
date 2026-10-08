import type { QueueEntry } from './types';

/** Filters for the queue list. A filter only HIDES rows on this screen; it never changes the order or the priority. */
export interface QueueFilter {
  tiers: ReadonlySet<number | 'none'>;         // empty = all
  scenario: string;                            // '' = all
  language: string;                            // '' = all
  facilityId: string;                          // '' = all
  minWaitMinutes: number;                      // 0 = all
}
export const NO_FILTER: QueueFilter = { tiers: new Set(), scenario: '', language: '', facilityId: '', minWaitMinutes: 0 };

export const isFiltering = (f: QueueFilter) => f.tiers.size > 0 || !!f.scenario || !!f.language || !!f.facilityId || f.minWaitMinutes > 0;

const waited = (e: QueueEntry, now: Date) => { const t = e.waitingSince ? Date.parse(e.waitingSince) : NaN; return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 60_000); };

export function applyQueueFilter(entries: QueueEntry[], f: QueueFilter, now: Date = new Date()): QueueEntry[] {
  return entries.filter(e => {
    if (f.tiers.size > 0) { const key = e.assessed && e.tier != null ? e.tier : 'none'; if (!f.tiers.has(key)) return false; }
    if (f.scenario && e.scenario !== f.scenario) return false;
    if (f.language && e.patient.preferred_language !== f.language) return false;
    if (f.facilityId && e.facilityId !== f.facilityId) return false;
    if (f.minWaitMinutes > 0 && waited(e, now) < f.minWaitMinutes) return false;
    return true;
  });
}

/** Distinct values present in the queue, for the dropdowns. */
export const queueFacets = (entries: QueueEntry[]) => ({
  scenarios: [...new Set(entries.map(e => e.scenario))].sort(),
  languages: [...new Set(entries.map(e => e.patient.preferred_language))].sort(),
  facilityIds: [...new Set(entries.map(e => e.facilityId).filter((x): x is string => !!x))].sort(),
});
