// A printable PDF of a referral note, drawn from the frozen FHIR document (the same words the receiving facility sees).
// It adds nothing and removes nothing: each section's own text, the measurements, the notice, and the document's checksum.
// Hindi and Odia are drawn with embedded Noto fonts, run by run, so names in those scripts print correctly.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Bundle } from 'fhir/r4';

// The font library was built for older JavaScript and expects this helper to exist.
if (!(globalThis as { regeneratorRuntime?: unknown }).regeneratorRuntime) (globalThis as { regeneratorRuntime?: unknown }).regeneratorRuntime = createRequire(import.meta.url)('regenerator-runtime');

const FONT_DIR = join(import.meta.dirname, '..', '..', 'assets', 'fonts');
const load = (f: string) => readFileSync(join(FONT_DIR, f));

type Script = 'latin' | 'deva' | 'orya';
const scriptOf = (ch: string): Script => { const c = ch.codePointAt(0)!; return c >= 0x0900 && c <= 0x097f ? 'deva' : c >= 0x0b00 && c <= 0x0b7f ? 'orya' : 'latin'; };
/** Splits text into runs that each use one font. Spaces and punctuation stay with the run before them. */
export function runsOf(text: string): { text: string; script: Script }[] {
  const out: { text: string; script: Script }[] = []; let cur: Script | null = null;
  for (const ch of text) {
    const s: Script = /[\s\p{P}\p{N}]/u.test(ch) && cur ? cur : scriptOf(ch);
    if (out.length && s === cur) out[out.length - 1]!.text += ch; else { out.push({ text: ch, script: s }); cur = s; }
  }
  return out;
}

type Res = { resourceType: string; id?: string; [k: string]: any };
const tags = (xhtml: string): string[] => {
  const t = xhtml.replace(/<\/?div[^>]*>/gi, '').replace(/<li[^>]*>/gi, '\n• ').replace(/<\/(p|ul|ol|li|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
};

/** The readable content of the document, section by section. Exported so tests can check what goes on the page. */
export function noteContent(b: Bundle): { title: string; sections: { title: string; lines: string[] }[]; when: string | null } {
  const res = (b.entry ?? []).map(e => e.resource as Res).filter(Boolean);
  const byRef = new Map(res.map(r => [`${r.resourceType}/${r.id}`, r]));
  const comp = res.find(r => r.resourceType === 'Composition');
  const sections = ((comp?.section ?? []) as Res[]).map(s => {
    const lines = s.text?.div ? tags(String(s.text.div)) : [];
    for (const e of (s.entry ?? []) as { reference?: string }[]) {
      const o = e.reference ? byRef.get(e.reference) : undefined; if (!o) continue;
      const label = o.code?.text ?? o.code?.coding?.[0]?.display ?? 'Measurement';
      const q = o.valueQuantity; const comps = (o.component ?? []) as Res[];
      const val = q ? `${q.value} ${q.unit ?? ''}`.trim() : comps.length ? comps.map(c => `${c.code?.text ?? c.code?.coding?.[0]?.display ?? ''} ${c.valueQuantity?.value ?? ''} ${c.valueQuantity?.unit ?? ''}`.trim()).join(', ') : (o.valueString ?? o.valueCodeableConcept?.text ?? '');
      lines.push(`• ${label}: ${val}${o.effectiveDateTime ? ` (${o.effectiveDateTime})` : ''}`);
    }
    return { title: String(s.title ?? ''), lines };
  }).filter(s => s.title || s.lines.length);
  return { title: String(comp?.title ?? 'Referral note'), sections, when: (b.timestamp as string | undefined) ?? null };
}

export async function renderReferralPdf(bundle: Bundle, meta: { sha256: string | null; fromFacility?: string | null; toFacility?: string | null; priority?: string | null; sentAt?: string | null }): Promise<Buffer> {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const f: Record<string, PDFFont> = {
    latin: await doc.embedFont(load('public-sans-latin-400-normal.woff'), { subset: true }), bold: await doc.embedFont(load('public-sans-latin-700-normal.woff'), { subset: true }),
    deva: await doc.embedFont(load('noto-sans-devanagari-devanagari-400-normal.woff'), { subset: true }), orya: await doc.embedFont(load('noto-sans-oriya-oriya-400-normal.woff'), { subset: true }),
  };
  doc.setTitle('Referral note'); doc.setCreator('AarogyaRekha'); doc.setProducer('AarogyaRekha');
  const W = 595, H = 842, M = 50, LH = 15; const INK = rgb(0.08, 0.14, 0.18), MUTED = rgb(0.29, 0.36, 0.4);
  let page: PDFPage = doc.addPage([W, H]); let y = H - M; let pageNo = 1;

  const footer = (p: PDFPage, n: number) => {
    p.drawLine({ start: { x: M, y: 38 }, end: { x: W - M, y: 38 }, thickness: 0.5, color: MUTED });
    p.drawText('Organises information for review. Does not diagnose or advise treatment.', { x: M, y: 26, size: 8, font: f.latin!, color: MUTED });
    p.drawText(`Page ${n}${meta.sha256 ? `  ·  document checksum (SHA-256) ${meta.sha256.slice(0, 16)}…` : ''}`, { x: M, y: 14, size: 8, font: f.latin!, color: MUTED });
  };
  const newPage = () => { footer(page, pageNo); page = doc.addPage([W, H]); pageNo++; y = H - M; };
  const fontFor = (s: Script, bold: boolean) => (s === 'latin' ? (bold ? f.bold! : f.latin!) : f[s]!);
  const widthOf = (t: string, size: number, bold: boolean) => runsOf(t).reduce((w, r) => w + fontFor(r.script, bold).widthOfTextAtSize(r.text, size), 0);
  const drawRuns = (t: string, x: number, size: number, bold: boolean) => { let cx = x; for (const r of runsOf(t)) { const ft = fontFor(r.script, bold); page.drawText(r.text, { x: cx, y, size, font: ft, color: INK }); cx += ft.widthOfTextAtSize(r.text, size); } };

  const para = (text: string, o: { size?: number; bold?: boolean; indent?: number; after?: number } = {}) => {
    const size = o.size ?? 10.5; const x0 = M + (o.indent ?? 0); const max = W - M - x0; const lh = size + 4.5; let line = '';
    const flush = () => { if (y < 60) newPage(); drawRuns(line.trimEnd(), x0, size, !!o.bold); y -= lh; line = ''; };
    // The longest start of `s` that fits on one line (binary search, so a 3,000 character word is quick).
    const fit = (s: string) => { let lo = 1, hi = s.length; while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (widthOf(s.slice(0, mid), size, !!o.bold) <= max) lo = mid; else hi = mid - 1; } return lo; };
    for (const word of text.split(/\s+/).filter(Boolean)) {
      let piece = line ? `${line} ${word}` : word;
      if (line && widthOf(piece, size, !!o.bold) > max) { flush(); piece = word; }       // start a new line with this word
      while (widthOf(piece, size, !!o.bold) > max && piece.length > 1) { const cut = fit(piece); line = piece.slice(0, cut); flush(); piece = piece.slice(cut); }   // a single very long word
      line = piece;
    }
    if (line) flush(); y -= o.after ?? 0; void LH;
  };

  const c = noteContent(bundle);
  para(c.title, { size: 18, bold: true, after: 4 });
  const meta1 = [meta.fromFacility && `From: ${meta.fromFacility}`, meta.toFacility && `To: ${meta.toFacility}`, meta.priority && `Request priority: ${meta.priority}`, (meta.sentAt ?? c.when) && `Sent: ${(meta.sentAt ?? c.when)!.slice(0, 16).replace('T', ' ')}`].filter(Boolean) as string[];
  for (const l of meta1) para(l, { size: 9.5 });
  y -= 6;
  for (const s of c.sections) {
    if (y < 110) newPage();
    para(s.title, { size: 12, bold: true, after: 1 });
    for (const l of s.lines) para(l, { indent: l.startsWith('•') ? 8 : 0 });
    y -= 6;
  }
  footer(page, pageNo);
  return Buffer.from(await doc.save());
}
