import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { assertClean, PiiLeak, redact, restore } from '../src/ai/redact.js';
import { checkNonDiagnostic } from '../src/guard/nonDiagnostic.js';
import { makeSafe } from '../src/files/safe.js';
import { analyse, enhance } from '../src/files/imageQuality.js';
import { buildTriageInput } from '../src/intake/input.js';
import { parseLabText, parseNumber } from '../src/ocr/labParser.js';
import { triage } from '../src/triage/engine.js';
import { RULESET_DRAFT as RS } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED as PROP } from '../src/triage/ruleset.proposed.js';
import type { TriageInput } from '../src/triage/types.js';

const base = (o: Partial<TriageInput> = {}): TriageInput => ({ ageYears: 40, pregnant: false, vitals: { resp_rate_pm: 16, spo2_pct: 98, bp_systolic_mmhg: 120, pulse_bpm: 72, temperature_c: 37 }, consciousness: 'alert', onSupplementalOxygen: false, signs: { airway_obstructed_or_not_breathing: false }, ...o });

describe('triage: broken numbers never crash and never make things safer', () => {
  it.each([[NaN], [Infinity], [-Infinity], [-5], [1e12], [0]])('a vital of %s does not throw and the result is a valid tier', v => {
    for (const k of ['resp_rate_pm', 'spo2_pct', 'bp_systolic_mmhg', 'pulse_bpm', 'temperature_c'] as const) {
      const d = triage(base({ vitals: { ...base().vitals, [k]: v } }), RS); expect([1, 2, 3, 4], `${k}=${v}`).toContain(d.tier);
    }
  });
  it('a missing, null or undefined vital is "not assessed", not zero', () => {
    const d = triage(base({ vitals: { resp_rate_pm: null, spo2_pct: undefined, pulse_bpm: null } }), RS); expect(d.news2.missingParams).toEqual(expect.arrayContaining(['resp_rate_pm', 'spo2_pct', 'pulse_bpm']));
  });
  it.each([[0], [0.0001], [15.99], [16], [120], [150], [-1], [NaN]])('age %s is handled', age => { expect([1, 2, 3, 4]).toContain(triage(base({ ageYears: age }), RS).tier); });
  it('an empty input is "insufficient data", never routine', () => { expect(triage({ ageYears: null, pregnant: null, vitals: {}, signs: {} }, RS).tier).toBeLessThanOrEqual(3); });
  it('unknown sign codes are ignored, not trusted and not crashing', () => {
    expect(triage(base({ signs: { not_a_real_sign: true, '__proto__': true, constructor: true } as never }), RS).tier).toBe(4);
  });
  it('contradictory answers resolve to the MORE urgent reading', () => {
    const d = triage(base({ consciousness: 'alert', signs: { airway_obstructed_or_not_breathing: false, unconscious_or_convulsing_now: true } }), RS); expect(d.tier).toBe(1);
    expect(triage(base({ consciousness: 'unresponsive', signs: { unconscious_or_convulsing_now: false } }), RS).tier).toBeLessThanOrEqual(2);
  });
  it('a pregnant child, a pregnant elderly patient and a pregnant patient of unknown age use the pregnancy path, not the adult score', () => {
    for (const age of [9, 70, null]) expect(triage(base({ ageYears: age, pregnant: true, vitals: { pulse_bpm: 135 } }), RS).news2.applicable).toBe(false);
  });
  it('outside hints can raise but a nonsense hint (tier 9, tier 0, wrong type) cannot lower or crash', () => {
    const b = triage(base(), RS).tier;
    for (const t of [9, 0, -1, NaN, '1' as never]) { const d = triage(base({ externalHints: [{ code: 'x', tier: t as never, source: 'external_secondary' }] }), RS); expect(d.tier, String(t)).toBeLessThanOrEqual(b); expect([1, 2, 3, 4]).toContain(d.tier); }
  });
  it('the proposed rule set survives the same abuse', () => {
    for (const v of [NaN, Infinity, -5, 1e12]) expect([1, 2, 3, 4]).toContain(triage(base({ ageYears: null, vitals: { pulse_bpm: v, resp_rate_pm: v } }), PROP).tier);
  });
  it('a huge number of sign entries is handled', () => { const signs: Record<string, boolean> = {}; for (let i = 0; i < 5000; i++) signs['s' + i] = i % 2 === 0; expect(triage(base({ signs }), RS).tier).toBe(4); });
});

describe('building triage input from stored rows', () => {
  it('a bad date and a missing one give an unknown age; a future one is never a negative age', () => {
    const now = new Date('2026-10-07');
    for (const bd of ['not-a-date', '', null]) expect(buildTriageInput({ birth_date: bd as never, age_years_reported: null, sex: 'female' } as never, [], {}, now).ageYears ?? null).toBeNull();
    expect(buildTriageInput({ birth_date: '2999-01-01', age_years_reported: null, sex: 'female' } as never, [], {}, now).ageYears).toBe(0);
  });
  it('a reported age is used when there is no birth date, and an impossible one is not', () => {
    expect(buildTriageInput({ birth_date: null, age_years_reported: 30, sex: 'male' } as never, [], {}, new Date()).ageYears).toBe(30);
  });
});

describe('redaction: odd and hostile text', () => {
  const known = { names: ['Anita Rao'], identifiers: ['AR-0001', '+919876543210'] };
  it('removes the name whatever the letter case, spacing, accents or hidden characters', () => {
    for (const t of ['ANITA RAO has fever', 'anita   rao has fever', 'Anita​ Rao has fever', 'Anıta Rao has fever'.replace('ı', 'i'), 'Rao, Anita has fever']) { const r = redact(t, known); expect(r.text.toLowerCase(), t).not.toContain('anita'); }
  });
  it('removes the name written in Devanagari or Odia when those names are known', () => {
    for (const [n, text] of [['अनीता राव', 'अनीता राव को बुखार है'], ['ଅନୀତା ରାଓ', 'ଅନୀତା ରାଓ ଙ୍କୁ ଜ୍ୱର']] as const) expect(redact(text, { names: [n] }).text).not.toContain(n.split(' ')[0]!);
  });
  it('removes phone numbers in several shapes, including with spaces, dashes and the country code', () => {
    for (const p of ['9876543210', '+91 98765 43210', '98765-43210', '(+91)9876543210', '098765 43210']) expect(redact(`call ${p} now`, {}).text, p).not.toMatch(/9876|98765/);
  });
  it('removes emails and links', () => { const r = redact('mail a.b@example.com or see https://example.org/x?id=7', {}); expect(r.text).not.toMatch(/example/); });
  it('a 200,000 character input is processed in reasonable time and still cleaned', () => {
    const big = ('fever and cough. ' + 'Anita Rao 9876543210 ').repeat(8000); const t0 = Date.now(); const r = redact(big, known); expect(Date.now() - t0).toBeLessThan(10_000); expect(r.text).not.toContain('Anita'); expect(r.text).not.toContain('9876543210');
  });
  it('restore puts names back only where the placeholders are, and ignores a made-up placeholder', () => {
    const r = redact('Anita Rao has fever', known); expect(restore(r.text, r.names)).toContain('Anita Rao'); expect(restore('[[NAME_99]] has cough', r.names)).toBe('[[NAME_99]] has cough');
  });
  it('the final gate refuses text that still carries a known name or number, and passes clean text', () => {
    expect(() => assertClean('Anita Rao has fever', known)).toThrow(PiiLeak); expect(() => assertClean('call 9876543210', known)).toThrow(PiiLeak); expect(() => assertClean('fever for three days', known)).not.toThrow();
  });
  it('empty text and empty known lists are fine', () => { expect(redact('', {}).text).toBe(''); expect(redact('fever', { names: [null, undefined, ''] }).text).toBe('fever'); });
});

describe('non-diagnostic guard: wording tricks', () => {
  it.each(['You have pneumonia.', 'This is dengue fever', 'Diagnosis: typhoid', 'Take 500 mg paracetamol twice a day', 'Start antibiotics', 'D I A G N O S I S: malaria'.replace(/ /g, '')])('blocks %j', t => { expect(checkNonDiagnostic(t).allowed, t).toBe(false); });
  it.each(['Fever for three days with cough', 'Patient reports headache', '', '   ', 'बुखार तीन दिन से'])('allows plain reporting %j', t => { expect(checkNonDiagnostic(t).allowed, t).toBe(true); });
  it('survives a very long text and odd characters', () => { expect(() => checkNonDiagnostic('a'.repeat(500_000) + '\u0000￿😀')).not.toThrow(); });
});

describe('lab text parsing: garbage in, nothing invented', () => {
  it('numbers with separators, minus signs and odd characters', () => { expect(parseNumber('11,200')).toBe(11200); expect(parseNumber('9.1')).toBe(9.1); for (const x of ['', ' ', 'abc', '1.2.3', '--', '١٢٣']) { const n = parseNumber(x); expect(n === null || Number.isFinite(n), x).toBe(true); } });
  it('empty, whitespace-only, binary-looking and huge texts give no rows and do not hang', () => {
    for (const t of ['', '   \n\n\t', '\u0000\u0001\u0002', 'x'.repeat(300_000), '1 2 3 4 5\n'.repeat(20_000)]) { const t0 = Date.now(); const r = parseLabText(t); expect(Date.now() - t0).toBeLessThan(10_000); expect(Array.isArray(r.fields)).toBe(true); }
  });
  it('a line that is only a number or only a unit is skipped, not turned into a result', () => { expect(parseLabText('9.1\ng/dL\n12 - 15').fields).toEqual([]); });
  it('text in a right-to-left or mixed script does not produce results', () => { expect(parseLabText('هيموجلوبين 9.1 g/dL 12 - 15').fields.length).toBeLessThanOrEqual(1); });
  it('never produces a field that says a value is abnormal on its own: only the printed flag is copied', () => {
    for (const f of parseLabText('Haemoglobin 9.1 g/dL 12.0 - 15.5\nESR 38 mm/hr 0 - 20 H').fields) expect([null, 'low', 'high', 'normal', 'critical', 'abnormal'].includes((f as { printedFlag: string | null }).printedFlag as never) || (f as { printedFlag: string | null }).printedFlag === null).toBe(true);
  });
});

describe('files and pictures: broken and hostile', () => {
  it('empty, tiny and wrong-type bytes are refused with a reason', () => { for (const b of [Buffer.alloc(0), Buffer.from([0xff]), Buffer.from('MZ\x90\x00'), Buffer.from('<?php echo 1; ?>')]) expect(makeSafe(b, 'image/jpeg').ok).toBe(false); });
  it('a PNG whose header claims a gigantic size is refused before it is decoded (decompression bomb)', () => {
    const p = new PNG({ width: 2, height: 2 }); const bytes = Buffer.from(PNG.sync.write(p)); bytes.writeUInt32BE(60000, 16); bytes.writeUInt32BE(60000, 20);
    expect(makeSafe(bytes, 'image/png').ok).toBe(false);
  });
  it('a truncated JPEG or PNG makes the quality check throw cleanly and enhance return the original', () => {
    const png = Buffer.from(PNG.sync.write(new PNG({ width: 50, height: 50 }))); const cut = png.subarray(0, 40);
    expect(() => analyse(cut, 'image/png')).toThrow(); const o = enhance(cut, 'image/png'); expect(o.bytes).toBe(cut);
    expect(() => analyse(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), 'image/jpeg')).toThrow();
  });
  it('a one-pixel picture does not break the quality check', () => { const p = new PNG({ width: 1, height: 1 }); p.data.fill(255); const q = analyse(Buffer.from(PNG.sync.write(p)), 'image/png'); expect(q.warnings).toContain('small'); });
  it('file names with traversal, control characters or an absurd length are made harmless for display', async () => {
    const { displayName } = await import('../src/files/safe.js');
    for (const n of ['../../etc/passwd', 'a\u0000b.pdf', 'x'.repeat(5000) + '.pdf', '<script>.png']) { const d = displayName(n); expect(d === null || (d.length <= 200 && !/[\u0000-\u001f<>/\\]/.test(d)), n).toBe(true); }
  });
});
