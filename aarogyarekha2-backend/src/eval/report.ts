// Turns an evaluation Summary (and an optional performance measurement) into the text of docs/EVALUATION.md.
import type { InvariantReport, Summary } from './run.js';
import type { Score } from './ocrCorpus.js';

export interface PerfResult { label: string; n: number; ms: number; note?: string }
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function renderReport(s: Summary, inv: InvariantReport, perf: PerfResult[], ruleSet: { name: string; version: string; status: string }, generatedAt: Date, proposed?: { version: string; summary: Summary; invariants: InvariantReport }, ocr?: Score): string {
  const L: string[] = [];
  L.push('# Evaluation of the draft triage rules', '');
  L.push(`Generated ${generatedAt.toISOString().slice(0, 10)} for rule set \`${ruleSet.name}\` v${ruleSet.version} (status: ${ruleSet.status}).`, '');
  L.push('## Read this first', '');
  L.push('- Every case is **invented**. No real patient data was used.');
  L.push('- The "expected" tier is what the **build team** believes is right, from the cited protocol or the documented tier mapping. **It is not a clinician\'s label.** A qualified clinician must review and replace the labels before anyone quotes an accuracy figure.');
  L.push('- A match rate on labels the same team wrote mostly shows the code does what the team intended. It does **not** show the rules are clinically right.');
  L.push('- "Under-triage" means the engine is LESS urgent than the label. That is the dangerous direction and the number that matters most.', '');
  L.push('## Results', '');
  L.push(`| | Cases |`, '|---|---|', `| Cases in the set | ${s.total} |`, `| Scored (excluding known gaps) | ${s.scored} |`, `| Known gaps listed separately | ${s.gaps} |`);
  L.push(`| Exact match | ${s.match} (${pct(s.exactRate)}) |`, `| Under-triage (engine less urgent) | ${s.under} (${pct(s.underRate)}) |`, `| Over-triage (engine more urgent) | ${s.over} (${pct(s.overRate)}) |`, `| Within one tier | ${s.withinOne} (${pct(s.withinOne / (s.scored || 1))}) |`, '');
  L.push('### By group', '', '| Group | Cases | Match | Under | Over |', '|---|---|---|---|---|');
  for (const [g, v] of Object.entries(s.byGroup)) L.push(`| ${g.replace(/_/g, ' ')} | ${v.n} | ${v.match} | ${v.under} | ${v.over} |`);
  L.push('', '### Expected tier to engine tier (all cases, gaps included)', '', '| Expected -> engine | Cases |', '|---|---|');
  for (const k of Object.keys(s.confusion).sort()) L.push(`| ${k.replace('->', ' -> ')} | ${s.confusion[k]} |`);

  const gaps = s.results.filter(r => r.gapNote);
  L.push('', '## Known gaps for clinical review', '', 'These are situations where the draft rules do not cover the case, or cover it less urgently than the team\'s own judgement. Each is a decision for a clinician, not a bug to quietly patch.', '');
  L.push('| Case | Situation | Label | Engine | Why |', '|---|---|---|---|---|');
  for (const r of gaps) L.push(`| ${r.case.id} | ${r.case.text} | T${r.case.expected} | T${r.tier} ${r.verdict === 'match' ? '(agrees)' : r.verdict === 'under' ? '(LESS urgent)' : '(more urgent)'} | ${r.case.source} |`);

  const off = s.results.filter(r => !r.gapNote && r.verdict !== 'match');
  L.push('', '## Disagreements outside the known gaps', '');
  if (off.length === 0) L.push('None.'); else { L.push('| Case | Situation | Label | Engine | Layer |', '|---|---|---|---|---|'); for (const r of off) L.push(`| ${r.case.id} | ${r.case.text} | T${r.case.expected} | T${r.tier} | ${r.winning} |`); }

  L.push('', '## Properties checked on random inputs', '', `${inv.runs} random inputs (fixed seed). For each: the same input gives the same answer; tier and colour agree; adding a danger sign never makes the result less urgent; an outside hint never makes it less urgent; the "could be" tier is always more urgent than the tier and at most one step above.`, '');
  L.push(inv.failures.length === 0 ? '**No violations.**' : `**${inv.failures.length} violation(s):** ${[...new Set(inv.failures.map(f => f.invariant))].join('; ')}`);

  if (proposed) {
    const ps = proposed.summary; const closed = s.results.filter(x => x.gapNote && ps.results.find(y => y.case.id === x.case.id && !y.gapNote && y.verdict === 'match'));
    L.push('', `## Proposed v${proposed.version}: what it would change`, '', 'Not in use and not approved. The database still holds the version above. This compares the two on the same cases so a clinician can see what each addition does.', '');
    L.push('| | v' + ruleSet.version + ' | v' + proposed.version + ' |', '|---|---|---|', `| Scored cases | ${s.scored} | ${ps.scored} |`, `| Known gaps | ${s.gaps} | ${ps.gaps} |`, `| Under-triage among scored | ${s.under} | ${ps.under} |`, `| Over-triage among scored | ${s.over} | ${ps.over} |`);
    L.push('', `Gaps the proposal closes (${closed.length}): ${closed.map(x => x.case.id + ' ' + x.case.text).join('; ') || 'none'}.`);
    const still = ps.results.filter(x => x.gapNote);
    L.push('', `Gaps still open in the proposal (${still.length}), each needing a clinical decision: ${still.map(x => x.case.id + ' ' + x.case.text).join('; ') || 'none'}.`);
    L.push('', proposed.invariants.failures.length === 0 ? `Properties on ${proposed.invariants.runs} random inputs: no violations.` : `Properties: ${proposed.invariants.failures.length} violation(s).`);
  }

  if (ocr) {
    const p = (a: number, b: number) => (b === 0 ? 'n/a' : `${(a / b * 100).toFixed(1)}%`);
    L.push('', '## Reading lab reports (synthetic)', '', `${ocr.reports} invented reports with ${ocr.expected} known results, made as PDFs with a text layer in four printed layouts, read by the real text reader and line parser. This measures the parser on clean text. It does NOT measure reading a photo or a scan, which depends on the picture and on the OCR language files.`, '');
    L.push('| Measure | Result |', '|---|---|', `| Results found | ${ocr.found} of ${ocr.expected} (${p(ocr.found, ocr.expected)}) |`, `| Number exactly right | ${p(ocr.valueCorrect, ocr.expected)} of all expected |`, `| Unit right (of those found) | ${p(ocr.unitCorrect, ocr.found)} |`, `| Printed flag copied right (of those found) | ${p(ocr.flagCorrect, ocr.found)} |`, `| Extra rows that were not results | ${ocr.extra} (${(ocr.extra / ocr.reports).toFixed(2)} per report) |`);
    L.push('', 'By layout, share of expected numbers exactly right: ' + Object.entries(ocr.byLayout).map(([l, g]) => `${l} ${p(g.valueCorrect, g.expected)}`).join(', ') + '.');
  }

  if (perf.length) {
    L.push('', '## Speed', '', 'Measured on the machine that generated this file, with no database and no network (see the note under each). They show the code is not the bottleneck; they are not a capacity promise for a hospital deployment.', '', '| Measurement | Count | Time | Per item |', '|---|---|---|---|');
    for (const p of perf) L.push(`| ${p.label}${p.note ? ` (${p.note})` : ''} | ${p.n} | ${p.ms.toFixed(0)} ms | ${(p.ms / p.n * 1000).toFixed(1)} µs |`);
  }
  L.push('', '## What this does not tell you', '', '- Whether the rules are clinically correct. That needs a clinician and real, de-identified cases from your own facilities.', '- How the system behaves with a real database under load. The speed numbers above leave the database out.', '- Anything about how well people use the screens.', '');
  return L.join('\n');
}
