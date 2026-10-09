import { describe, expect, it } from 'vitest';
import { AGING, explainOrder, sortQueue } from '../src/queue/sort.js';

const NOW = new Date('2026-10-07T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
let n = 0;
const e = (tier: number | null, waitMin: number, over: Partial<{ vulnerable: boolean }> = {}) => ({ id: `e${++n}`, assessed: tier !== null, tier, vulnerable: false, waitingSince: ago(waitMin), ...over });
const why = (list: ReturnType<typeof e>[]) => explainOrder(sortQueue(list, 3, NOW), 3, NOW);

describe('why the queue is in this order', () => {
  it('the first patient is first, and every other row says why it is behind the one above', () => {
    const r = why([e(3, 10), e(1, 5), e(3, 40)]);
    expect(r.map(x => [x.position, x.why])).toEqual([[1, 'first'], [2, 'tier'], [3, 'wait']]);
    expect(r.every(x => x.of === 3)).toBe(true);
  });
  it('a lower priority level is behind because of the level', () => {
    expect(why([e(1, 1), e(2, 90), e(4, 300)]).map(x => x.why)).toEqual(['first', 'tier', 'tier']);
  });
  it('at the same level, a patient who is not assessed yet goes first, and the assessed one says so', () => {
    const r = why([e(3, 30), e(null, 5)]);
    expect(r[0]!.why).toBe('first'); expect(r[1]!.why).toBe('unassessed');
  });
  it('at the same level, a vulnerable patient goes ahead of a longer-waiting one', () => {
    const r = why([e(2, 90), e(2, 10, { vulnerable: true })]);
    expect(r[0]!.why).toBe('first'); expect(r[1]!.why).toBe('vulnerable');
  });
  it('at the same level and vulnerability, the longest wait goes first', () => {
    const r = why([e(2, 10), e(2, 90)]);
    expect(r[1]!.why).toBe('wait'); expect(r[0]!.waitedMin).toBe(90);
  });
  it('a routine patient moved up after the limit is marked as promoted, with how long they waited', () => {
    const r = why([e(3, 20), e(4, AGING.promoteRoutineAfterMin + 10)]);
    const aged = r.find(x => x.promoted)!;
    expect(aged.effectiveTier).toBe(3); expect(aged.waitedMin).toBe(AGING.promoteRoutineAfterMin + 10);
    expect(r.filter(x => x.promoted)).toHaveLength(1);
  });
  it('an empty queue explains nothing', () => { expect(explainOrder([], 3, NOW)).toEqual([]); });
});
