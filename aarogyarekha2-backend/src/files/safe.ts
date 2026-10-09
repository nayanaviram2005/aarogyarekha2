import { createHash } from 'node:crypto';

export type Mime = 'application/pdf' | 'image/jpeg' | 'image/png';
export const EXT: Record<Mime, 'pdf' | 'jpg' | 'png'> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export const MAX_PIXELS = 40_000_000;
export const MAX_PDF_PAGES = 50;

export type Safe =
  | { ok: true; bytes: Buffer; mime: Mime; sha256: string; width?: number; height?: number; pages?: number; strippedBytes: number }
  | { ok: false; reason: string };

const bad = (reason: string): Safe => ({ ok: false, reason });

export function sniff(b: Buffer): Mime | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const KEEP_APP = new Set([0xe0, 0xee]);

function cleanJpeg(b: Buffer): Safe {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2; let w = 0; let h = 0;
  while (i < b.length) {
    if (b[i] !== 0xff) return bad('The image file is damaged.');
    let m = b[i + 1];
    while (m === 0xff) { i++; m = b[i + 1]; }
    if (m === undefined) return bad('The image file is damaged.');
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); i += 2; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) return bad('The image file is damaged.');
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return bad('The image file is damaged.');
    const seg = b.subarray(i, i + 2 + len);
    if (SOF.has(m)) { h = seg.readUInt16BE(5); w = seg.readUInt16BE(7); }
    if (m === 0xda) { out.push(b.subarray(i)); i = b.length; break; }
    const isApp = m >= 0xe0 && m <= 0xef;
    if (!((isApp && !KEEP_APP.has(m)) || m === 0xfe)) out.push(seg);
    i += 2 + len;
  }
  if (!w || !h) return bad('The image has no readable size.');
  if (w * h > MAX_PIXELS) return bad('The image is too large in pixels.');
  const bytes = Buffer.concat(out);
  return { ok: true, bytes, mime: 'image/jpeg', sha256: createHash('sha256').update(bytes).digest('hex'), width: w, height: h, strippedBytes: b.length - bytes.length };
}

const KEEP_CHUNK = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'pHYs']);

function cleanPng(b: Buffer): Safe {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8; let w = 0; let h = 0; let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > b.length) return bad('The image file is damaged.');
    if (type === 'IHDR') { if (len !== 13) return bad('The image file is damaged.'); w = b.readUInt32BE(i + 8); h = b.readUInt32BE(i + 12); }
    if (KEEP_CHUNK.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  if (!sawEnd || !w || !h) return bad('The image file is damaged.');
  if (w * h > MAX_PIXELS) return bad('The image is too large in pixels.');
  const bytes = Buffer.concat(out);
  return { ok: true, bytes, mime: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex'), width: w, height: h, strippedBytes: b.length - bytes.length };
}

const ACTIVE = ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/EmbeddedFiles', '/RichMedia', '/XFA', '/GoToR', '/GoToE', '/ImportData', '/SubmitForm', '/Encrypt'];

const decodeNames = (s: string) => s.replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

function checkPdf(b: Buffer): Safe {
  const text = decodeNames(b.toString('latin1'));
  for (const tok of ACTIVE) {
    const re = new RegExp(tok.replace('/', '\\/') + '(?![A-Za-z])');
    if (re.test(text)) return bad(tok === '/Encrypt' ? 'Encrypted PDFs are not accepted.' : 'This PDF contains active content, so it was not accepted.');
  }
  if (!/%%EOF/.test(b.subarray(Math.max(0, b.length - 2048)).toString('latin1'))) return bad('The PDF file looks cut off or damaged.');
  return { ok: true, bytes: b, mime: 'application/pdf', sha256: createHash('sha256').update(b).digest('hex'), strippedBytes: 0 };
}

export function makeSafe(input: Buffer, claimed?: string): Safe {
  if (input.length === 0) return bad('The file is empty.');
  const real = sniff(input);
  if (!real) return bad('Only PDF, JPEG and PNG files are accepted.');
  if (claimed && claimed !== 'application/octet-stream' && claimed !== real) return bad('The file type does not match its contents.');
  return real === 'image/jpeg' ? cleanJpeg(input) : real === 'image/png' ? cleanPng(input) : checkPdf(input);
}

export function displayName(name: string | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean || null;
}
