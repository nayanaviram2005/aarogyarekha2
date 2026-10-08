import { describe, expect, it } from 'vitest';
import { DIRECTION_TEXT, STEADY_BELOW, summarizeTrend, type TrendPoint } from './trends';

const p = (value: number, day: number, kind = 'bp_systolic_mmhg'): TrendPoint => ({ kind, value, unit: 'mm[Hg]', at: `2026-09-${String(day).padStart(2, '0')}T08:00:00Z` });

describe('summarizeTrend', () => {
  it('no readings of that kind gives nothing', () => { expect(summarizeTrend([p(1, 1, 'pulse_bpm')], 'bp_systolic_mmhg')).toBeNull(); expect(summarizeTrend([], 'x')).toBeNull(); });
  it('one reading is "single"', () => { const s = summarizeTrend([p(140, 1)], 'bp_systolic_mmhg')!; expect(s).toMatchObject({ n: 1, direction: 'single', previous: null, min: 140, max: 140 }); });
  it('compares the latest with the AVERAGE of the earlier ones, whatever order they arrive in', () => {
    const s = summarizeTrend([p(160, 5), p(120, 1), p(130, 2), p(140, 3)], 'bp_systolic_mmhg')!;     // earlier mean 130, latest 160
    expect(s.latest.value).toBe(160); expect(s.previous!.value).toBe(140); expect(s.direction).toBe('higher'); expect(s.min).toBe(120); expect(s.max).toBe(160); expect(s.points.map(x => x.value)).toEqual([120, 130, 140, 160]);
  });
  it('lower and steady', () => {
    expect(summarizeTrend([p(150, 1), p(150, 2), p(120, 3)], 'bp_systolic_mmhg')!.direction).toBe('lower');
    expect(summarizeTrend([p(150, 1), p(152, 2), p(151, 3)], 'bp_systolic_mmhg')!.direction).toBe('steady');
  });
  it('the steady band is exactly the stated share', () => {
    const base = 100; const just = base * (1 + STEADY_BELOW - 0.001); const over = base * (1 + STEADY_BELOW + 0.001);
    expect(summarizeTrend([p(base, 1), p(just, 2)], 'bp_systolic_mmhg')!.direction).toBe('steady'); expect(summarizeTrend([p(base, 1), p(over, 2)], 'bp_systolic_mmhg')!.direction).toBe('higher');
  });
  it('ignores broken times and non-numbers; zero averages do not divide by zero', () => {
    expect(summarizeTrend([{ ...p(1, 1), at: 'junk' }, { ...p(NaN, 2) }], 'bp_systolic_mmhg')).toBeNull();
    expect(summarizeTrend([p(0, 1), p(0, 2)], 'bp_systolic_mmhg')!.direction).toBe('steady'); expect(summarizeTrend([p(0, 1), p(5, 2)], 'bp_systolic_mmhg')!.direction).toBe('higher');
  });
  it('never uses words that judge the reading', () => { for (const t of Object.values(DIRECTION_TEXT)) expect(t).not.toMatch(/control|worse|better|normal|abnormal|improv|deteriorat|good|bad|danger/i); });
});
