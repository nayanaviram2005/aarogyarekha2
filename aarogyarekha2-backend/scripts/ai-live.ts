// A live check of every AI path with INVENTED data, using the keys in .env. Prints what came back, never a key.
//   node --env-file=../.env --import tsx scripts/ai-live.ts          (from aarogyarekha2-backend)
//
// It runs, against the real service:
//   1. translation (Hindi),  2. the priority opinion + chosen and reworded follow-up questions on four invented cases,
//   3. the report reader (vision) on a synthetic lab PDF, compared with the local parser.
// Nothing here touches the database.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AiEnv, AiError, envForTask, makeProvider } from '../src/ai/provider.js';
import { translateToEnglish } from '../src/ai/translate.js';
import { getAiOpinion, type Candidate } from '../src/ai/triageOpinion.js';
import { makeVision } from '../src/ai/vision.js';
import { SAMPLE_REPORT } from '../src/ocr/engines.js';
import { parseLabText } from '../src/ocr/labParser.js';
import { crossCheck } from '../src/ocr/crossCheck.js';
import { askableFloors, CORE_SIGNS, selectRelevantSigns } from '../src/triage/relevance.js';
import { RULESET_PROPOSED } from '../src/triage/ruleset.proposed.js';
import type { TriageInput } from '../src/triage/types.js';

const env = AiEnv.parse(process.env);
const err = (e: unknown) => (e instanceof AiError ? `${e.kind}: ${e.message}` : `${(e as Error).name}: ${(e as Error).message}`);
const timed = async <T,>(label: string, f: () => Promise<T>): Promise<T | null> => { const t = Date.now(); try { const r = await f(); console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`); return r; } catch (e) { console.log(`  FAILED ${label}: ${err(e)}`); process.exitCode = 1; return null; } };
const show = (task: 'TRANSLATE' | 'TRIAGE' | 'VISION') => { const e = envForTask(env, task); const p = makeProvider(e); console.log(`[${task}] provider: ${p.name}  model: ${p.model || '(not set)'}`); return { e, p }; };

// ---------------------------------------------------------------- 1. translation
console.log('\n1. Translation (Hindi to English)');
{
  const { p } = show('TRANSLATE');
  const o = await timed('translate', () => translateToEnglish(p.generate, [{ id: 'a', text: 'तीन दिन से बुखार और खाँसी है, पेट में दर्द भी है' }], 'hi', { names: [], identifiers: [] }));
  if (o) console.log('  translated:', JSON.stringify([...o.translated.values()]), ' rejected:', o.rejected.length);
}

// ---------------------------------------------------------------- 2. priority opinion, chosen questions, wording
console.log('\n2. Priority opinion, question choice and wording');
const rs = { ...RULESET_PROPOSED, status: 'approved' as const };
const cases: { name: string; input: TriageInput; complaint: string; symptoms: string[]; expect: string }[] = [
  { name: 'plain stomach pain (adult)', input: { ageYears: 34, pregnant: false, vitals: { temperature_c: 37.0, pulse_bpm: 84, bp_systolic_mmhg: 120, bp_diastolic_mmhg: 80, resp_rate_pm: 16, spo2_pct: 98 }, signs: {} }, complaint: 'Stomach pain since yesterday evening, no vomiting', symptoms: ['Dull pain in the lower stomach, 1 day, severity 4 of 10'], expect: 'tier 3 or 4; abdomen questions; NO self-harm, burn, weapon, eye questions' },
  { name: 'child, will not drink', input: { ageYears: 1.5, pregnant: false, vitals: { temperature_c: 39.4 }, signs: {} }, complaint: 'My son has fever for two days and will not drink or feed', symptoms: ['Fever, 2 days', 'Not drinking, since morning', 'Very sleepy'], expect: 'tier 1 or 2; child danger questions' },
  { name: 'chest pain with sweating (adult)', input: { ageYears: 58, pregnant: false, vitals: { pulse_bpm: 112 }, signs: {} }, complaint: 'Heavy pain in the chest for half an hour, sweating, pain going to the left arm', symptoms: ['Chest heaviness, 30 minutes, severity 8 of 10'], expect: 'tier 1' },
  { name: 'niche: pregnant, swollen feet and headache', input: { ageYears: 27, pregnant: true, vitals: { bp_systolic_mmhg: 150, bp_diastolic_mmhg: 98 }, signs: {} }, complaint: 'Headache and swelling of feet, 34 weeks pregnant', symptoms: ['Headache, 2 days', 'Swollen feet and hands'], expect: 'tier 1 or 2; pregnancy questions' },
];
const { p: triageP } = show('TRIAGE');
let lastText = '';
const gen: typeof triageP.generate = async r => { const x = await triageP.generate(r); lastText = x.text; return x; };
for (const c of cases) {
  console.log(`\n  case: ${c.name}   (expect: ${c.expect})`);
  const open = askableFloors(c.input, rs);
  const cands: Candidate[] = open.map(f => ({ code: f.sign, label: f.label, question: f.question, must: CORE_SIGNS.includes(f.sign) }));
  const run = await timed('opinion', () => getAiOpinion(gen, c.input, { complaint: c.complaint, symptoms: c.symptoms.map(text => ({ text })) }, c.input.pregnant ? 'female' : 'unknown', {}, cands));
  if (!run) continue;
  if (!run.opinion) { console.log(`  UNUSABLE reply (dropped: ${run.dropped}); raw length ${lastText.length}; starts ${JSON.stringify(lastText.slice(0, 120))}; ends ${JSON.stringify(lastText.slice(-120))}`); process.exitCode = 1; continue; }
  const o = run.opinion;
  console.log(`  tier ${o.tier}: ${o.reason}`);
  console.log(`  AI picked ${o.ask?.length ?? 0} questions: ${(o.ask ?? []).join(', ')}`);
  console.log(`  worded ${Object.keys(o.phrasing).length}:`);
  for (const [code, q] of Object.entries(o.phrasing).slice(0, 6)) console.log(`    ${code}: ${q}`);
  const sel = selectRelevantSigns(c.input, rs, [c.complaint, ...c.symptoms].join('. '), o.ask);
  console.log(`  final list (${sel.signs.length}, from ${sel.source}): ${sel.signs.join(', ')}`);
  const odd = sel.signs.filter(s => /mental_health|self_harm|weapon|burn|eye|testicular|object_stuck/.test(s));
  if (odd.length && c.name.startsWith('plain')) { console.log(`  CHECK: unrelated-looking questions in the list: ${odd.join(', ')}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------- 3. report reader
console.log('\n3. Report reader (vision) on a synthetic lab PDF');
{
  const { e } = show('VISION');
  const vision = makeVision(e);
  if (!vision.supported) { console.log('  not set up for vision (needs a key and a model)'); process.exitCode = 1; }
  else {
    const doc = await PDFDocument.create(); const page = doc.addPage([595, 842]); const font = await doc.embedFont(StandardFonts.Helvetica);
    SAMPLE_REPORT.split('\n').forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 22, size: 12, font }));
    const bytes = Buffer.from(await doc.save());
    const r = await timed('vision', () => vision.read({ bytes, mime: 'application/pdf' }));
    if (r) {
      console.log(`  read ${r.rows.length} rows (dropped ${r.dropped}):`);
      for (const x of r.rows) console.log(`    ${x.name} | ${x.value} ${x.unit ?? ''} | range ${x.referenceRange ?? '-'} | flag ${x.flag ?? '-'}`);
      const local = parseLabText(SAMPLE_REPORT, 0.95).fields;
      const m = crossCheck(local, r.rows);
      console.log('  agreement with the local parser:', JSON.stringify(m.counts));
      if (m.counts.agree < 4) { console.log('  CHECK: fewer than 4 rows agree'); process.exitCode = 1; }
      if (r.rows.some(x => /test patient|27 y/i.test(`${x.name} ${x.value}`))) { console.log('  CHECK: personal details were copied'); process.exitCode = 1; }
    }
  }
}
console.log(process.exitCode ? '\nSome checks need attention (see above).' : '\nAll live checks looked fine.');
