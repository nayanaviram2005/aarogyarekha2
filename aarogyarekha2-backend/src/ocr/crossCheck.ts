// Puts the local reader's rows and the AI model's rows side by side.
//   agree     both read the same number for the same test
//   differ    both found the test but the numbers differ: the OCR row is kept, its confidence is capped, and what the AI read is stored
//             beside it so the person verifying sees both
//   ocr_only  the local reader found it, the AI did not
//   ai_only   only the AI found it (a person must check it against the report; it is a draft)
// Nothing here decides which one is right. A person verifies every row. Agreement is shown as extra evidence, never as a verdict.
import type { ParsedField } from '../deps.js';
import type { VisionRow } from '../ai/vision.js';
import { canonicalTest, parseNumber } from './labParser.js';

export const DIFFER_CONFIDENCE_CAP = 0.5;
export const AI_ONLY_CONFIDENCE = 0.5;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'unnamed_test';
const num = (s: string | null | undefined): number | null => { if (!s) return null; const m = s.replace(/\s/g, '').match(/^[<>]?-?\d[\d,]*\.?\d*$/); return m ? parseNumber(m[0]) : null; };
const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 0.001);

export function crossCheck(ocr: ParsedField[], vision: VisionRow[]): { fields: ParsedField[]; counts: Record<'agree' | 'differ' | 'ocr_only' | 'ai_only', number> } {
  const counts = { agree: 0, differ: 0, ocr_only: 0, ai_only: 0 };
  const byName = new Map<string, VisionRow[]>();
  for (const v of vision) { const k = canonicalTest(v.name) ?? slug(v.name); byName.set(k, [...(byName.get(k) ?? []), v]); }
  const used = new Set<VisionRow>();

  const fields: ParsedField[] = ocr.map(f => {
    const cands = byName.get(f.fieldName) ?? [];
    const mine = f.valueNum;
    const hit = cands.find(c => !used.has(c) && mine != null && num(c.value) != null && same(mine, num(c.value)!)) ?? cands.find(c => !used.has(c));
    if (!hit) { counts.ocr_only++; return { ...f, agreement: 'ocr_only', secondRead: null }; }
    used.add(hit);
    const theirs = num(hit.value);
    if (mine != null && theirs != null && same(mine, theirs)) { counts.agree++; return { ...f, agreement: 'agree', secondRead: hit.value }; }
    counts.differ++;
    return { ...f, confidence: Math.min(f.confidence ?? 1, DIFFER_CONFIDENCE_CAP), agreement: 'differ', secondRead: hit.value };
  });

  for (const [key, rows] of byName) for (const v of rows) {
    if (used.has(v)) continue;
    counts.ai_only++;
    const n = num(v.value);
    fields.push({
      fieldName: key, extractedValueText: `${v.name} ${v.value}${v.unit ? ' ' + v.unit : ''}`.slice(0, 200), valueNum: n, unit: v.unit, referenceRangeText: v.referenceRange, printedFlag: v.flag,
      confidence: AI_ONLY_CONFIDENCE, agreement: 'ai_only', secondRead: v.value,
    });
  }
  return { fields, counts };
}
