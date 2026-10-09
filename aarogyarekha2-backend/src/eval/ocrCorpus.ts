import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseLabText } from '../ocr/labParser.js';
import { pdfTextEngine } from '../ocr/engines.js';

export interface Truth { name: string; value: number; unit: string; flag: 'low' | 'high' | null }
export interface SynthReport { id: string; layout: string; lines: string[]; truth: Truth[] }

const TESTS: { name: string; printed: string[]; unit: string; lo: number; hi: number; dec: number; scale?: number }[] = [
  { name: 'haemoglobin', printed: ['Haemoglobin', 'Hemoglobin', 'Hb'], unit: 'g/dL', lo: 12, hi: 15.5, dec: 1 },
  { name: 'wbc_count', printed: ['Total WBC Count', 'WBC', 'TLC'], unit: '/cumm', lo: 4000, hi: 11000, dec: 0 },
  { name: 'platelet_count', printed: ['Platelet Count', 'Platelets'], unit: 'lakh/cumm', lo: 1.5, hi: 4.5, dec: 1 },
  { name: 'esr', printed: ['ESR'], unit: 'mm/hr', lo: 0, hi: 20, dec: 0 },
  { name: 'creatinine', printed: ['Creatinine', 'Serum Creatinine'], unit: 'mg/dL', lo: 0.6, hi: 1.3, dec: 1 },
  { name: 'urea', printed: ['Blood Urea', 'Urea'], unit: 'mg/dL', lo: 15, hi: 40, dec: 0 },
  { name: 'sodium', printed: ['Sodium'], unit: 'mmol/L', lo: 135, hi: 145, dec: 0 },
  { name: 'potassium', printed: ['Potassium'], unit: 'mmol/L', lo: 3.5, hi: 5.1, dec: 1 },
  { name: 'bilirubin_total', printed: ['Bilirubin Total', 'Total Bilirubin'], unit: 'mg/dL', lo: 0.3, hi: 1.2, dec: 1 },
  { name: 'alt_sgpt', printed: ['SGPT', 'ALT'], unit: 'U/L', lo: 7, hi: 56, dec: 0 },
  { name: 'cholesterol_total', printed: ['Total Cholesterol', 'Cholesterol'], unit: 'mg/dL', lo: 125, hi: 200, dec: 0 },
  { name: 'triglycerides', printed: ['Triglycerides'], unit: 'mg/dL', lo: 50, hi: 150, dec: 0 },
  { name: 'glucose_fasting', printed: ['Fasting Blood Glucose', 'FBS', 'Fasting Blood Sugar'], unit: 'mg/dL', lo: 70, hi: 100, dec: 0 },
  { name: 'hba1c', printed: ['HbA1c', 'Glycosylated Haemoglobin'], unit: '%', lo: 4, hi: 5.6, dec: 1 },
  { name: 'tsh', printed: ['TSH'], unit: 'uIU/mL', lo: 0.4, hi: 4.2, dec: 2 },
];

let seed = 1; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
const fmt = (n: number, dec: number, comma: boolean) => { const s = n.toFixed(dec); return comma && dec === 0 && n >= 1000 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s; };

const LAYOUTS: { id: string; make: (p: { name: string; v: string; unit: string; range: string; flag: string }) => string }[] = [
  { id: 'columns', make: p => `${p.name}   ${p.v}   ${p.unit}   ${p.range}   ${p.flag}`.trim() },
  { id: 'single-space', make: p => `${p.name} ${p.v} ${p.unit} ${p.range} ${p.flag}`.trim() },
  { id: 'colon', make: p => `${p.name}: ${p.v} ${p.unit} ${p.range} ${p.flag}`.trim() },
  { id: 'bracket-range', make: p => `${p.name}  ${p.v}  ${p.unit}  (${p.range})  ${p.flag}`.trim() },
];
const FLAG_WORDS: Record<'low' | 'high', string[]> = { low: ['L', 'Low'], high: ['H', 'High'] };

export function makeCorpus(n: number, s = 1): SynthReport[] {
  seed = s; const out: SynthReport[] = [];
  for (let r = 0; r < n; r++) {
    const layout = LAYOUTS[r % LAYOUTS.length]!; const count = 6 + Math.floor(rnd() * 5);
    const chosen = [...TESTS].sort(() => rnd() - 0.5).slice(0, count); const lines = ['CITY DIAGNOSTIC LAB (SYNTHETIC)', 'Patient Name: Test Patient   Age: 41 Y   Sex: F', 'Sample collected: 12/03/2026', 'TEST RESULTS'];
    const truth: Truth[] = [];
    for (const t of chosen) {
      const roll = rnd(); const span = t.hi - t.lo; const flag: Truth['flag'] = roll < 0.2 ? 'low' : roll < 0.4 ? 'high' : null;
      const value = flag === 'low' ? t.lo - span * (0.1 + rnd() * 0.3) : flag === 'high' ? t.hi + span * (0.1 + rnd() * 0.5) : t.lo + span * (0.15 + rnd() * 0.7);
      const v = Math.max(0, Number(value.toFixed(t.dec)));
      const printedName = pick(t.printed); const comma = rnd() < 0.5;
      lines.push(layout.make({ name: printedName, v: fmt(v, t.dec, comma), unit: t.unit, range: `${fmt(t.lo, t.dec, comma)} - ${fmt(t.hi, t.dec, comma)}`, flag: flag ? pick(FLAG_WORDS[flag]) : '' }));
      truth.push({ name: t.name, value: v, unit: t.unit, flag });
    }
    lines.push('*** End of report ***', 'Page 1 of 1');
    out.push({ id: `R${String(r + 1).padStart(3, '0')}`, layout: layout.id, lines, truth });
  }
  return out;
}

export async function toPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); let page = doc.addPage([595, 842]); let y = 800;
  for (const l of lines) { if (y < 60) { page = doc.addPage([595, 842]); y = 800; } page.drawText(l, { x: 40, y, size: 10, font }); y -= 16; }
  return Buffer.from(await doc.save());
}

export interface Score { reports: number; expected: number; found: number; valueCorrect: number; unitCorrect: number; flagCorrect: number; extra: number; byLayout: Record<string, { expected: number; valueCorrect: number }> }

export async function scoreCorpus(corpus: SynthReport[]): Promise<Score> {
  const engine = pdfTextEngine(); const sc: Score = { reports: corpus.length, expected: 0, found: 0, valueCorrect: 0, unitCorrect: 0, flagCorrect: 0, extra: 0, byLayout: {} };
  for (const rep of corpus) {
    const pdf = await toPdf(rep.lines); const read = await engine({ bytes: pdf, mime: 'application/pdf' }); const parsed = parseLabText(read.text, read.confidence).fields;
    const by = new Map(parsed.map(f => [f.fieldName, f])); const g = (sc.byLayout[rep.layout] ??= { expected: 0, valueCorrect: 0 });
    for (const t of rep.truth) {
      sc.expected++; g.expected++; const f = by.get(t.name); if (!f) continue;
      sc.found++; if (f.valueNum !== null && Math.abs(f.valueNum - t.value) < 1e-9) { sc.valueCorrect++; g.valueCorrect++; }
      if (f.unit && f.unit.toLowerCase() === t.unit.toLowerCase()) sc.unitCorrect++;
      if ((f.printedFlag ?? null) === t.flag) sc.flagCorrect++;
    }
    sc.extra += parsed.filter(f => !rep.truth.some(t => t.name === f.fieldName)).length;
  }
  return sc;
}

export const rate = (a: number, b: number) => (b === 0 ? 0 : a / b);
