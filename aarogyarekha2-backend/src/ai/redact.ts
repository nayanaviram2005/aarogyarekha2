// PII redaction. Nothing reaches an outside AI service unless it has passed through here AND assertClean() agrees.
//
// Two layers: (1) NAMED redaction: the names and identifiers we already hold for this patient are removed wherever they appear,
// in any script. (2) PATTERN redaction: phone numbers, emails, Aadhaar/ABHA-shaped numbers, PIN codes, dates, URLs and "Dr X" /
// "Mr X" style names are removed even if we do not know them. This is a safety net, not a guarantee: free text can always
// contain something no pattern recognises, which is why external AI also needs the patient's consent and every call is logged.

export type Kind = 'name' | 'email' | 'url' | 'id' | 'phone' | 'pin' | 'date';
export interface Redacted { text: string; counts: Partial<Record<Kind, number>>; names: Map<string, string> }

const PATTERNS: [Kind, RegExp, string][] = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  ['url', /\bhttps?:\/\/\S+|\bwww\.\S+/gi, '[URL]'],
  ['id', /\b\d{2}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b|\b\d{14}\b/g, '[ID]'],                    // ABHA number
  ['id', /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[ID]'],                                        // Aadhaar shape
  ['phone', /(?<!\d)(?:(?:\+?91|0)[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, '[PHONE]'],           // also with a leading 0 or 91 or +91
  ['date', /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4}\b/gi, '[DATE]'],
  ['pin', /\b[1-9]\d{5}\b/g, '[PIN]'],
];
// "Dr. Mehta", "Mr Rao", "Smt. Devi": the title and the next one or two capitalised words.
const TITLED = /\b(?:Dr|Mr|Mrs|Ms|Miss|Shri|Smt|Sri|Kumari|Prof)\.?\s+[A-Zऀ-ॿ଀-୿][\p{L}\p{M}'.-]*(?:\s+[A-Zऀ-ॿ଀-୿][\p{L}\p{M}'.-]*)?/gu;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bump = (c: Redacted['counts'], k: Kind, n: number) => { if (n) c[k] = (c[k] ?? 0) + n; };

/** Split a person's full name into the whole name and each part of 2+ characters, longest first so "Anita Rao" goes before "Anita". */
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

  // (1) names and identifiers we hold. Unicode-aware boundaries so Hindi and Odia names work.
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

  // (2) shapes we recognise even when we do not know the value.
  let titled = 0;
  text = text.replace(TITLED, () => { titled++; return '[PERSON]'; });
  bump(counts, 'name', titled);
  for (const [kind, re, rep] of PATTERNS) { let k = 0; text = text.replace(re, () => { k++; return rep; }); bump(counts, kind, k); }
  return { text, counts, names };
}

/** Put the patient's own names back into text that came back from a service (placeholders must survive verbatim). */
export function restore(text: string, names: Map<string, string>): string {
  let out = text; for (const [tok, original] of names) out = out.split(tok).join(original); return out;
}

export class PiiLeak extends Error {
  constructor(public readonly why: string) { super('Text was blocked from leaving because it may contain personal details.'); this.name = 'PiiLeak'; }
}

/** The last gate before an outside call. Throws if any KNOWN detail, or any recognised pattern, is still in the text. */
export function assertClean(text: string, known: { names?: (string | null | undefined)[]; identifiers?: (string | null | undefined)[] } = {}): string {
  for (const v of [...nameVariants(known.names ?? []), ...(known.identifiers ?? []).filter((x): x is string => !!x?.trim()).map(x => x.trim())]) {
    if (new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{M}\\p{N}])`, 'iu').test(text)) throw new PiiLeak('known detail present');
  }
  for (const [kind, re] of PATTERNS) { re.lastIndex = 0; if (re.test(text)) throw new PiiLeak(`${kind} pattern present`); re.lastIndex = 0; }
  TITLED.lastIndex = 0; if (TITLED.test(text)) throw new PiiLeak('titled name present'); TITLED.lastIndex = 0;
  return text;
}
