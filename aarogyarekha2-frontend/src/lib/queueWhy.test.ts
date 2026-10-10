import { describe, expect, it } from 'vitest';
import { whyLines } from './queueWhy';
import type { QueueEntry, QueueOrder } from './types';

const tier = (n: number) => ['', 'Immediate', 'Very urgent', 'Urgent', 'Routine'][n]!;
const person = (name: string) => ({ id: name, public_ref: 'R', full_name: name, sex: 'female' as const, birth_date: null, age_years_reported: 30, preferred_language: 'en' });
type E = Parameters<typeof whyLines>[0];
const e = (name: string, o: Partial<QueueOrder> & { assessed?: boolean; vulnerable?: boolean; label?: string | null; tier?: number | null; potential?: number | null; missing?: number } = {}): E => ({
  patient: person(name), assessed: o.assessed ?? true, vulnerable: o.vulnerable ?? false, winningLabel: o.label === undefined ? null : o.label, tier: o.tier === undefined ? (o.effectiveTier ?? 3) : o.tier,
  potentialTier: o.potential ?? null, missingCount: o.missing ?? 0,
  order: { position: o.position ?? 1, of: o.of ?? 3, effectiveTier: o.effectiveTier ?? 3, promoted: o.promoted ?? false, why: o.why ?? 'wait', waitedMin: o.waitedMin ?? 30 } as QueueOrder,
});

describe('why-this-order lines', () => {
  it('says nothing when the server sent no explanation', () => { expect(whyLines({ ...e('A'), order: undefined }, null, null, tier)).toBeNull(); });

  it('names the level and the rule that set it, and compares with the patient below', () => {
    const a = e('Asha Rao', { effectiveTier: 1, label: 'Blue or grey lips or tongue', position: 1 }), b = e('Bina Das', { effectiveTier: 3, position: 2 });
    expect(whyLines(a, null, b, tier)).toEqual([
      '#1 of 3: Immediate, because blue or grey lips or tongue.',
      'Ahead of Bina Das (Urgent): Immediate comes before Urgent.',
    ]);
  });

  it('says why a patient is behind the one above when the level is lower', () => {
    const a = e('Asha Rao', { effectiveTier: 1, position: 1 }), b = e('Bina Das', { effectiveTier: 2, position: 2, label: 'Blood pressure in the severe range for pregnancy (as recorded)' });
    const l = whyLines(b, a, null, tier)!;
    expect(l[0]).toBe('#2 of 3: Very urgent, because blood pressure in the severe range for pregnancy (as recorded).');
    expect(l[1]).toBe('Behind Asha Rao (Immediate): Immediate comes before Very urgent.');
  });

  it('at the same level it names the actual tie-break: not assessed, young or old or pregnant, or the longer wait', () => {
    const na = e('Not Assessed', { assessed: false, effectiveTier: 3, position: 1 }), ass = e('Assessed', { effectiveTier: 3, position: 2 });
    expect(whyLines(ass, na, null, tier)![1]).toBe('Behind Not Assessed (Urgent), same level: Not Assessed is not assessed yet, and not-assessed patients go first.');
    const v = e('Young Child', { effectiveTier: 3, vulnerable: true, position: 1 }), nv = e('Adult', { effectiveTier: 3, position: 2 });
    expect(whyLines(nv, v, null, tier)![1]).toContain('Young Child is a young child, older adult or pregnant, and those patients go first');
    const long = e('Waited Long', { effectiveTier: 3, waitedMin: 95, position: 1 }), short = e('Waited Short', { effectiveTier: 3, waitedMin: 20, position: 2 });
    expect(whyLines(short, long, null, tier)![1]).toBe('Behind Waited Long (Urgent), same level: Waited Long has waited longer (95 min, against 20 min).');
    expect(whyLines(long, null, short, tier)![1]).toBe('Ahead of Waited Short (Urgent): Waited Long has waited longer (95 min, against 20 min).');
  });

  it('explains a patient who is not assessed yet, and a routine patient moved up after a long wait', () => {
    expect(whyLines(e('P', { assessed: false, effectiveTier: 3, position: 2 }), null, null, tier)![0]).toBe('#2 of 3: not assessed yet, so placed at Urgent until it is.');
    expect(whyLines(e('P', { effectiveTier: 3, tier: 4, promoted: true, waitedMin: 190, label: 'No urgency signal found in the information recorded so far' }), null, null, tier)![0]).toContain('Moved up from Routine after waiting 190 min.');
  });

  it('says what could move a patient up, once, when information is still missing', () => {
    expect(whyLines(e('P', { effectiveTier: 3, potential: 2, missing: 4 }), null, null, tier)!.at(-1)).toBe('Could move up to Very urgent if the 4 open questions are answered.');
    expect(whyLines(e('P', { effectiveTier: 3, potential: 2, missing: 1 }), null, null, tier)!.at(-1)).toBe('Could move up to Very urgent if the open question is answered.');
    expect(whyLines(e('P', { effectiveTier: 3 }), null, null, tier)!.some(x => x.startsWith('Could move up'))).toBe(false);
  });

  it('never mentions an AI', () => {
    const lines = whyLines(e('P', { effectiveTier: 2, label: 'Extended check of the case details' }), e('Q', { effectiveTier: 1, position: 1 }), e('R', { effectiveTier: 3 }), tier)!;
    expect(lines.join(' ')).not.toMatch(/\bAI\b|opinion/i);
  });
});

export type { QueueEntry };
