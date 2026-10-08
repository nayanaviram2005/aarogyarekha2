// Runs the evaluation and a speed check, and writes docs/EVALUATION.md.   npm --prefix aarogyarekha2-backend run eval:report
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import type { Deps, QueueEntry } from '../src/deps.js';
import { sortQueue } from '../src/queue/sort.js';
import { triage } from '../src/triage/engine.js';
import { RULESET_DRAFT } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED } from '../src/triage/ruleset.proposed.js';
import { checkInvariants, evaluate, randomInput } from '../src/eval/run.js';
import { renderReport, type PerfResult } from '../src/eval/report.js';
import { makeCorpus, scoreCorpus } from '../src/eval/ocrCorpus.js';

const summary = evaluate(RULESET_DRAFT);
const inv = checkInvariants(RULESET_DRAFT, 5000);
const perf: PerfResult[] = [];
const time = async (label: string, n: number, f: () => Promise<void> | void, note?: string) => { const t = performance.now(); await f(); perf.push({ label, n, ms: performance.now() - t, note }); };

let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const inputs = Array.from({ length: 20000 }, () => randomInput(rnd));
await time('Triage engine, one assessment each', inputs.length, () => { for (const i of inputs) triage(i, RULESET_DRAFT); });

const entries: QueueEntry[] = Array.from({ length: 5000 }, (_, i) => ({ encounterId: randomUUID(), patient: { id: 'p', public_ref: 'AR', full_name: 'x', sex: 'unknown', birth_date: null, age_years_reported: 30, preferred_language: 'en' }, scenario: 'opd_queue', chiefComplaint: null, chiefComplaintTranslated: null, assessed: i % 9 !== 0, urgencyCode: 'yellow', tier: 1 + (i % 4), potentialTier: null, missingCount: 0, winningLabel: null, vulnerable: false, queueStatus: 'waiting', waitingSince: new Date(Date.now() - i * 1000).toISOString(), assessmentVersion: 1, engineTier: 1 + (i % 4), reviewed: false }));
await time('Sort a queue of 5,000 people', entries.length, () => { sortQueue(entries); }, 'one sort');

// The HTTP layer with in-memory stand-ins for the database: measures routing, sign-in check, validation and logging only.
const deps = { verifyToken: async () => ({ userId: 'u', aal: 'aal2' as const }), userReader: () => ({ getMe: async () => ({ displayName: null, memberships: [] }) }), audit: async () => {} } as unknown as Deps;
process.env.LOG_LEVEL = 'silent';
const app = await buildApp({ allowedOrigins: [] }, deps);
const reqs = 3000; const conc = 50;
await time('HTTP GET /me, 50 at a time', reqs, async () => {
  let next = 0;
  // each request pretends to come from a different address, so the server's per-address rate limit does not answer for it
  await Promise.all(Array.from({ length: conc }, async () => { while (next < reqs) { const i = next++; const r = await app.inject({ method: 'GET', url: '/me', remoteAddress: `10.${(i >> 8) & 255}.${i & 255}.1`, headers: { authorization: 'Bearer t' } }); if (r.statusCode !== 200) throw new Error('unexpected ' + r.statusCode); } }));
}, 'in-memory stand-ins, so only routing, sign-in check and logging');
await app.close();

const proposed = { version: RULESET_PROPOSED.version, summary: evaluate(RULESET_PROPOSED), invariants: checkInvariants(RULESET_PROPOSED, 5000) };
const ocr = await scoreCorpus(makeCorpus(100, 11));
const md = renderReport(summary, inv, perf, { name: RULESET_DRAFT.name, version: RULESET_DRAFT.version, status: RULESET_DRAFT.status }, new Date(), proposed, ocr);
const out = resolve(import.meta.dirname, '..', '..', 'docs', 'EVALUATION.md');
writeFileSync(out, md);
console.log(`cases ${summary.total}, scored ${summary.scored}, gaps ${summary.gaps}, match ${summary.match}, under ${summary.under}, over ${summary.over}; invariant violations ${inv.failures.length}`);
console.log('wrote docs/EVALUATION.md');
