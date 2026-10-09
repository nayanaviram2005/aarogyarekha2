import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { displayName, makeSafe, MAX_PIXELS, sniff } from '../src/files/safe.js';

const seg = (marker: number, payload: Buffer) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([h, payload]); };
const jpeg = (w = 100, h = 80, extra: Buffer[] = []) => Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
  ...extra,
  seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])),
  seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])), Buffer.from('SCANDATA'), Buffer.from([0xff, 0xd9]),
]);
const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); return Buffer.concat([l, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); };
const png = (w = 10, h = 10, extra: Buffer[] = [], trailing = Buffer.alloc(0)) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', Buffer.from('PIXELS')), chunk('IEND', Buffer.alloc(0)), trailing]);
};
const goodPdf = async (pages = 1) => { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); for (let i = 0; i < pages; i++) d.addPage().drawText('Haemoglobin 9.1 g/dL', { font: f, size: 12 }); return Buffer.from(await d.save()); };
const pdfWith = (extra: string) => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog ${extra} >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, 'latin1');

describe('what the file really is', () => {
  it('is decided by its first bytes', async () => {
    expect(sniff(jpeg())).toBe('image/jpeg'); expect(sniff(png())).toBe('image/png'); expect(sniff(await goodPdf())).toBe('application/pdf');
    expect(sniff(Buffer.from('MZ\x90\x00 an exe'))).toBeNull(); expect(sniff(Buffer.from('<html><script>'))).toBeNull(); expect(sniff(Buffer.alloc(0))).toBeNull();
  });
  it('refuses an unknown type, an empty file, and a file whose claimed type disagrees with its contents', () => {
    expect(makeSafe(Buffer.from('hello world'))).toMatchObject({ ok: false });
    expect(makeSafe(Buffer.alloc(0))).toMatchObject({ ok: false, reason: 'The file is empty.' });
    expect(makeSafe(jpeg(), 'application/pdf')).toMatchObject({ ok: false, reason: 'The file type does not match its contents.' });
    expect(makeSafe(jpeg(), 'application/octet-stream')).toMatchObject({ ok: true });
  });
});

describe('JPEG: metadata is removed', () => {
  const exif = seg(0xe1, Buffer.from('Exif\0\0GPS-SECRET-LAT-20.29 Camera-Model-X'));
  const xmp = seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>owner-name</x:xmpmeta>'));
  const iptc = seg(0xed, Buffer.from('Photoshop 3.0\0caption-SECRET'));
  const comment = seg(0xfe, Buffer.from('comment-SECRET'));
  const r = makeSafe(jpeg(100, 80, [exif, xmp, iptc, comment]));

  it('drops EXIF (GPS, camera), XMP, IPTC and comments', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.bytes.toString('latin1');
    for (const secret of ['GPS-SECRET', 'Camera-Model', 'owner-name', 'caption-SECRET', 'comment-SECRET']) expect(s).not.toContain(secret);
    expect(r.strippedBytes).toBeGreaterThan(100);
  });
  it('keeps what is needed to show the picture: JFIF header, size, scan data, end marker', () => {
    if (!r.ok) throw new Error('expected ok');
    const s = r.bytes.toString('latin1');
    expect(s).toContain('JFIF'); expect(s).toContain('SCANDATA');
    expect(r.bytes[0]).toBe(0xff); expect(r.bytes[1]).toBe(0xd8);
    expect(r.bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(r).toMatchObject({ width: 100, height: 80, mime: 'image/jpeg' });
  });
  it('the result is stable: cleaning a cleaned file changes nothing, and the checksum is of the CLEAN bytes', () => {
    if (!r.ok) throw new Error('expected ok');
    const again = makeSafe(r.bytes);
    expect(again.ok && again.bytes.equals(r.bytes)).toBe(true);
    expect(again.ok && again.sha256).toBe(r.sha256);
  });
  it('refuses a damaged or truncated JPEG and one with no size', () => {
    expect(makeSafe(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]))).toMatchObject({ ok: false });
    expect(makeSafe(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toMatchObject({ ok: false });
  });
  it('refuses a decompression bomb (huge pixel count) without decoding it', () => {
    expect(makeSafe(jpeg(20000, 20000))).toMatchObject({ ok: false, reason: 'The image is too large in pixels.' });
    expect(20000 * 20000).toBeGreaterThan(MAX_PIXELS);
  });
});

describe('PNG: metadata and hidden payloads are removed', () => {
  const r = makeSafe(png(10, 10, [chunk('tEXt', Buffer.from('Author\0SECRET-AUTHOR')), chunk('eXIf', Buffer.from('GPS-SECRET')), chunk('iTXt', Buffer.from('xmp-SECRET')), chunk('tIME', Buffer.alloc(7)), chunk('gAMA', Buffer.alloc(4))], Buffer.from('TRAILING-PAYLOAD-SECRET')));
  it('keeps only display chunks and drops text, EXIF, time and anything after the end marker', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.bytes.toString('latin1');
    for (const secret of ['SECRET-AUTHOR', 'GPS-SECRET', 'xmp-SECRET', 'TRAILING-PAYLOAD']) expect(s).not.toContain(secret);
    for (const keep of ['IHDR', 'IDAT', 'IEND', 'gAMA']) expect(s).toContain(keep);
    for (const gone of ['tEXt', 'eXIf', 'iTXt', 'tIME']) expect(s).not.toContain(gone);
    expect(r).toMatchObject({ width: 10, height: 10 });
  });
  it('refuses a damaged PNG, a missing end marker, and a pixel bomb', () => {
    const p = png(); expect(makeSafe(p.subarray(0, p.length - 20))).toMatchObject({ ok: false });
    expect(makeSafe(png(30000, 30000))).toMatchObject({ ok: false, reason: 'The image is too large in pixels.' });
  });
});

describe('PDF: active content is refused (heuristic, not antivirus)', () => {
  it('accepts an ordinary PDF', async () => {
    const r = makeSafe(await goodPdf(3), 'application/pdf');
    expect(r).toMatchObject({ ok: true, mime: 'application/pdf' });
  });
  it.each(['/JavaScript', '/JS (app.alert(1))', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA', '/SubmitForm', '/GoToR'])('refuses %s', tok => {
    expect(makeSafe(pdfWith(tok))).toMatchObject({ ok: false, reason: 'This PDF contains active content, so it was not accepted.' });
  });
  it('sees through letters hidden as hex escapes', () => {
    expect(makeSafe(pdfWith('/J#61vaScript'))).toMatchObject({ ok: false });
    expect(makeSafe(pdfWith('/#4aS (x)'))).toMatchObject({ ok: false });
  });
  it('refuses encrypted and truncated PDFs (page limits are tested with the real parser in pdf.test.ts)', async () => {
    expect(makeSafe(pdfWith('/Encrypt 5 0 R'))).toMatchObject({ ok: false, reason: 'Encrypted PDFs are not accepted.' });
    expect(makeSafe(Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n'))).toMatchObject({ ok: false });
  });
  it('does not mistake harmless words for active content', () => {
    expect(makeSafe(pdfWith('/Title (JavaScript for beginners, the JS guide)'))).toMatchObject({ ok: true });
    expect(makeSafe(pdfWith('/Author (AAron)'))).toMatchObject({ ok: true });
    expect(makeSafe(pdfWith('/OpenAction [3 0 R /Fit]'))).toMatchObject({ ok: true });
  });
});

describe('display name', () => {
  it('drops directories, control characters and odd symbols, and never exceeds 120 characters', () => {
    expect(displayName('C:\\Users\\x\\..\\report 1.pdf')).toBe('report 1.pdf');
    expect(displayName('../../etc/passwd')).toBe('passwd');
    expect(displayName('a<b>:c"|?*\u0000\u001f.pdf')).toBe('abc.pdf');
    expect(displayName('x'.repeat(300))!.length).toBe(120);
    expect(displayName('')).toBeNull(); expect(displayName(undefined)).toBeNull(); expect(displayName('///')).toBeNull();
  });
});
