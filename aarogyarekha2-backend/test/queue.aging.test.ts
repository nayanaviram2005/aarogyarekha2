import { describe, expect, it } from 'vitest';
import { AGING, isWaitingLong, sortQueue } from '../src/queue/sort.js';

const NOW = new Date('2026-10-07T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
let n = 0;
const e = (tier: number | null, waitMin: number, over: Partial<{ assessed: boolean; vulnerable: boolean }> = {}) => ({ id: `e${++n}`, assessed: tier !== null, tier, vulnerable: false, waitingSince: ago(waitMin), ...over });
const ids = (xs: { id: string }[]) => xs.map(x => x.id);

describe('fairness guard', () => {
  it('a routine patient who waited the limit is ordered with tier 3, behind older tier 3 and ahead of newer tier 3', () => {
    const oldT3 = e(3, 200), newT3 = e(3, 10), agedT4 = e(4, AGING.promoteRoutineAfterMin + 5);
    expect(ids(sortQueue([newT3, agedT4, oldT3], 3, NOW))).toEqual([oldT3.id, agedT4.id, newT3.id]);
  });
  it('a routine patient just under the limit stays behind every tier 3', () => {
    const t3 = e(3, 1), t4 = e(4, AGING.promoteRoutineAfterMin - 1);
    expect(ids(sortQueue([t4, t3], 3, NOW))).toEqual([t3.id, t4.id]);
  });
  it('waiting NEVER moves anyone into tier 2 or 1: an old tier 3 stays behind a brand new tier 2 and tier 1', () => {
    const old3 = e(3, 600), new2 = e(2, 1), new1 = e(1, 0);
    expect(ids(sortQueue([old3, new2, new1], 3, NOW))).toEqual([new1.id, new2.id, old3.id]);
  });
  it('an old routine patient never outranks a tier 2 or 1 either', () => {
    const old4 = e(4, 5000), new2 = e(2, 1);
    expect(ids(sortQueue([old4, new2], 3, NOW))).toEqual([new2.id, old4.id]);
  });
  it('unassessed patients are unaffected by the guard and still sort as tier 3', () => {
    const un = e(null, 1), t4 = e(4, 1000);
    expect(ids(sortQueue([t4, un], 3, NOW))).toEqual([un.id, t4.id]);   // unassessed before the aged routine one (same effective tier, unassessed first)
  });
  it('broken or missing wait times do not promote or crash', () => {
    const a = { ...e(4, 0), waitingSince: 'junk' }, b = { ...e(4, 0), waitingSince: null };
    expect(sortQueue([a, b], 3, NOW)).toHaveLength(2); expect(isWaitingLong(a, NOW)).toBe(false);
  });
  it('a wait time in the future counts as no wait', () => {
    expect(isWaitingLong({ assessed: true, tier: 4, vulnerable: false, waitingSince: ago(-500) }, NOW)).toBe(false);
  });
  it('does not change the input array', () => {
    const xs = [e(4, 500), e(3, 1)]; const copy = [...xs]; sortQueue(xs, 3, NOW); expect(xs).toEqual(copy);
  });
});

describe('waiting-long flag', () => {
  it('flags tier 3 from 90 minutes and tier 4 from 180, and nothing else', () => {
    expect(isWaitingLong(e(3, 89), NOW)).toBe(false); expect(isWaitingLong(e(3, 90), NOW)).toBe(true);
    expect(isWaitingLong(e(4, 179), NOW)).toBe(false); expect(isWaitingLong(e(4, 180), NOW)).toBe(true);
    expect(isWaitingLong(e(2, 9999), NOW)).toBe(false); expect(isWaitingLong(e(1, 9999), NOW)).toBe(false); expect(isWaitingLong(e(null, 9999), NOW)).toBe(false);
  });
  it('the minutes are marked as not validated', () => { expect(AGING.validated).toBe(false); });
});
