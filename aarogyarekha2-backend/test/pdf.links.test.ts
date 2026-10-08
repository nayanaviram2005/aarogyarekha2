import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { hasActiveObjects, inspectPdf, stripLinks } from '../src/files/pdf.js';

async function withLink(js = false) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const p = d.addPage();
  p.drawText('Name: Asha Rao   Age: 27 Y   Sex: F  Haemoglobin 9.1 g/dL 12.0 - 15.5 L', { font: f, size: 10 });
  const action = d.context.obj(js ? { S: 'JavaScript', JS: PDFString.of('app.alert(1)') } : { S: 'URI', URI: PDFString.of('https://lab.example/report') });
  const annot = d.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 20], Border: [0, 0, 0], A: d.context.register(action) });
  p.node.set(PDFName.of('Annots'), d.context.obj([d.context.register(annot)]) as PDFArray);
  return Buffer.from(await d.save());
}

describe('web links in a PDF', () => {
  it('are removed, and the report then passes the check and still reads', async () => {
    const raw = await withLink();
    expect(await hasActiveObjects(raw)).toBe(true);
    const { bytes, removed } = await stripLinks(raw);
    expect(removed).toBeGreaterThan(0); expect(await hasActiveObjects(bytes)).toBe(false);
    const r = await inspectPdf(bytes, { readText: true });
    expect(r.ok).toBe(true); if (r.ok) expect(r.text.join(' ')).toContain('Haemoglobin 9.1');
    expect(bytes.toString('latin1')).not.toContain('lab.example');
  });
  it('a file with no links is returned untouched', async () => {
    const d = await PDFDocument.create(); d.addPage(); const raw = Buffer.from(await d.save());
    const r = await stripLinks(raw); expect(r.removed).toBe(0); expect(r.bytes).toBe(raw);
  });
  it('scripts are still refused: only plain links are tolerated', async () => {
    const { bytes } = await stripLinks(await withLink(true));
    expect(await hasActiveObjects(bytes)).toBe(true);
    expect((await inspectPdf(bytes)).ok).toBe(false);
  });
});
