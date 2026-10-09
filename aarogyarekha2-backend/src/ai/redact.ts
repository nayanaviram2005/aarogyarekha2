export type Kind = 'name' | 'email' | 'url' | 'id' | 'phone' | 'pin' | 'date';
export interface Redacted { text: string; counts: Partial<Record<Kind, number>>; names: Map<string, string> }

const PATTERNS: [Kind, RegExp, string][] = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  ['url', /\bhttps?:\/\/\S+|\bwww\.\S+/gi, '[URL]'],
  ['id', /\b\d{2}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b|\b\d{14}\b/g, '[ID]'],
  ['id', /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[ID]'],
  ['phone', /(?<!\d)(?:(?:\+?91|0)[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, '[PHONE]'],
  ['date', /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4}\b/gi, '[DATE]'],
  ['pin', /\b[1-9]\d{5}\b/g, '[PIN]'],
];
const TITLED = /\b(?:Dr|Mr|Mrs|Ms|Miss|Shri|Smt|Sri|Kumari|Prof)\.?\s+[A-Zऀ-ॿ଀-୿][\p{L}\p{M}'.-]*(?:\s+[A-Zऀ-ॿ଀-୿][\p{L}\p{M}'.-]*)?/gu;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bump = (c: Redacted['counts'], k: Kind, n: number) => { if (n) c[k] = (c[k] ?? 0) + n; };

export function nameVariants(names: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const n of names) {
    const t = n?.trim(); if (!t) continue;
    set.add(t); for (const part of t.split(/\s+/)) if ([...part].length >= 2) set.add(part);
  }
  return [...set].sort((a, b) => b.length - a.length);
}

export function redact(input: string, known: { names?: (string | null | undefined)[]; identifiers?: (string | null | undefined)[] } = {}): Redacted {
  let text = input; const counts: Redacted['counts'] = {}; const names = new Map<string, string>();

  let n = 0;
  for (const v of nameVariants(known.names ?? [])) {
    const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
    text = text.replace(re, m => { const tok = `[[NAME_${++n}]]`; names.set(tok, m); return tok; });
  }
  bump(counts, 'name', n);
  for (const id of (known.identifiers ?? [])) {
    const t = id?.trim(); if (!t) continue;
    const before = text; text = text.split(t).join('[ID]'); if (before !== text) bump(counts, 'id', 1);
  }

  let titled = 0;
  text = text.replace(TITLED, () => { titled++; return '[PERSON]'; });
  bump(counts, 'name', titled);
  for (const [kind, re, rep] of PATTERNS) { let k = 0; text = text.replace(re, () => { k++; return rep; }); bump(counts, kind, k); }
  return { text, counts, names };
}

export function restore(text: string, names: Map<string, string>): string {
  let out = text; for (const [tok, original] of names) out = out.split(tok).join(original); return out;
}

export class PiiLeak extends Error {
  constructor(public readonly why: string) { super('Text was blocked from leaving because it may contain personal details.'); this.name = 'PiiLeak'; }
}

export function assertClean(text: string, known: { names?: (string | null | undefined)[]; identifiers?: (string | null | undefined)[] } = {}): string {
  for (const v of [...nameVariants(known.names ?? []), ...(known.identifiers ?? []).filter((x): x is string => !!x?.trim()).map(x => x.trim())]) {
    if (new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{M}\\p{N}])`, 'iu').test(text)) throw new PiiLeak('known detail present');
  }
  for (const [kind, re] of PATTERNS) { re.lastIndex = 0; if (re.test(text)) throw new PiiLeak(`${kind} pattern present`); re.lastIndex = 0; }
  TITLED.lastIndex = 0; if (TITLED.test(text)) throw new PiiLeak('titled name present'); TITLED.lastIndex = 0;
  return text;
}
