import type { QueueEntry } from './types';

export interface ScenarioSummary { scenario: string; total: number; byTier: Record<1 | 2 | 3 | 4, number>; notAssessed: number; oldestWaitingSince: string | null }

const hours = (iso: string | null, now: Date) => (iso && !Number.isNaN(Date.parse(iso)) ? (now.getTime() - Date.parse(iso)) / 3_600_000 : null);

export function summarizeScenario(entries: QueueEntry[], scenario: string): ScenarioSummary {
  const mine = entries.filter(e => e.scenario === scenario);
  const byTier: ScenarioSummary['byTier'] = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let notAssessed = 0; let oldest: string | null = null;
  for (const e of mine) {
    if (e.assessed && (e.tier === 1 || e.tier === 2 || e.tier === 3 || e.tier === 4)) byTier[e.tier]++; else notAssessed++;
    if (e.waitingSince && !Number.isNaN(Date.parse(e.waitingSince)) && (oldest === null || Date.parse(e.waitingSince) < Date.parse(oldest))) oldest = e.waitingSince;
  }
  return { scenario, total: mine.length, byTier, notAssessed, oldestWaitingSince: oldest };
}

export const CLUSTER_RULE = { windowHours: 72, threshold: 5, validated: false } as const;

export interface ClusterSignal { count: number; threshold: number; windowHours: number; flagged: boolean }

export function clusterSignal(entries: QueueEntry[], scenario: string, now: Date = new Date(), rule: { windowHours: number; threshold: number } = CLUSTER_RULE): ClusterSignal {
  const count = entries.filter(e => { if (e.scenario !== scenario) return false; const h = hours(e.waitingSince, now); return h !== null && h >= 0 && h <= rule.windowHours; }).length;
  return { count, threshold: rule.threshold, windowHours: rule.windowHours, flagged: count >= rule.threshold };
}

export const BOARD_SCENARIOS: { value: string; label: string; note: string }[] = [
  { value: 'campus_fever', label: 'Campus fever', note: 'Students or staff with fever at a school, college or hostel. A rise in similar visits is flagged for the facility officer to look at.' },
  { value: 'occupational', label: 'Workplace', note: 'Visits linked to work, such as a factory, mine, farm or construction site. Note the workplace in the symptom text so it is on the record.' },
  { value: 'health_camp', label: 'Health camp', note: 'Many people seen in one session, often with an age but no records. Use camp registration to register and queue them quickly.' },
];
