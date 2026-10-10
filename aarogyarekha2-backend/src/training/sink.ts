import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { csvColumns, csvRow, type TrainingCase } from './deidentify.js';

export interface TrainingSink { key(): Promise<string>; write(c: TrainingCase): Promise<void> }

const README = [
  'Anonymised triage training cases. Synthetic or consented data only.',
  '',
  'triage-cases.jsonl  one case per line: features, the engine output, the clinician-confirmed priority, and a de-identified FHIR R4 bundle.',
  'triage-cases.csv    the same cases as one flat row each.',
  '.pseudonym-key      secret used to make case and clinician ids. Never commit or share it. Deleting it makes new ids unlinkable to old ones.',
  '',
  'A case is written only after a nurse or doctor signs off, and only when the patient agreed to an anonymous copy being used to train the triage tool.',
  'Names, phone numbers, addresses, dates, facility names and clinician names are removed or replaced.',
  'Do not commit .pseudonym-key. The cases themselves are anonymised and can be shared.',
  '',
].join('\n');

const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function makeFileSink(dir: string): TrainingSink {
  let keyPromise: Promise<string> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const ensure = async () => {
    await mkdir(dir, { recursive: true });
    const readme = join(dir, 'README.txt');
    if (!(await stat(readme).catch(() => null))) await writeFile(readme, README, 'utf8');
  };

  const key = () => (keyPromise ??= (async () => {
    await ensure();
    const file = join(dir, '.pseudonym-key');
    const existing = await readFile(file, 'utf8').catch(() => '');
    if (existing.trim().length >= 32) return existing.trim();
    const fresh = randomBytes(32).toString('hex');
    await writeFile(file, fresh, { encoding: 'utf8', mode: 0o600 });
    return fresh;
  })());

  const write = (c: TrainingCase) => {
    const job = chain.then(async () => {
      await ensure();
      await appendFile(join(dir, 'triage-cases.jsonl'), JSON.stringify(c) + '\n', 'utf8');
      const csv = join(dir, 'triage-cases.csv');
      const row = csvRow(c);
      const header = (await stat(csv).catch(() => null)) ? '' : csvColumns.join(',') + '\n';
      await appendFile(csv, header + csvColumns.map(k => cell(row[k])).join(',') + '\n', 'utf8');
    });
    chain = job.catch(() => undefined);
    return job;
  };

  return { key, write };
}
