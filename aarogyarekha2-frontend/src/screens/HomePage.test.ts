import { describe, expect, it } from 'vitest';
import type { QueueEntry } from '../lib/types';
import { startHere } from './HomePage';

const e = (id: string, o: Partial<QueueEntry> = {}): QueueEntry => ({ encounterId: id, assessed: true, reviewed: false, tier: 2, queueStatus: 'waiting', patient: { full_name: id } as never, ...o }) as QueueEntry;

describe('startHere: what to do first at the triage desk', () => {
  it('a nurse or doctor is pointed at the most urgent patient waiting for sign-off', () => {
    const s = startHere([e('a', { reviewed: true }), e('b'), e('c')], true); expect(s.first?.encounterId).toBe('b'); expect(s.needsSignoff).toBe(2);
  });
  it('a health worker is pointed at someone not assessed yet, never at sign-off', () => {
    const s = startHere([e('a'), e('b', { assessed: false, tier: null })], false); expect(s.first?.encounterId).toBe('b'); expect(s.needsAssess).toBe(1);
  });
  it('with nothing to assess or sign, it points at the next signed-off patient in line', () => {
    expect(startHere([e('a', { reviewed: true }), e('b', { reviewed: true })], false).first?.encounterId).toBe('a');
  });
  it('patients already in review are not offered, and are counted separately', () => {
    const s = startHere([e('a', { queueStatus: 'in_review' }), e('b', { reviewed: true })], true); expect(s.first?.encounterId).toBe('b'); expect(s.inReview).toBe(1); expect(s.waiting).toBe(1);
  });
  it('an empty queue has nobody to open', () => { const s = startHere([], true); expect(s.first).toBeUndefined(); expect(s.waiting).toBe(0); });
  it('a reviewer with nothing to sign is pointed at someone not assessed', () => { expect(startHere([e('a', { reviewed: true }), e('b', { assessed: false })], true).first?.encounterId).toBe('b'); });
});
