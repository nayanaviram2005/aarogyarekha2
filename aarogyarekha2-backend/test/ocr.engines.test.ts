import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { chooseReader, mockEngine, OcrUnavailable, pdfTextEngine, SAMPLE_REPORT, tesseractEngine, type CreateWorker } from '../src/ocr/engines.js';
import { parseLabText } from '../src/ocr/labParser.js';

const pdfWith = async (lines: string[]) => { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const p = d.addPage([500, 400]); lines.forEach((l, i) => p.drawText(l, { x: 20, y: 360 - i * 18, size: 11, font: f })); return Buffer.from(await d.save()); };

describe('pdf text layer', () => {
  it('reads a real PDF and the lab parser then finds the rows (end to end, no AI)', async () => {
    const bytes = await pdfWith(['CITY DIAGNOSTIC LAB', 'Haemoglobin 9.1 g/dL 12.0 - 15.5 L', 'Total WBC Count 11,200 /cumm 4000 - 11000 H', 'Fasting Blood Glucose 98 mg/dL 70 - 100']);
    const r = await pdfTextEngine()({ bytes, mime: 'application/pdf' });
    expect(r).toMatchObject({ engine: 'pdf-text-layer', confidence: 0.99 });
    const f = parseLabText(r.text, r.confidence).fields;
    expect(f.map(x => x.fieldName)).toEqual(['haemoglobin', 'wbc_count', 'glucose_fasting']);
    expect(f[0]).toMatchObject({ valueNum: 9.1, unit: 'g/dL', printedFlag: 'low' });
    expect(f[1]).toMatchObject({ valueNum: 11200, printedFlag: 'high' });
  });
  it('a scan with no text says so and points to a photo instead', async () => {
    const d = await PDFDocument.create(); d.addPage();
    await expect(pdfTextEngine()({ bytes: Buffer.from(await d.save()), mime: 'application/pdf' })).rejects.toMatchObject({ kind: 'scanned_pdf', message: expect.stringMatching(/photo/) });
  });
  it('a broken PDF is a plain failure, not a crash', async () => {
    await expect(pdfTextEngine()({ bytes: Buffer.from('%PDF-1.4 garbage'), mime: 'application/pdf' })).rejects.toBeInstanceOf(OcrUnavailable);
  });
});

describe('tesseract (with a fake worker)', () => {
  const fake = (text: string, confidence: number, fail = false) => {
    const terminate = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn(async () => ({ recognize: async () => { if (fail) throw new Error('wasm crashed at C:\\secret'); return { data: { text, confidence } }; }, terminate })) as unknown as CreateWorker & ReturnType<typeof vi.fn>;
    return { create, terminate };
  };
  it('loads the right language models, always with English, scales confidence to 0..1, and always shuts the worker down', async () => {
    const f = fake('Haemoglobin 9.1 g/dL 12.0 - 15.5 L', 87);
    const r = await tesseractEngine({ createWorker: f.create, langPath: './tessdata' })({ bytes: Buffer.from('x'), mime: 'image/png', language: 'hi' });
    expect(f.create).toHaveBeenCalledWith('hin+eng', 1, expect.objectContaining({ langPath: './tessdata' }));
    expect(r).toMatchObject({ engine: 'tesseract', confidence: 0.87, language: 'hi' });
    expect(f.terminate).toHaveBeenCalled();
  });
  it('English uses eng only; Odia uses ori+eng', async () => {
    const f = fake('x', 50);
    await tesseractEngine({ createWorker: f.create })({ bytes: Buffer.from('x'), mime: 'image/png' });
    await tesseractEngine({ createWorker: f.create })({ bytes: Buffer.from('x'), mime: 'image/png', language: 'or' });
    expect(f.create.mock.calls.map((c: unknown[]) => c[0])).toEqual(['eng', 'ori+eng']);
  });
  it('clamps a silly confidence into 0..1', async () => {
    expect((await tesseractEngine({ createWorker: fake('x', 250).create })({ bytes: Buffer.from('x'), mime: 'image/png' })).confidence).toBe(1);
    expect((await tesseractEngine({ createWorker: fake('x', -5).create })({ bytes: Buffer.from('x'), mime: 'image/png' })).confidence).toBe(0);
  });
  it('an engine crash becomes a plain message with no internals, and the worker is still shut down', async () => {
    const f = fake('', 0, true);
    const e = await tesseractEngine({ createWorker: f.create })({ bytes: Buffer.from('x'), mime: 'image/png' }).catch(x => x as OcrUnavailable) as OcrUnavailable;
    expect(e).toBeInstanceOf(OcrUnavailable);
    expect(e.message).not.toContain('secret');
    expect(f.terminate).toHaveBeenCalled();
  });
});

describe('choosing a reader', () => {
  it('mock returns the synthetic sample whatever the file is', async () => {
    const r = await chooseReader('mock')({ bytes: Buffer.from('anything'), mime: 'image/png' });
    expect(r.text).toBe(SAMPLE_REPORT);
    expect(parseLabText(r.text).fields.length).toBeGreaterThanOrEqual(5);
  });
  it('the sample itself is clearly synthetic and parses to the expected rows', () => {
    expect(SAMPLE_REPORT).toContain('SYNTHETIC SAMPLE');
    expect(parseLabText(SAMPLE_REPORT).fields.map(f => f.fieldName)).toEqual(['haemoglobin', 'wbc_count', 'platelet_count', 'esr', 'glucose_fasting']);
  });
  it('local mode sends PDFs to the text layer and refuses other types', async () => {
    const bytes = await pdfWith(['Haemoglobin 9.1 g/dL 12.0 - 15.5 L']);
    expect((await chooseReader('local')({ bytes, mime: 'application/pdf' })).engine).toBe('pdf-text-layer');
    await expect(chooseReader('local')({ bytes: Buffer.from('x'), mime: 'text/plain' })).rejects.toMatchObject({ kind: 'unsupported' });
  });
  it('mockEngine can be given other text', async () => { expect((await mockEngine('Glucose 98 mg/dL 70-100')({ bytes: Buffer.alloc(0), mime: 'image/png' })).text).toContain('Glucose'); });
});
