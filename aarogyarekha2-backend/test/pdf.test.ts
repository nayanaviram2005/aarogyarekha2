import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inspectPdf } from '../src/files/pdf.js';
import { MAX_PDF_PAGES } from '../src/files/safe.js';

const make = async (opts: { pages?: number; lines?: string[]; objectStreams?: boolean; js?: boolean; attach?: boolean } = {}) => {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (opts.pages ?? 1); i++) {
    const p = d.addPage([400, 300]);
    (opts.lines ?? ['Haemoglobin 9.1 g/dL 12.0 - 15.5 L']).forEach((l, n) => p.drawText(l, { x: 20, y: 260 - n * 20, size: 11, font: f }));
  }
  if (opts.js) d.catalog.set(PDFName.of('OpenAction'), d.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
  if (opts.js) d.catalog.set(PDFName.of('Names'), d.context.obj({ JavaScript: d.context.obj({ Names: [PDFString.of('x'), d.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(2)') })] }) }));
  if (opts.attach) await d.attach(new TextEncoder().encode('payload'), 'evil.txt', { mimeType: 'text/plain' });
  return Buffer.from(await d.save({ useObjectStreams: opts.objectStreams ?? true }));
};

describe('inspectPdf (real parser)', () => {
  it('counts pages and reads the text layer line by line, even in a COMPRESSED pdf', async () => {
    const r = await inspectPdf(await make({ pages: 2, lines: ['Haemoglobin 9.1 g/dL 12.0 - 15.5 L', 'Glucose 98 mg/dL'], objectStreams: true }), { readText: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pages).toBe(2);
    expect(r.text[0]).toContain('Haemoglobin 9.1 g/dL 12.0 - 15.5 L');
    expect(r.text[0]!.split('\n').length).toBeGreaterThanOrEqual(2);
    expect(r.hasText).toBe(true);
  });
  it('does not read text unless asked', async () => {
    const r = await inspectPdf(await make(), {});
    expect(r.ok && r.text).toEqual([]);
  });
  it('reports a PDF with no text layer (a scan) so it can go to OCR', async () => {
    const d = await PDFDocument.create(); d.addPage();
    const r = await inspectPdf(Buffer.from(await d.save()), { readText: true });
    expect(r).toMatchObject({ ok: true, hasText: false });
  });
  it('refuses too many pages', async () => {
    expect(await inspectPdf(await make({ pages: MAX_PDF_PAGES + 1 }))).toMatchObject({ ok: false });
  });
  it('refuses scripts even when hidden in compressed object streams', async () => {
    expect(await inspectPdf(await make({ js: true, objectStreams: true }))).toMatchObject({ ok: false, reason: 'This PDF contains active content, so it was not accepted.' });
  });
  it('refuses embedded attachments', async () => {
    expect(await inspectPdf(await make({ attach: true, objectStreams: true }))).toMatchObject({ ok: false });
  });
  it('refuses garbage that only looks like a PDF', async () => {
    expect(await inspectPdf(Buffer.from('%PDF-1.4\nthis is not a pdf at all\n%%EOF'))).toMatchObject({ ok: false });
  });
});
