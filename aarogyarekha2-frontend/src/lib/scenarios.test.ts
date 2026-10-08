import { describe, expect, it } from 'vitest';
import { clusterSignal, CLUSTER_RULE, summarizeScenario } from './scenarios';
import type { QueueEntry } from './types';

const NOW = new Date('2026-10-07T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const e = (over: Partial<QueueEntry> = {}): QueueEntry => ({ encounterId: Math.random().toString(), patient: {} as never, scenario: 'campus_fever', chiefComplaint: null, chiefComplaintTranslated: null, assessed: true, urgencyCode: 'yellow', tier: 3, potentialTier: null, missingCount: 0, winningLabel: null, vulnerable: false, queueStatus: 'waiting', waitingSince: hoursAgo(2), assessmentVersion: 1, engineTier: 3, reviewed: false, ...over });

describe('summarizeScenario', () => {
  it('counts only the chosen scenario, split by priority, with unassessed kept apart', () => {
    const s = summarizeScenario([e({ tier: 1 }), e({ tier: 3 }), e({ tier: 3 }), e({ assessed: false, tier: null }), e({ scenario: 'occupational', tier: 1 })], 'campus_fever');
    expect(s).toMatchObject({ total: 4, byTier: { 1: 1, 2: 0, 3: 2, 4: 0 }, notAssessed: 1 });
  });
  it('an assessed row with a missing or odd tier counts as not assessed, never silently dropped', () => {
    expect(summarizeScenario([e({ tier: null }), e({ tier: 9 as never })], 'campus_fever')).toMatchObject({ total: 2, notAssessed: 2 });
  });
  it('finds the longest wait and ignores broken dates', () => {
    expect(summarizeScenario([e({ waitingSince: hoursAgo(1) }), e({ waitingSince: hoursAgo(30) }), e({ waitingSince: 'junk' }), e({ waitingSince: null })], 'campus_fever').oldestWaitingSince).toBe(hoursAgo(30));
  });
  it('an empty scenario is all zeros', () => {
    expect(summarizeScenario([], 'health_camp')).toEqual({ scenario: 'health_camp', total: 0, byTier: { 1: 0, 2: 0, 3: 0, 4: 0 }, notAssessed: 0, oldestWaitingSince: null });
  });
});

describe('clusterSignal', () => {
  const many = (n: number, h = 5, scenario = 'campus_fever') => Array.from({ length: n }, () => e({ waitingSince: hoursAgo(h), scenario }));
  it('is flagged exactly at the threshold and not one below', () => {
    expect(clusterSignal(many(CLUSTER_RULE.threshold), 'campus_fever', NOW).flagged).toBe(true);
    expect(clusterSignal(many(CLUSTER_RULE.threshold - 1), 'campus_fever', NOW)).toMatchObject({ count: CLUSTER_RULE.threshold - 1, flagged: false });
  });
  it('only counts visits inside the time window', () => {
    const rows = [...many(3, 10), ...many(4, 100)];
    expect(clusterSignal(rows, 'campus_fever', NOW).count).toBe(3);
    expect(clusterSignal([e({ waitingSince: hoursAgo(72) }), e({ waitingSince: hoursAgo(72.5) })], 'campus_fever', NOW).count).toBe(1);
  });
  it('ignores other scenarios, future or broken times', () => {
    expect(clusterSignal([...many(6, 5, 'occupational'), e({ waitingSince: hoursAgo(-5) }), e({ waitingSince: 'junk' }), e({ waitingSince: null })], 'campus_fever', NOW).count).toBe(0);
  });
  it('takes a custom rule', () => {
    expect(clusterSignal(many(2), 'campus_fever', NOW, { windowHours: 24, threshold: 2 }).flagged).toBe(true);
  });
  it('the shipped rule is marked as not validated', () => { expect(CLUSTER_RULE.validated).toBe(false); });
});
