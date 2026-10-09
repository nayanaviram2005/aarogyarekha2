import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatTime } from '../lib/format';
import type { Api, HistoryEntry, HistoryKind } from '../lib/types';
import { Banner } from './Provenance';

const KIND: Record<HistoryKind, string> = { allergy: 'Allergies', medication: 'Medicines being taken', reported_condition: 'Conditions reported', family_history: 'Family history', occupational_exposure: 'Work exposures', immunisation: 'Immunisations', other: 'Other' };
const ORDER: HistoryKind[] = ['allergy', 'medication', 'reported_condition', 'family_history', 'occupational_exposure', 'immunisation', 'other'];

export function HistoryPanel({ api, patientId, editable, canConfirm, defaultLanguage }: { api: Api; patientId: string; editable: boolean; canConfirm: boolean; defaultLanguage: string }) {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [kind, setKind] = useState<HistoryKind>('allergy');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setRows(await api.history(patientId)); setError(null); } catch (e) { setError(e as Error); setRows([]); } }, [api, patientId]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setError(new Error('Type what was reported.')); return; }
    setBusy(true); setError(null);
    try { await api.addHistory(patientId, { kind, text: text.trim(), lang: defaultLanguage }); setText(''); await load(); } catch (err) { setError(err as Error); } finally { setBusy(false); }
  }
  async function confirm(id: string) {
    setBusy(true); setError(null);
    try { await api.confirmHistory(id); await load(); } catch (err) { setError(err as Error); } finally { setBusy(false); }
  }

  const byKind = (k: HistoryKind) => (rows ?? []).filter(r => r.kind === k);
  const allergies = byKind('allergy');

  return (
    <section className="block" aria-label="Medical history as reported">
      <div className="block__head"><h3>History as reported</h3></div>
      <div className="block__body">
        <p className="tiny muted">Written down as told. The system does not advise on any medicine, dose or allergy.</p>
        {error && <Banner kind="error" title="History">{error.message}</Banner>}
        {rows === null && <p className="small muted" role="status">Loading…</p>}
        {rows && allergies.length > 0 && <Banner kind="warn" title="Reported allergies">{allergies.map(a => a.text).join('; ')}</Banner>}
        {rows && rows.length === 0 && !error && <p className="small muted">Nothing recorded yet.</p>}
        {rows && ORDER.filter(k => byKind(k).length > 0).map(k => (
          <div key={k}>
            <p className="small strong">{KIND[k]}</p>
            <ul>
              {byKind(k).map(r => (
                <li key={r.id} className="small" style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span lang={r.lang ?? undefined}>{r.text}</span>
                  {r.confirmed ? <span className="chip chip--ok">Confirmed by {r.confirmedBy ?? 'staff'}{r.confirmedAt ? `, ${formatTime(r.confirmedAt)}` : ''}</span> : <span className="chip">Reported, not confirmed</span>}
                  {canConfirm && !r.confirmed && <button type="button" className="btn btn--small btn--quiet" onClick={() => void confirm(r.id)} disabled={busy}>Confirm</button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {editable && (
          <form onSubmit={add} noValidate style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--rule)', paddingTop: 8 }}>
            <div className="field"><label htmlFor="hx-kind">Add to history</label>
              <select id="hx-kind" className="select" value={kind} onChange={e => setKind(e.target.value as HistoryKind)} disabled={busy}>{ORDER.map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select></div>
            <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="hx-text">As told</label><input id="hx-text" className="input" value={text} onChange={e => setText(e.target.value)} maxLength={500} disabled={busy} /></div>
            <button className="btn btn--small" type="submit" disabled={busy}>Add</button>
          </form>
        )}
      </div>
    </section>
  );
}
