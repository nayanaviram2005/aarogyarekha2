export interface TrendPoint { kind: string; value: number; unit: string; at: string }
export type Direction = 'higher' | 'lower' | 'steady' | 'single';
export interface TrendSummary { kind: string; unit: string; n: number; latest: TrendPoint; previous: TrendPoint | null; min: number; max: number; direction: Direction; points: TrendPoint[] }

export const STEADY_BELOW = 0.05;

export function summarizeTrend(points: TrendPoint[], kind: string): TrendSummary | null {
  const pts = points.filter(p => p.kind === kind && Number.isFinite(p.value) && !Number.isNaN(Date.parse(p.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (pts.length === 0) return null;
  const latest = pts[pts.length - 1]!; const earlier = pts.slice(0, -1);
  const values = pts.map(p => p.value);
  let direction: Direction = 'single';
  if (earlier.length > 0) {
    const mean = earlier.reduce((s, p) => s + p.value, 0) / earlier.length;
    const rel = mean === 0 ? (latest.value === 0 ? 0 : 1) : Math.abs(latest.value - mean) / Math.abs(mean);
    direction = rel < STEADY_BELOW ? 'steady' : latest.value > mean ? 'higher' : 'lower';
  }
  return { kind, unit: latest.unit, n: pts.length, latest, previous: earlier[earlier.length - 1] ?? null, min: Math.min(...values), max: Math.max(...values), direction, points: pts };
}

export const DIRECTION_TEXT: Record<Direction, string> = {
  higher: 'Higher than the average of the earlier readings', lower: 'Lower than the average of the earlier readings',
  steady: 'About the same as the earlier readings', single: 'Only one reading so far',
};

export const TREND_KINDS: { kind: string; label: string; unit: string }[] = [
  { kind: 'bp_systolic_mmhg', label: 'Blood pressure, top number', unit: 'mmHg' },
  { kind: 'bp_diastolic_mmhg', label: 'Blood pressure, bottom number', unit: 'mmHg' },
  { kind: 'blood_glucose_mgdl', label: 'Blood sugar', unit: 'mg/dL' },
];
