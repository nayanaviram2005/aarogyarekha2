import { describe, expect, it } from 'vitest';
import { COMPRESS, fitWithin, shouldCompress } from './compress';
import { connectionSuggestsLowData, pollMs, readLowData } from './lowBandwidth';

const store = (v: string | null) => ({ getItem: () => v });

describe('low-data mode', () => {
  it('the person\'s choice wins over the connection', () => {
    expect(readLowData(store('1'), { effectiveType: '4g' })).toBe(true); expect(readLowData(store('0'), { saveData: true })).toBe(false);
  });
  it('with no choice it follows save-data and 2G-class connections only', () => {
    expect(readLowData(store(null), { saveData: true })).toBe(true); expect(readLowData(store(null), { effectiveType: '2g' })).toBe(true); expect(readLowData(store(null), { effectiveType: 'slow-2g' })).toBe(true);
    expect(readLowData(store(null), { effectiveType: '3g' })).toBe(false); expect(readLowData(store(null), { effectiveType: '4g' })).toBe(false); expect(readLowData(store(null), undefined)).toBe(false);
  });
  it('blocked storage does not break it', () => { expect(readLowData({ getItem: () => { throw new Error('blocked'); } }, { saveData: true })).toBe(true); expect(readLowData(null, null)).toBe(false); });
  it('connectionSuggestsLowData handles missing info', () => { expect(connectionSuggestsLowData(null)).toBe(false); expect(connectionSuggestsLowData({})).toBe(false); });
  it('refreshes less often in low-data mode', () => { expect(pollMs(true)).toBeGreaterThan(pollMs(false)); });
});

describe('compression rules', () => {
  const f = (type: string, size: number) => ({ type, size });
  it('only photos, and only when big enough: 2 MB normally, 300 KB in low-data mode', () => {
    expect(shouldCompress(f('image/jpeg', 3 * 1024 * 1024), false)).toBe(true); expect(shouldCompress(f('image/jpeg', 1024 * 1024), false)).toBe(false);
    expect(shouldCompress(f('image/png', 500 * 1024), true)).toBe(true); expect(shouldCompress(f('image/jpeg', 200 * 1024), true)).toBe(false);
  });
  it('never touches PDFs or unknown types', () => { expect(shouldCompress(f('application/pdf', 9e6), true)).toBe(false); expect(shouldCompress(f('image/gif', 9e6), true)).toBe(false); expect(shouldCompress(f('', 9e6), true)).toBe(false); });
  it('fitWithin keeps the shape, never enlarges, never returns zero', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 }); expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 }); expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 }); expect(fitWithin(0, 0, 100)).toEqual({ width: 1, height: 1 });
  });
  it('the limits are sensible', () => { expect(COMPRESS.maxSide).toBeGreaterThanOrEqual(1200); expect(COMPRESS.quality).toBeGreaterThan(0.5); expect(COMPRESS.quality).toBeLessThan(1); });
});
