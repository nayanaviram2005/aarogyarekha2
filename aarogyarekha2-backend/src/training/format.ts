import { csvColumns, csvRow, type TrainingCase } from './deidentify.js';

const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const cell = (v: string) => `"${safe(v).replace(/"/g, '""')}"`;

export const toJsonl = (cases: TrainingCase[]): string => cases.map(c => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : '');

export function toCsv(cases: TrainingCase[]): string {
  const lines = [csvColumns.join(',')];
  for (const c of cases) { const row = csvRow(c); lines.push(csvColumns.map(k => cell(row[k])).join(',')); }
  return lines.join('\n') + '\n';
}
