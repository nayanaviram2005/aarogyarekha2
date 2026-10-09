import { describe, expect, it } from 'vitest';
import { whyText } from './queueWhy';
import type { QueueOrder } from './types';

const tier = (n: number) => ['', 'Immediate', 'Very urgent', 'Urgent', 'Routine'][n]!;
const o = (over: Partial<QueueOrder>): QueueOrder => ({ position: 2, of: 5, effectiveTier: 3, promoted: false, why: 'wait', waitedMin: 30, ...over });
const t = (order: QueueOrder | undefined, assessed = true, vulnerable = false) => whyText({ order, assessed, vulnerable }, tier);

describe('why-this-order text', () => {
  it('says nothing when the server sent no explanation', () => { expect(t(undefined)).toBeNull(); });
  it('names the level of the first patient, and whether they are not assessed or vulnerable', () => {
    expect(t(o({ position: 1, why: 'first', effectiveTier: 1 }))).toBe('#1: Immediate.');
    expect(t(o({ position: 1, why: 'first', effectiveTier: 3 }), false, true)).toBe('#1: Urgent, not assessed yet, young child, older adult or pregnant.');
  });
  it('explains each reason in terms of the patient above, by position', () => {
    expect(t(o({ why: 'tier' }))).toContain('Behind #1: that patient has a more urgent priority level.');
    expect(t(o({ position: 3, why: 'unassessed' }))).toContain('Behind #2: same level, and that patient is not assessed yet');
    expect(t(o({ why: 'vulnerable' }))).toContain('young child, older adult or pregnant');
    expect(t(o({ why: 'wait' }))).toContain('has waited longer');
  });
  it('mentions a routine patient who was moved up, with the wait', () => {
    expect(t(o({ promoted: true, waitedMin: 190 }))).toContain('Moved up from Routine after waiting 190 min.');
  });
});
