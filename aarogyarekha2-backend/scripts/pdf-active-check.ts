// Says which PDF structures would make the upload check refuse a file. Prints names of structures and counts only, never text.
// Run in aarogyarekha2-backend: npx tsx scripts/pdf-active-check.ts "C:\path\to\file.pdf"
import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';

const BAD_KEYS = new Set(['JS', 'JavaScript', 'EF', 'EmbeddedFiles', 'RichMedia', 'XFA', 'Encrypt']);
const BAD_ACTIONS = new Set(['JavaScript', 'Launch', 'GoToR', 'GoToE', 'ImportData', 'SubmitForm', 'Rendition', 'Movie', 'Sound', 'Hide', 'Thread', 'URI']);
const d = await PDFDocument.load(readFileSync(process.argv[2]!), { updateMetadata: false, throwOnInvalidObject: false });
const found: Record<string, number> = {};
for (const [, obj] of d.context.enumerateIndirectObjects()) {
  const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null; if (!dict) continue;
  for (const k of dict.keys()) { const n = k.asString().slice(1); if (BAD_KEYS.has(n)) found[`key /${n}`] = (found[`key /${n}`] ?? 0) + 1; }
  const s = dict.get(PDFName.of('S')); if (s instanceof PDFName && BAD_ACTIONS.has(s.asString().slice(1))) found[`action /${s.asString().slice(1)}`] = (found[`action /${s.asString().slice(1)}`] ?? 0) + 1;
  const t = dict.get(PDFName.of('Type')); if (t instanceof PDFName && ['EmbeddedFile', 'Filespec'].includes(t.asString().slice(1))) found[`type /${t.asString().slice(1)}`] = (found[`type /${t.asString().slice(1)}`] ?? 0) + 1;
}
console.log(Object.keys(found).length ? found : 'nothing flagged by the structure walk (the refusal came from pdf.js: scripts or attachments)');
