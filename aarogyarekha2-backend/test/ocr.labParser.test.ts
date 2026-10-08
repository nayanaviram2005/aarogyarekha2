import { describe, expect, it } from 'vitest';
import { canonicalTest, normalize, parseLabText, parseNumber } from '../src/ocr/labParser.js';

const one = (line: string, c: number | null = null) => parseLabText(line, c).fields[0];

describe('numbers and text normalisation', () => {
  it('reads Indian thousands grouping, decimal commas, and leaves ordinary decimals alone', () => {
    expect(parseNumber('11,200')).toBe(11200); expect(parseNumber('1,12,000')).toBe(112000); expect(parseNumber('9,1')).toBe(9.1); expect(parseNumber('9.1')).toBe(9.1); expect(parseNumber('<5')).toBe(5);
    expect(parseNumber('1.2.3')).toBeNull();
  });
  it('turns Devanagari and Odia digits into ASCII, and unicode dashes into hyphens', () => {
    expect(normalize('हीमोग्लोबिन १२.५ g/dL')).toBe('हीमोग्लोबिन 12.5 g/dL');
    expect(normalize('ହିମୋଗ୍ଲୋବିନ ୧୨')).toContain('12');
    expect(normalize('12.0 – 15.5')).toBe('12.0 - 15.5');
  });
});

describe('typical report lines', () => {
  it('table row with unit, range and a printed flag', () => {
    expect(one('Haemoglobin    9.1    g/dL    12.0 - 15.5    L')).toMatchObject({ fieldName: 'haemoglobin', valueNum: 9.1, unit: 'g/dL', referenceRangeText: '12.0 - 15.5', printedFlag: 'low' });
  });
  it('colon style with the range in brackets and a word flag', () => {
    expect(one('HAEMOGLOBIN (Hb) : 9.1 g/dL (12.0-15.5) LOW')).toMatchObject({ fieldName: 'haemoglobin', valueNum: 9.1, unit: 'g/dL', referenceRangeText: '(12.0-15.5)', printedFlag: 'low' });
  });
  it('count with thousands separator and a high flag', () => {
    expect(one('Total WBC Count 11,200 /cumm 4000-11000 H')).toMatchObject({ fieldName: 'wbc_count', valueNum: 11200, unit: '/cumm', printedFlag: 'high' });
  });
  it('no flag printed means no flag recorded (it never decides abnormality itself)', () => {
    expect(one('Fasting Blood Glucose 98 mg/dL 70 - 100')).toMatchObject({ fieldName: 'glucose_fasting', valueNum: 98, printedFlag: null });
    expect(one('Creatinine 4.8 mg/dL 0.6 - 1.2')).toMatchObject({ valueNum: 4.8, printedFlag: null });      // far outside the range, still not flagged by us
  });
  it('upper-limit only ranges, asterisk flag, and tests with no unit', () => {
    expect(one('Total Cholesterol 240 mg/dL < 200 *')).toMatchObject({ fieldName: 'cholesterol_total', referenceRangeText: '< 200', printedFlag: 'abnormal' });
    expect(one('ESR 38 mm/hr 0-20 H')).toMatchObject({ fieldName: 'esr', unit: 'mm/hr' });
    expect(one('HbA1c 6.9 %')).toMatchObject({ fieldName: 'hba1c', valueNum: 6.9, unit: '%' });
  });
  it('Hindi digits in values', () => {
    expect(one('Haemoglobin १०.४ g/dL 12.0 - 15.5')).toMatchObject({ valueNum: 10.4 });
  });
  it('keeps the full printed line so a person can compare it with the parsed values', () => {
    expect(one('Haemoglobin    9.1    g/dL    12.0 - 15.5    L')!.extractedValueText).toBe('Haemoglobin 9.1 g/dL 12.0 - 15.5 L');
  });
  it('an unknown test is kept only if it has both a unit and a printed range', () => {
    expect(one('Serum Ferritin 12 ng/mL 15 - 150 L')).toMatchObject({ fieldName: 'serum_ferritin', valueNum: 12, printedFlag: 'low' });
    expect(parseLabText('Serum Ferritin 12').fields).toHaveLength(0);
  });
});

describe('what must NOT be read as a result', () => {
  it.each([
    'Patient Name: Test Patient', 'Age: 27 Years', 'Sex: Female', 'Date: 06-10-2026', 'Ref. No 4471 mg', 'Mobile 9999900000', 'Page 1 of 2', 'Collected on 06/10/2026 09:30', 'Lab No 123456 units 1-5', 'Dr. Mehta 12345',
  ])('skips "%s"', line => { expect(parseLabText(line).fields).toHaveLength(0); });
  it('ignores blank and tiny lines, and counts lines it could not read', () => {
    const r = parseLabText('\n  \nx\nThis is a heading line with no numbers\nGlucose 98 mg/dL 70-100');
    expect(r.fields).toHaveLength(1); expect(r.skipped).toBeGreaterThan(0);
  });
});

describe('confidence', () => {
  it('is highest with unit and range, lower with a unit only, lowest with a value only', () => {
    const a = one('Haemoglobin 9.1 g/dL 12.0 - 15.5')!.confidence!; const b = one('Haemoglobin 9.1 g/dL')!.confidence!; const c = one('Haemoglobin 9.1')!.confidence!;
    expect(a).toBeGreaterThan(b); expect(b).toBeGreaterThan(c);
  });
  it('is scaled by how good the OCR was, so a blurry photo is never trusted like a clean text layer', () => {
    const clean = one('Haemoglobin 9.1 g/dL 12.0 - 15.5', 1)!.confidence!; const blurry = one('Haemoglobin 9.1 g/dL 12.0 - 15.5', 0.5)!.confidence!;
    expect(blurry).toBeCloseTo(clean / 2, 2);
  });
});

describe('test name matching', () => {
  it.each([
    ['Hemoglobin', 'haemoglobin'], ['Hb', 'haemoglobin'], ['HbA1c', 'hba1c'], ['Glycosylated Hemoglobin', 'hba1c'], ['TLC', 'wbc_count'], ['Platelet Count', 'platelet_count'],
    ['SGPT (ALT)', 'alt_sgpt'], ['SGOT', 'ast_sgot'], ['Bilirubin Total', 'bilirubin_total'], ['Bilirubin Direct', 'bilirubin_direct'], ['LDL Cholesterol', 'ldl'], ['Cholesterol', 'cholesterol_total'],
    ['RBS', 'glucose_random'], ['Fasting Sugar', 'glucose_fasting'], ['Blood Urea', 'urea'], ['SpO2', 'spo2'], ['Temp', 'temperature'], ['Pulse', 'pulse'],
  ])('%s -> %s', (printed, canonical) => { expect(canonicalTest(printed)).toBe(canonical); });
  it('does not match unrelated words', () => { expect(canonicalTest('Hbsag')).toBeNull(); expect(canonicalTest('Collection point')).toBeNull(); });
});

describe('a whole report', () => {
  const report = [
    'CITY DIAGNOSTIC LAB', 'Patient Name: Test Patient    Age: 27 Y    Sex: F', 'Date: 06/10/2026',
    'COMPLETE BLOOD COUNT', 'Test            Result   Unit      Reference     Flag',
    'Haemoglobin     9.1      g/dL      12.0 - 15.5   L', 'Total WBC Count  11,200   /cumm     4000 - 11000  H', 'Platelet Count   2.4      lakh/cumm 1.5 - 4.5',
    'ESR             38       mm/hr     0 - 20        H', 'Page 1 of 1',
  ].join('\n');
  it('reads the four results and nothing else', () => {
    const { fields } = parseLabText(report, 0.99);
    expect(fields.map(f => f.fieldName)).toEqual(['haemoglobin', 'wbc_count', 'platelet_count', 'esr']);
    expect(fields.map(f => f.printedFlag)).toEqual(['low', 'high', null, 'high']);
    expect(fields.every(f => (f.confidence ?? 0) > 0.8)).toBe(true);
  });
});

describe('plural and variant test names', () => {
  it('"Platelets" and "Leucocytes" are the same tests as "Platelet" and "Leucocyte"', () => {
    const f = parseLabText('Platelets 2.7 lakh/cumm 1.5 - 4.5\nLeucocytes 6,500 /cumm 4000 - 11000').fields;
    expect(f.map(x => x.fieldName)).toEqual(['platelet_count', 'wbc_count']); expect(f[0]!.valueNum).toBe(2.7); expect(f[1]!.valueNum).toBe(6500);
  });
});
