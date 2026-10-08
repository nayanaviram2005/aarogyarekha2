// Parses a PDF with pdf.js (a real parser, so compressed object streams are visible) to count pages, find scripts and
// attachments, and read the text layer. Nothing is executed or rendered; scripting is disabled.
import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import { MAX_PDF_PAGES } from './safe.js';

const BAD_KEYS = new Set(['JS', 'JavaScript', 'EF', 'EmbeddedFiles', 'RichMedia', 'XFA', 'Encrypt']);
const BAD_ACTIONS = new Set(['JavaScript', 'Launch', 'GoToR', 'GoToE', 'ImportData', 'SubmitForm', 'Rendition', 'Movie', 'Sound', 'Hide', 'Thread', 'URI']);

/**
 * Walks EVERY object in the file (pdf-lib decodes compressed object streams, so nothing is hidden) looking for scripts,
 * attachments, rich media, forms that submit, and launch or remote actions. URI links are refused too: a lab report has no use for them.
 */
export async function hasActiveObjects(bytes: Buffer): Promise<boolean> {
  const d = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  for (const [, obj] of d.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    for (const k of dict.keys()) if (BAD_KEYS.has(k.asString().slice(1))) return true;
    const s = dict.get(PDFName.of('S'));
    if (s instanceof PDFName && BAD_ACTIONS.has(s.asString().slice(1))) return true;
    const t = dict.get(PDFName.of('Type'));
    if (t instanceof PDFName && ['EmbeddedFile', 'Filespec'].includes(t.asString().slice(1))) return true;
  }
  return false;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let lib: Promise<PdfJs> | null = null;
const pdfjs = () => (lib ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

export interface PdfInfo { ok: true; pages: number; text: string[]; hasText: boolean }
export type PdfResult = PdfInfo | { ok: false; reason: string };

export async function inspectPdf(bytes: Buffer, opts: { readText?: boolean } = {}): Promise<PdfResult> {
  const { getDocument } = await pdfjs();
  let doc; let task;
  try {
    task = getDocument(({
      data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, enableXfa: false,
      stopAtErrors: false, verbosity: 0,
    } as unknown) as Parameters<typeof getDocument>[0]);
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') return { ok: false, reason: 'Encrypted PDFs are not accepted.' };
    return { ok: false, reason: 'The PDF could not be read.' };
  }
  try {
    if (doc.numPages < 1) return { ok: false, reason: 'The PDF has no pages.' };
    if (doc.numPages > MAX_PDF_PAGES) return { ok: false, reason: `The PDF has more than ${MAX_PDF_PAGES} pages.` };
    if ((await doc.hasJSActions()) || (await hasActiveObjects(bytes).catch(() => true))) return { ok: false, reason: 'This PDF contains active content, so it was not accepted.' };
    const att = await doc.getAttachments();
    if (att && Object.keys(att).length > 0) return { ok: false, reason: 'This PDF contains active content, so it was not accepted.' };
    const text: string[] = [];
    if (opts.readText) {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        // Keep line structure: pdf.js marks the end of a visual line.
        let line = ''; const lines: string[] = [];
        for (const it of tc.items as { str: string; hasEOL?: boolean }[]) { line += it.str; if (it.hasEOL) { lines.push(line); line = ''; } else line += ' '; }
        if (line.trim()) lines.push(line);
        text.push(lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
        page.cleanup();
      }
    }
    return { ok: true, pages: doc.numPages, text, hasText: text.some(t => t.trim().length > 20) };
  } finally { await task.destroy(); }
}

/**
 * Web links in a PDF (a lab's website in the footer, a QR link) are inert until someone clicks them, but nothing in a patient record should
 * be able to send staff to a web page. They are removed rather than the whole report refused. Only plain links are touched: scripts,
 * attachments, launch actions and the rest are still refused by the check above.
 */
export async function stripLinks(bytes: Buffer): Promise<{ bytes: Buffer; removed: number }> {
  const d = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  let removed = 0;
  const isUri = (o: unknown) => o instanceof PDFDict && o.get(PDFName.of('S')) instanceof PDFName && (o.get(PDFName.of('S')) as PDFName).asString() === '/URI';
  for (const [, obj] of d.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    if (isUri(dict)) { dict.delete(PDFName.of('S')); dict.delete(PDFName.of('URI')); removed++; continue; }
    const a = dict.get(PDFName.of('A'));                                  // an action written inline inside an annotation
    if (isUri(a)) { dict.delete(PDFName.of('A')); removed++; }
  }
  if (removed === 0) return { bytes, removed: 0 };
  return { bytes: Buffer.from(await d.save({ useObjectStreams: false })), removed };
}
