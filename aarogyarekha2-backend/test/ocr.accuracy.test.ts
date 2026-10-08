import { describe, expect, it } from 'vitest';
import { makeCorpus, rate, scoreCorpus, toPdf } from '../src/eval/ocrCorpus.js';

describe('synthetic corpus', () => {
  it('is reproducible for a seed, differs for another, and has known answers', () => {
    expect(makeCorpus(5, 7)).toEqual(makeCorpus(5, 7)); expect(makeCorpus(5, 7)).not.toEqual(makeCorpus(5, 8));
    for (const r of makeCorpus(20, 3)) { expect(r.truth.length).toBeGreaterThanOrEqual(6); expect(r.truth.length).toBeLessThanOrEqual(10); expect(new Set(r.truth.map(t => t.name)).size).toBe(r.truth.length); }
  });
  it('contains no real personal details: only the invented header', () => { expect(JSON.stringify(makeCorpus(10, 1))).not.toMatch(/@|\b\d{10}\b/); });
  it('uses every layout and includes low, high and unflagged results', () => {
    const c = makeCorpus(40, 1); expect(new Set(c.map(r => r.layout)).size).toBe(4); const flags = new Set(c.flatMap(r => r.truth.map(t => t.flag))); expect(flags).toEqual(new Set(['low', 'high', null]));
  });
  it('turns into a real PDF', async () => { const b = await toPdf(['hello']); expect(b.subarray(0, 5).toString()).toBe('%PDF-'); });
});

describe('reading accuracy on the synthetic corpus (text path)', () => {
  it('finds nearly every result and gets the number, unit and printed flag right', async () => {
    const s = await scoreCorpus(makeCorpus(40, 1));
    const recall = rate(s.found, s.expected), value = rate(s.valueCorrect, s.expected), unit = rate(s.unitCorrect, s.found), flag = rate(s.flagCorrect, s.found);
    // These floors are what the parser reaches today on invented, clean reports. They are NOT a promise for photos of real reports.
    expect(recall, `recall ${recall}`).toBeGreaterThanOrEqual(0.97); expect(value, `values ${value}`).toBeGreaterThanOrEqual(0.97); expect(unit, `units ${unit}`).toBeGreaterThanOrEqual(0.97); expect(flag, `flags ${flag}`).toBeGreaterThanOrEqual(0.95);
  }, 120_000);
  it('does not turn headers, dates or page numbers into results', async () => {
    const s = await scoreCorpus(makeCorpus(40, 2)); expect(rate(s.extra, s.reports)).toBeLessThanOrEqual(0.25);
  }, 120_000);
  it('every layout reads about equally well (none is left behind)', async () => {
    const s = await scoreCorpus(makeCorpus(40, 3)); for (const [l, g] of Object.entries(s.byLayout)) expect(rate(g.valueCorrect, g.expected), l).toBeGreaterThanOrEqual(0.9);
  }, 120_000);
});
