// Text readers for uploaded reports. ALL OF THEM RUN LOCALLY: no page, photo or text from a patient record is sent to any
// outside AI or OCR service. (An external vision model would receive an identifiable image, which the privacy design forbids.)
//   pdf text layer : reads the text already inside the PDF with pdf.js. Exact, instant, offline.
//   tesseract      : reads photos / scans with Tesseract OCR (WASM) in this process. It downloads only the LANGUAGE MODEL on first
//                    use (no patient data); set TESSDATA_PATH to a local folder to run fully offline.
//   mock           : fixed synthetic text for demos and tests.
import { inspectPdf } from '../files/pdf.js';

export type OcrLanguage = 'en' | 'hi' | 'or';
export interface OcrResult { engine: string; engineVersion: string | null; text: string; confidence: number | null; language: OcrLanguage | null }
export type ReadText = (file: { bytes: Buffer; mime: string; language?: OcrLanguage }) => Promise<OcrResult>;

export class OcrUnavailable extends Error {
  constructor(public readonly kind: 'scanned_pdf' | 'engine_failed' | 'timeout' | 'unsupported', message: string) { super(message); this.name = 'OcrUnavailable'; }
}

import { enhance as enhanceImage } from '../files/imageQuality.js';
const TESS_LANG: Record<OcrLanguage, string> = { en: 'eng', hi: 'hin', or: 'ori' };
const TIMEOUT_MS = 90_000;

export const pdfTextEngine = (): ReadText => async ({ bytes }) => {
  const r = await inspectPdf(bytes, { readText: true });
  if (!r.ok) throw new OcrUnavailable('engine_failed', r.reason);
  if (!r.hasText) throw new OcrUnavailable('scanned_pdf', 'This PDF is a scan with no text in it. Upload a clear photo of each page instead.');
  return { engine: 'pdf-text-layer', engineVersion: 'pdfjs', text: r.text.join('\n'), confidence: 0.99, language: null };
};

interface WorkerLike { recognize(img: Buffer): Promise<{ data: { text: string; confidence: number } }>; terminate(): Promise<unknown> }
export type CreateWorker = (langs: string, oem: number, opts: Record<string, unknown>) => Promise<WorkerLike>;

export function tesseractEngine(opts: { langPath?: string; createWorker?: CreateWorker; enhance?: boolean } = {}): ReadText {
  return async ({ bytes: original, mime, language = 'en' }) => {
    // A cleaned copy (contrast stretched, tilt straightened) is read; the stored file is untouched. Falls back to the original on any problem.
    const bytes = opts.enhance === false ? original : enhanceImage(original, mime).bytes;
    const create = opts.createWorker ?? ((await import('tesseract.js')).createWorker as unknown as CreateWorker);
    // English is always loaded alongside, because lab reports mix a local language with English test names and units.
    const langs = language === 'en' ? 'eng' : `${TESS_LANG[language]}+eng`;
    let worker: WorkerLike | null = null;
    try {
      worker = await create(langs, 1, { ...(opts.langPath ? { langPath: opts.langPath } : {}), logger: () => {} });
      const run = worker.recognize(bytes);
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new OcrUnavailable('timeout', 'Reading the image took too long. Try a smaller, clearer photo.')), TIMEOUT_MS).unref?.());
      const { data } = await Promise.race([run, timeout]);
      return { engine: 'tesseract', engineVersion: 'tesseract.js', text: data.text, confidence: Math.max(0, Math.min(1, data.confidence / 100)), language };
    } catch (e) {
      if (e instanceof OcrUnavailable) throw e;
      throw new OcrUnavailable('engine_failed', 'The image could not be read. Try a clearer photo.');
    } finally { await worker?.terminate().catch(() => {}); }
  };
}

export const SAMPLE_REPORT = [
  'CITY DIAGNOSTIC LAB (SYNTHETIC SAMPLE)', 'Patient Name: Test Patient   Age: 27 Y   Sex: F', 'COMPLETE BLOOD COUNT',
  'Haemoglobin 9.1 g/dL 12.0 - 15.5 L', 'Total WBC Count 11,200 /cumm 4000 - 11000 H', 'Platelet Count 2.4 lakh/cumm 1.5 - 4.5', 'ESR 38 mm/hr 0 - 20 H',
  'Fasting Blood Glucose 98 mg/dL 70 - 100',
].join('\n');
export const mockEngine = (text = SAMPLE_REPORT): ReadText => async () => ({ engine: 'mock', engineVersion: null, text, confidence: 0.95, language: 'en' });

/** PDFs use the text layer; photos use Tesseract. 'mock' ignores the file and returns the synthetic sample. */
export function chooseReader(provider: 'local' | 'mock', opts: { langPath?: string } = {}): ReadText {
  if (provider === 'mock') return mockEngine();
  const pdf = pdfTextEngine(); const img = tesseractEngine({ langPath: opts.langPath });
  return async file => {
    if (file.mime === 'application/pdf') return pdf(file);
    if (file.mime === 'image/jpeg' || file.mime === 'image/png') return img(file);
    throw new OcrUnavailable('unsupported', 'This kind of file cannot be read.');
  };
}
