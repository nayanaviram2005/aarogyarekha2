import { describe, expect, it } from 'vitest';
import { applyQueueFilter, isFiltering, NO_FILTER, queueFacets, type QueueFilter } from './queueFilter';
import type { QueueEntry } from './types';

const NOW = new Date('2026-10-07T12:00:00Z');
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const e = (over: Partial<QueueEntry> & { lang?: string } = {}): QueueEntry => ({ encounterId: Math.random().toString(), patient: { id: 'p', public_ref: 'AR', full_name: 'x', sex: 'female', birth_date: null, age_years_reported: 20, preferred_language: over.lang ?? 'en' }, scenario: 'opd_queue', chiefComplaint: null, chiefComplaintTranslated: null, assessed: true, urgencyCode: 'yellow', tier: 3, potentialTier: null, missingCount: 0, winningLabel: null, vulnerable: false, queueStatus: 'waiting', waitingSince: ago(10), assessmentVersion: 1, engineTier: 3, reviewed: false, facilityId: 'f1', ...over });
const f = (o: Partial<QueueFilter>): QueueFilter => ({ ...NO_FILTER, ...o });

describe('applyQueueFilter', () => {
  const rows = [e({ tier: 1, scenario: 'campus_fever', lang: 'hi', waitingSince: ago(200) }), e({ tier: 3, facilityId: 'f2' }), e({ assessed: false, tier: null }), e({ tier: 4, lang: 'or', waitingSince: ago(60) })];
  it('no filter returns everything', () => { expect(applyQueueFilter(rows, NO_FILTER, NOW)).toHaveLength(4); expect(isFiltering(NO_FILTER)).toBe(false); });
  it('by risk, including "not assessed" as its own choice', () => {
    expect(applyQueueFilter(rows, f({ tiers: new Set([1]) }), NOW)).toHaveLength(1);
    expect(applyQueueFilter(rows, f({ tiers: new Set([3, 4]) }), NOW)).toHaveLength(2);
    expect(applyQueueFilter(rows, f({ tiers: new Set(['none']) }), NOW)).toHaveLength(1);
  });
  it('by scenario, language, facility', () => {
    expect(applyQueueFilter(rows, f({ scenario: 'campus_fever' }), NOW)).toHaveLength(1);
    expect(applyQueueFilter(rows, f({ language: 'or' }), NOW)).toHaveLength(1);
    expect(applyQueueFilter(rows, f({ facilityId: 'f2' }), NOW)).toHaveLength(1);
  });
  it('by minimum wait', () => {
    expect(applyQueueFilter(rows, f({ minWaitMinutes: 60 }), NOW)).toHaveLength(2); expect(applyQueueFilter(rows, f({ minWaitMinutes: 201 }), NOW)).toHaveLength(0);
  });
  it('combines filters with AND', () => { expect(applyQueueFilter(rows, f({ tiers: new Set([1]), language: 'hi', minWaitMinutes: 100 }), NOW)).toHaveLength(1); expect(applyQueueFilter(rows, f({ tiers: new Set([1]), language: 'or' }), NOW)).toHaveLength(0); });
  it('keeps the order it was given and never changes the input', () => {
    const out = applyQueueFilter(rows, f({ tiers: new Set([3, 4, 1]) }), NOW); expect(out.map(x => x.encounterId)).toEqual([rows[0]!, rows[1]!, rows[3]!].map(x => x.encounterId)); expect(rows).toHaveLength(4);
  });
  it('rows with a broken wait time count as no wait', () => { expect(applyQueueFilter([e({ waitingSince: 'junk' })], f({ minWaitMinutes: 1 }), NOW)).toHaveLength(0); });
  it('isFiltering is true for any active filter', () => { for (const o of [{ tiers: new Set<number | 'none'>([1]) }, { scenario: 'x' }, { language: 'hi' }, { facilityId: 'f' }, { minWaitMinutes: 5 }]) expect(isFiltering(f(o))).toBe(true); });
});

describe('queueFacets', () => { it('lists distinct values, sorted, ignoring missing facility ids', () => { expect(queueFacets([e({ lang: 'or' }), e({ lang: 'hi', facilityId: undefined }), e({ scenario: 'a' })])).toEqual({ scenarios: ['a', 'opd_queue'], languages: ['hi', 'or', 'en'].sort(), facilityIds: ['f1'] }); }); });
