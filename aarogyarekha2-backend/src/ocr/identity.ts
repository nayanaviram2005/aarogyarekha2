export interface Identity { fullName?: string; sex?: 'female' | 'male' | 'other'; ageYears?: number; birthDate?: string; phone?: string }

const TITLE = /^(?:mrs|mr|ms|miss|smt|shri|sri|master|baby|b\/o|c\/o|w\/o|d\/o|s\/o|dr|mx)\b\.?\s*/i;
const SEX: Record<string, Identity['sex']> = { f: 'female', female: 'female', woman: 'female', m: 'male', male: 'male', man: 'male', o: 'other', other: 'other' };
const NOT_A_PERSON = /\b(lab|laborator\w*|diagnostic\w*|hospital|clinic|centre|center|pathology|path\s*lab|referr?ed|ref\.?\s*by|doctor|consultant|collected|reported|registered|received|sample|specimen|branch|address|insurance|bill|invoice)\b|\bdr\b\.?/i;
const LABEL = /(?:patient\s*'?s?\s*name|name\s*of\s*(?:the\s*)?patient|pt\.?\s*name|patient|name)\s*[:\-–]\s*/gi;
const NOT_THIS_NAME = /\b(hospital|lab|laborator\w*|doctor|dr|ref\w*|consultant|clinic|centre|center|sample|insurance|branch|file|user|company|test|report|panel)\s*$/i;
const STOP_WORDS = /\b(age|sex|gender|dob|date|ref|id|uhid|mrn|reg|mobile|mob|phone|contact|barcode|sample|lab|visit|bill|referred|doctor|dr|collected|reported|registered|received|printed|generated|time|specimen|branch|centre|center)\b.*$/i;

function cleanName(raw: string): string | undefined {
  let n = raw.replace(/\s{3,}.*$/, '').replace(/\([^)]*\)/g, ' ').replace(/[|\t].*$/, '');
  n = n.replace(STOP_WORDS, ' ').replace(/[^\p{L}\p{M} .'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) n = n.replace(TITLE, '').trim();
  n = n.replace(/^[.\-' ]+|[.\-' ]+$/g, '');
  if (n.length < 2 || n.length > 80 || !/\p{L}{2}/u.test(n)) return undefined;
  if (n.split(' ').length > 6) return undefined;
  return n;
}

function isoDate(d: number, m: number, y: number): string | undefined {
  if (y < 100) y += y > 30 ? 1900 : 2000;
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  if (t > Date.now() || y < 1900) return undefined;
  return dt.toISOString().slice(0, 10);
}

const sexOf = (s: string | undefined) => (s ? SEX[s.toLowerCase()] : undefined);
const years = (n: number, unit: string) => (unit.startsWith('m') ? n / 12 : unit.startsWith('d') || unit.startsWith('w') ? n / 365 : n);

export function parseIdentity(text: string): Identity {
  const out: Identity = {};
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/ /g, ' '));
  const t = lines.join('\n');

  names: for (const line of lines) {
    for (const m of line.matchAll(LABEL)) {
      if (NOT_THIS_NAME.test(line.slice(0, m.index))) continue;
      const n = cleanName(line.slice(m.index! + m[0].length)); if (n && !NOT_A_PERSON.test(n)) { out.fullName = n; break names; }
    }
  }

  let m: RegExpExecArray | null;
  if ((m = /\bage\s*(?:\/|and|&)\s*(?:sex|gender)\s*[:\-]?\s*((?:\d{1,3}\s*[a-z]{1,7}\.?\s*){1,4})\s*[\/,|-]?\s*(female|male|other|f|m)\b/i.exec(t))) {
    const first = /(\d{1,3})\s*([a-z]{1,7})/i.exec(m[1]!)!; const u = first[2]!.toLowerCase(); const n = Number(first[1]);
    out.ageYears = u.startsWith('y') ? n : Math.round(years(n, u) * 100) / 100; out.sex = sexOf(m[2]);
  }
  else if ((m = /\b([MF])\s*\/\s*(\d{1,3})\s*(?:y|yrs?|years?)\b/i.exec(t))) { out.sex = sexOf(m[1]); out.ageYears = Number(m[2]); }
  else if ((m = /\b(\d{1,3})\s*(?:y|yrs?|years?)\b\s*(?:[\/,|-]\s*)?(?:\d+\s*(?:m|mo|months?)\s*(?:[\/,|-]\s*)?)?(female|male|f|m)\b/i.exec(t))) { out.ageYears = Number(m[1]); out.sex = sexOf(m[2]); }
  else if ((m = /\bage\s*\/?\s*(?:sex|gender)?\s*[:\-]?\s*(\d{1,3})\s*(?:y|yrs?|years?)?\s*[\/,|-]\s*(female|male|f|m)\b/i.exec(t))) { out.ageYears = Number(m[1]); out.sex = sexOf(m[2]); }
  if (out.ageYears === undefined && (m = /\bage\b[^0-9\n]{0,12}(\d{1,3})\s*(y|yrs?|years?|m|mo|months?|d|days?|w|weeks?)?\b/i.exec(t))) {
    const n = Number(m[1]); const u = (m[2] ?? 'y').toLowerCase(); const yrs = years(n, u);
    if (yrs >= 0 && yrs <= 120) out.ageYears = u.startsWith('y') || !m[2] ? Math.floor(yrs) : Math.round(yrs * 100) / 100;
  }
  if (out.ageYears !== undefined && (out.ageYears < 0 || out.ageYears > 120)) delete out.ageYears;
  if (!out.sex && (m = /\b(?:sex|gender)\s*[:\-\/]?\s*(female|male|other|f|m|o)\b/i.exec(t))) out.sex = sexOf(m[1]);

  if ((m = /\b(?:dob|d\.o\.b\.?|date\s*of\s*birth|birth\s*date)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/i.exec(t))) { const d = isoDate(Number(m[1]), Number(m[2]), Number(m[3])); if (d) out.birthDate = d; }

  if ((m = /\b(?:mobile|mob|phone|contact|tel|cell)\s*(?:no\.?|number)?\s*[:\-]?\s*(\+?(?:91[\s-]?)?[6-9](?:[\s-]?\d){9})\b/i.exec(t))) out.phone = m[1]!.replace(/[\s-]/g, '');

  return out;
}
