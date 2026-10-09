export interface ContextField { name: string; valueText: string | null; valueNum: number | null; unit: string | null; printedFlag: string | null; verified: boolean }
export interface ContextDoc { id: string; kind: string; filename: string | null; createdAt: string; status: 'completed' | 'failed' | 'pending' | 'none'; fields: ContextField[] }

const FLAG: Record<string, string> = { low: 'printed LOW', high: 'printed HIGH', critical_low: 'printed CRITICAL LOW', critical_high: 'printed CRITICAL HIGH', abnormal: 'printed abnormal' };
export const flagText = (f: string | null): string | null => (f ? FLAG[f] ?? null : null);
const value = (f: ContextField) => `${f.valueText ?? (f.valueNum !== null ? String(f.valueNum) : '?')}${f.unit ? ` ${f.unit}` : ''}`;

export interface RecordSummary { documents: number; read: number; rows: number; verified: number; flagged: number; lines: string[]; notRead: number }

export function summariseRecords(docs: ContextDoc[]): RecordSummary {
  const all = docs.flatMap(d => d.fields);
  const flagged = all.filter(f => flagText(f.printedFlag));
  const lines: string[] = [];
  for (const f of flagged.slice(0, 12)) lines.push(`${f.name} ${value(f)} (${flagText(f.printedFlag)}${f.verified ? '' : ', not yet checked by a person'})`);
  return {
    documents: docs.length, read: docs.filter(d => d.status === 'completed' && d.fields.length > 0).length, notRead: docs.filter(d => d.status !== 'completed' || d.fields.length === 0).length,
    rows: all.length, verified: all.filter(f => f.verified).length, flagged: flagged.length, lines,
  };
}

export function reportNotes(docs: ContextDoc[]): string[] {
  const rows = docs.flatMap(d => d.fields).filter(f => f.verified);
  const sorted = [...rows.filter(f => flagText(f.printedFlag)), ...rows.filter(f => !flagText(f.printedFlag))];
  return sorted.slice(0, 10).map(f => `${f.name} ${value(f)}${flagText(f.printedFlag) ? ` (${flagText(f.printedFlag)})` : ''}`);
}
