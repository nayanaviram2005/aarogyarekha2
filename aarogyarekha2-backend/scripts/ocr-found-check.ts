// Like ocr-identity-check.ts but prints only WHICH details were found, never their values. Safe to paste.
import { readFileSync } from 'node:fs';
import { chooseReader } from '../src/ocr/engines.js';
import { stripLinks } from '../src/files/pdf.js';
import { parseIdentity } from '../src/ocr/identity.js';
import { parseLabText } from '../src/ocr/labParser.js';
const file = process.argv[2]!;
let bytes = readFileSync(file); const mime = /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'application/pdf';
if (mime === 'application/pdf') bytes = (await stripLinks(bytes)).bytes;
const r = await chooseReader('local')({ bytes, mime });
const id = parseIdentity(r.text);
console.log({ engine: r.engine, textLines: r.text.split('\n').filter(l => l.trim()).length, name: !!id.fullName, nameWords: id.fullName?.split(' ').length ?? 0, age: id.ageYears !== undefined, sex: id.sex ?? null, birthDate: !!id.birthDate, phone: !!id.phone, resultRows: parseLabText(r.text, r.confidence).fields.length });
// Shape of the first lines with letters and digits blanked, to see the layout without seeing the data.
console.log(r.text.split('\n').filter(l => l.trim()).slice(0, 14).map(l => l.replace(/\p{L}/gu, 'a').replace(/\d/g, '9').slice(0, 90)));
const KEY = /^(name|patient|age|sex|gender|dob|date|birth|mobile|phone|ref|by|referred|years?|yrs?|y|male|female|m|f|id|no|uhid|mr|mrs|ms|miss|smt|dr|sample|collected|reported|registered|visit|lab|barcode|sid|pid|mrn|reg|of|the|and|\/|:|-)$/i;
const keyLines = r.text.split('\n').filter(l => /\b(name|patient|age|sex|gender|dob|birth|mobile|phone|referred)\b/i.test(l));
console.log('label lines:', keyLines.length);
for (const l of keyLines.slice(0, 12)) console.log('  ' + l.split(/(\s+|[:/|,()])/).map(w => (!w || /^\s+$/.test(w) || /^[:/|,()]$/.test(w) ? w : KEY.test(w) ? w : /\d/.test(w) ? w.replace(/\d/g, '9').replace(/\p{L}/gu, 'a') : 'W')).join('').slice(0, 110));
