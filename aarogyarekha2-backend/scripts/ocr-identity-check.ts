import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chooseReader } from '../src/ocr/engines.js';
import { stripLinks } from '../src/files/pdf.js';
import { parseIdentity } from '../src/ocr/identity.js';
import { parseLabText } from '../src/ocr/labParser.js';

const own = process.argv[2];
let bytes: Buffer; let mime = 'application/pdf';
if (own) { bytes = readFileSync(own); mime = /\.png$/i.test(own) ? 'image/png' : /\.jpe?g$/i.test(own) ? 'image/jpeg' : 'application/pdf'; }
else {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const p = d.addPage([595, 842]);
  const lines = ['SAMPLE DIAGNOSTICS (INVENTED)', 'Name: Mrs. LIPIKA NAYAK        Age / Gender: 27 Years / Female', 'Ref. By: Dr. Sahoo        Sample Collected: 12/10/2026', 'Mobile: 98765 43210', '',
    'COMPLETE BLOOD COUNT', 'Haemoglobin 9.1 g/dL 12.0 - 15.5 L', 'Total WBC Count 11,200 /cumm 4000 - 11000 H', 'Platelet Count 2.4 lakh/cumm 1.5 - 4.5', 'ESR 38 mm/hr 0 - 20 H'];
  lines.forEach((t, i) => p.drawText(t, { x: 40, y: 780 - i * 22, size: 11, font: f }));
  bytes = Buffer.from(await d.save());
}
if (mime === 'application/pdf') bytes = (await stripLinks(bytes)).bytes;
const read = await chooseReader('local')({ bytes, mime });
console.log('engine:', read.engine, 'confidence:', read.confidence);
console.log('identity:', parseIdentity(read.text));
console.log('rows:', parseLabText(read.text, read.confidence).fields.map(x => `${x.fieldName} ${x.valueNum ?? x.extractedValueText} ${x.unit ?? ''} ${x.printedFlag ?? ''}`.trim()));
