import type { ParsedField } from '../deps.js';

export function normalize(line: string): string {
  return line
    .replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x0966))
    .replace(/[୦-୯]/g, d => String(d.charCodeAt(0) - 0x0b66))
    .replace(/[‐-―−]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNumber(raw: string): number | null {
  const s = raw.replace(/^[<>]/, '');
  const n = /^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

const TESTS: [string, RegExp][] = [
  ['hba1c', /\b(hba1c|a1c|glycosylated|glycated)/], ['haemoglobin', /\b(h(a)?emoglobin|hb|hgb)\b/],
  ['wbc_count', /\b(total\s+)?(wbc|leuc?ocytes?|tlc)\b/], ['rbc_count', /\b(total\s+)?(rbc|red\s+blood)\b/], ['platelet_count', /\b(platelets?|plt)\b/],
  ['haematocrit', /\b(h(a)?ematocrit|pcv)\b/], ['mcv', /\bmcv\b/], ['mch', /\bmch\b(?!c)/], ['mchc', /\bmchc\b/], ['esr', /\besr\b/],
  ['glucose_fasting', /\b(fasting|fbs|f\.b\.s)\b.*\b(glucose|sugar)\b|\b(glucose|sugar)\b.*\b(fasting|fbs)\b|\bfbs\b/], ['glucose_random', /\b(random|rbs|ppbs|post\s*prandial|pp)\b.*\b(glucose|sugar)\b|\b(glucose|sugar)\b.*\b(random|rbs|pp)\b|\brbs\b|\bppbs\b/],
  ['glucose', /\b(blood\s+)?(glucose|sugar)\b/],
  ['creatinine', /\bcreatinine\b/], ['urea', /\b(blood\s+)?urea\b/], ['bun', /\bbun\b/],
  ['sodium', /\b(sodium|na\+?)\b/], ['potassium', /\b(potassium|k\+?)\b/],
  ['bilirubin_direct', /\bbilirubin\b.*\b(direct|conjugated)\b/], ['bilirubin_total', /\bbilirubin\b/],
  ['ast_sgot', /\b(sgot|ast|aspartate)\b/], ['alt_sgpt', /\b(sgpt|alt|alanine)\b/], ['alp', /\b(alkaline|alp)\b/],
  ['total_protein', /\btotal\s+protein\b/], ['albumin', /\balbumin\b/],
  ['hdl', /\bhdl\b/], ['ldl', /\bldl\b/], ['cholesterol_total', /\b(total\s+)?cholesterol\b/], ['triglycerides', /\btriglycerides?\b/],
  ['tsh', /\btsh\b/], ['temperature', /\btemp(erature)?\b/], ['pulse', /\b(pulse|heart\s+rate)\b/], ['spo2', /\b(spo2|oxygen\s+saturation)\b/],
];
export const VITAL_KIND: Record<string, string> = { temperature: 'temperature_c', pulse: 'pulse_bpm', spo2: 'spo2_pct' };

export const canonicalTest = (printed: string): string | null => {
  const s = printed.toLowerCase();
  for (const [name, re] of TESTS) if (re.test(s)) return name;
  return null;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'unnamed_test';

const FLAGS: [RegExp, NonNullable<ParsedField['printedFlag']>][] = [
  [/(^|\s)(h|high|hi|↑)(\s|$)/i, 'high'], [/(^|\s)(l|low|lo|↓)(\s|$)/i, 'low'],
  [/(^|\s)(a|abn|abnormal|\*+)(\s|$)/i, 'abnormal'], [/(^|\s)(n|nrm|normal)(\s|$)/i, 'normal'],
];

const LINE = /^(?<name>[A-Za-z][A-Za-z0-9 ().,/%'+-]{1,60}?)\s*[:=]?\s+(?<value>[<>]?\d+(?:[.,]\d+)*)\s*(?<unit>(?:\/?[A-Za-zµ%][A-Za-z0-9µ%.^*]*)(?:\/[A-Za-z0-9µ%.^*]+)?)?(?<rest>.*)$/;
const RANGE = /\(?\s*(?:[<>]\s*)?\d+(?:[.,]\d+)?\s*(?:-|to)\s*\d+(?:[.,]\d+)?\s*\)?|\(?\s*[<>]=?\s*\d+(?:[.,]\d+)?\s*\)?/i;
const SKIP = /\b(patient|name|age|sex|gender|date|dob|ref(erred)?|doctor|dr\.?|phone|mobile|tel|lab\s*no|sample|collected|reported|page|address|pin|id|barcode|registration)\b/i;

export interface ParseResult { fields: ParsedField[]; skipped: number }

export function parseLabText(text: string, ocrConfidence: number | null = null): ParseResult {
  const fields: ParsedField[] = []; let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = normalize(raw);
    if (line.length < 4) continue;
    const m = LINE.exec(line);
    if (!m?.groups) { skipped++; continue; }
    const printedName = m.groups.name!.replace(/[\s:.=-]+$/, '').trim();
    const canonical = canonicalTest(printedName);
    const unit = m.groups.unit && !/^(to|and|or|of|the)$/i.test(m.groups.unit) ? m.groups.unit : null;
    const rest = (m.groups.rest ?? '').trim();
    const range = RANGE.exec(rest)?.[0]?.trim() ?? null;
    if (!canonical && (!unit || !range || SKIP.test(printedName))) { skipped++; continue; }
    if (canonical && SKIP.test(printedName) && !unit) { skipped++; continue; }
    const value = parseNumber(m.groups.value!);
    if (value === null) { skipped++; continue; }
    const tail = range ? rest.replace(range, ' ') : rest;
    const printedFlag = FLAGS.find(([re]) => re.test(tail))?.[1] ?? null;
    const base = unit && range ? 0.92 : unit ? 0.8 : 0.6;
    fields.push({
      fieldName: canonical ?? slug(printedName),
      extractedValueText: line,
      valueNum: value, unit, referenceRangeText: range, printedFlag,
      confidence: Math.round(base * (ocrConfidence ?? 1) * 1000) / 1000,
    });
  }
  return { fields, skipped };
}
