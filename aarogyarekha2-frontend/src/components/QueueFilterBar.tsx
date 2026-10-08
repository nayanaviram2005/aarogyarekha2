import { languageLabel, scenarioLabel } from '../lib/format';
import { isFiltering, NO_FILTER, queueFacets, type QueueFilter } from '../lib/queueFilter';
import type { QueueEntry } from '../lib/types';

const RISKS: { key: number | 'none'; label: string }[] = [{ key: 1, label: 'Immediate' }, { key: 2, label: 'Very urgent' }, { key: 3, label: 'Urgent' }, { key: 4, label: 'Routine' }, { key: 'none', label: 'Not assessed' }];
const WAITS = [[0, 'Any wait'], [30, '30 minutes or more'], [60, '1 hour or more'], [120, '2 hours or more'], [180, '3 hours or more']] as const;

/** Narrows the list on this screen. It never changes the order or anyone's priority. */
export function QueueFilterBar({ entries, value, onChange, facilityNames, shown }: { entries: QueueEntry[]; value: QueueFilter; onChange: (f: QueueFilter) => void; facilityNames: Record<string, string>; shown: number }) {
  const { scenarios, languages, facilityIds } = queueFacets(entries);
  const toggle = (k: number | 'none') => { const s = new Set(value.tiers); if (s.has(k)) s.delete(k); else s.add(k); onChange({ ...value, tiers: s }); };
  const active = isFiltering(value);
  return (
    <details className="qfilter" open={active || undefined}>
      <summary>Filter{active ? ` (showing ${shown} of ${entries.length})` : ''}</summary>
      <div className="qfilter__body">
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="tiny strong">Risk</legend>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {RISKS.map(r => <label key={String(r.key)} className="small"><input type="checkbox" checked={value.tiers.has(r.key)} onChange={() => toggle(r.key)} /> {r.label}</label>)}
          </div>
        </fieldset>
        <div className="field"><label htmlFor="qf-sc">Type of visit</label>
          <select id="qf-sc" className="select" value={value.scenario} onChange={e => onChange({ ...value, scenario: e.target.value })}><option value="">All</option>{scenarios.map(s => <option key={s} value={s}>{scenarioLabel(s)}</option>)}</select></div>
        <div className="field"><label htmlFor="qf-lg">Language</label>
          <select id="qf-lg" className="select" value={value.language} onChange={e => onChange({ ...value, language: e.target.value })}><option value="">All</option>{languages.map(l => <option key={l} value={l}>{languageLabel(l)}</option>)}</select></div>
        {facilityIds.length > 1 && <div className="field"><label htmlFor="qf-fc">Facility</label>
          <select id="qf-fc" className="select" value={value.facilityId} onChange={e => onChange({ ...value, facilityId: e.target.value })}><option value="">All</option>{facilityIds.map(f => <option key={f} value={f}>{facilityNames[f] ?? f.slice(0, 8)}</option>)}</select></div>}
        <div className="field"><label htmlFor="qf-w">Waiting</label>
          <select id="qf-w" className="select" value={value.minWaitMinutes} onChange={e => onChange({ ...value, minWaitMinutes: Number(e.target.value) })}>{WAITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        {active && <button type="button" className="btn btn--small btn--quiet" onClick={() => onChange(NO_FILTER)}>Clear filters</button>}
      </div>
    </details>
  );
}
