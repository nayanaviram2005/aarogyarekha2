export interface LabPoint {
  name: string; valueNum: number | null; valueText: string | null; unit: string | null;
  printedFlag: string | null; verified: boolean; at: string; documentId: string; encounterId: string;
}

export interface LabTrendPoint { at: string; value: number | null; text: string | null; flag: string | null; verified: boolean; documentId: string; encounterId: string }
export interface LabTrend {
  name: string; label: string; unit: string | null; points: LabTrendPoint[];
  change: null | { from: number; to: number; direction: 'up' | 'down' | 'same'; unit: string | null };
  unitsDiffer: boolean;
}
export interface LabTrends { tests: LabTrend[]; rows: number; unverified: number; visits: number }

const label = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function shapeLabTrends(points: LabPoint[]): LabTrends {
  const by = new Map<string, LabPoint[]>();
  for (const p of points) { const l = by.get(p.name); if (l) l.push(p); else by.set(p.name, [p]); }
  const tests: LabTrend[] = [...by.entries()].map(([name, list]) => {
    const sorted = [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const numeric = sorted.filter(p => p.valueNum !== null);
    const units = new Set(numeric.map(p => (p.unit ?? '').trim().toLowerCase()));
    const unitsDiffer = units.size > 1;
    let change: LabTrend['change'] = null;
    if (numeric.length >= 2 && !unitsDiffer) {
      const a = numeric[numeric.length - 2]!, b = numeric[numeric.length - 1]!;
      change = { from: a.valueNum!, to: b.valueNum!, direction: b.valueNum! > a.valueNum! ? 'up' : b.valueNum! < a.valueNum! ? 'down' : 'same', unit: b.unit };
    }
    return {
      name, label: label(name), unit: [...sorted].reverse().find(p => p.unit)?.unit ?? null, unitsDiffer, change,
      points: sorted.map(p => ({ at: p.at, value: p.valueNum, text: p.valueText, flag: p.printedFlag, verified: p.verified, documentId: p.documentId, encounterId: p.encounterId })),
    };
  });
  tests.sort((a, b) => Number(b.points.filter(p => p.value !== null).length >= 2) - Number(a.points.filter(p => p.value !== null).length >= 2) || a.label.localeCompare(b.label));
  return { tests, rows: points.length, unverified: points.filter(p => !p.verified).length, visits: new Set(points.map(p => p.encounterId)).size };
}
