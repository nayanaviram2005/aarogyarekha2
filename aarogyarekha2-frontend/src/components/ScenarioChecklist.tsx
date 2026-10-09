import { useState } from 'react';
import { noteFor, scenarioChecklist, type ChecklistRow } from '../lib/scenarioTemplates';
import { scenarioLabel } from '../lib/format';
import type { Api, EncounterSummary } from '../lib/types';
import { Banner } from './Provenance';

export function ScenarioChecklist({ api, summary, editable, onChanged }: { api: Api; summary: EncounterSummary; editable: boolean; onChanged: () => void }) {
  const rows = scenarioChecklist(summary.encounter.scenario, summary);
  const [open, setOpen] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  if (rows.length === 0) return null;
  const missing = rows.filter(r => !r.done).length;

  async function save(r: ChecklistRow) {
    if (!r.field || !value.trim()) return;
    setBusy(true); setError(null);
    try { await api.addSymptom(summary.encounter.id, { text: noteFor(r.field, value), lang: summary.encounter.language }); setOpen(null); setValue(''); onChanged(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }

  return (
    <section className="block" aria-label="Checklist for this type of visit">
      <div className="block__head"><h3>{scenarioLabel(summary.encounter.scenario)}: checklist</h3></div>
      <div className="block__body">
        <p className="tiny muted">{missing === 0 ? 'Everything usually asked for this type of visit is recorded.' : `${missing} still not recorded.`} This does not change the priority.</p>
        {error && <Banner kind="error">{error.message}</Banner>}
        <ul>
          {rows.map(r => (
            <li key={r.key} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0' }}>
              <span aria-hidden="true">{r.done ? '✓' : '○'}</span>
              <span>{r.label}</span>
              <span className={r.done ? 'chip chip--ok' : 'chip'}>{r.done ? 'Recorded' : 'Not recorded'}</span>
              {editable && !r.done && r.field && open !== r.key && <button type="button" className="btn btn--small btn--quiet" onClick={() => { setOpen(r.key); setValue(''); }}>Add</button>}
              {open === r.key && r.field && (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.field.options
                    ? <select aria-label={r.label} className="select" value={value} onChange={e => setValue(e.target.value)}><option value="">Choose</option>{r.field.options.map(o => <option key={o}>{o}</option>)}</select>
                    : <input aria-label={r.label} className="input" value={value} onChange={e => setValue(e.target.value)} maxLength={300} />}
                  <button type="button" className="btn btn--small" onClick={() => void save(r)} disabled={busy || !value.trim()}>Save</button>
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setOpen(null)} disabled={busy}>Cancel</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {editable && rows.some(r => !r.done && r.source === 'vital') && <p className="tiny muted">Measurements are added from the measurements form below.</p>}
      </div>
    </section>
  );
}
