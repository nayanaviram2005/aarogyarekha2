import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { NOTICE_TEXT } from '../components/ConsentForm';
import { Banner } from '../components/Provenance';
import { blankRow, isBlank, processRow, rowProblem, type CampRow } from '../lib/camp';
import { LANGUAGES } from '../lib/format';
import { PaneFrame } from './PaneFrame';
import { useQueue } from './queueContext';

let counter = 0;
const newRow = () => blankRow(`r${++counter}`);

export function CampBatchPage() {
  return <PaneFrame startOn="note" center={<Camp />} context={<div style={{ padding: 16 }}><p className="small muted">Camp registration saves each person one at a time: register, consent, visit, temperature, queue. A person without recorded consent is not saved.</p></div>} />;
}

function Camp() {
  const { api } = useAuth();
  const queue = useQueue();
  const [rows, setRows] = useState<CampRow[]>(() => Array.from({ length: 5 }, newRow));
  const [witness, setWitness] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef(rows); latest.current = rows;

  const patch = (key: string, p: Partial<CampRow>) => setRows(r => r.map(x => (x.key === key ? { ...x, ...p } : x)));
  const todo = rows.filter(r => !isBlank(r) && r.status !== 'done');
  const doneCount = rows.filter(r => r.status === 'done').length;

  async function saveAll() {
    if (!api || busy) return;
    setBusy(true);
    for (const r of latest.current.filter(x => !isBlank(x) && x.status !== 'done')) {
      patch(r.key, { status: 'run', message: undefined });
      const out = await processRow(api, latest.current.find(x => x.key === r.key)!, witness);
      patch(r.key, out);
    }
    setBusy(false); void queue.refresh();
  }

  const problemsNow = todo.map(r => ({ r, p: rowProblem(r, witness) })).filter(x => x.p);

  return (
    <>
      <header><h2>Camp registration</h2><p className="muted small">Register and queue many people in one sitting. {doneCount > 0 && <strong>{doneCount} saved.</strong>}</p></header>

      <section className="block" aria-label="Consent">
        <div className="block__head"><h3>Consent</h3></div>
        <div className="block__body">
          <p className="small">Read this to each person, or their guardian, before ticking their consent box.</p>
          <blockquote style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--rule-strong)', background: 'var(--paper)' }}>{NOTICE_TEXT}</blockquote>
          <p className="tiny muted">Draft wording. Have it reviewed before use with real patients.</p>
          <div className="field" style={{ maxWidth: 320 }}><label htmlFor="camp-witness">Witness name (for all spoken consents in this sitting)</label><input id="camp-witness" className="input" value={witness} onChange={e => setWitness(e.target.value)} maxLength={120} disabled={busy} /></div>
        </div>
      </section>

      <section className="block" aria-label="People">
        <div className="block__head"><h3>People</h3></div>
        <div className="block__body block__body--flush" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Name</th><th>Sex</th><th>Age</th><th>Language</th><th>Complaint</th><th>Temp °C</th><th>Consent</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const locked = busy || r.status === 'done';
                return (
                  <tr key={r.key}>
                    <td><input aria-label={`Name, row ${i + 1}`} className="input" value={r.name} onChange={e => patch(r.key, { name: e.target.value })} disabled={locked} maxLength={120} /></td>
                    <td><select aria-label={`Sex, row ${i + 1}`} className="select" value={r.sex} onChange={e => patch(r.key, { sex: e.target.value as CampRow['sex'] })} disabled={locked}><option value="unknown">Not stated</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></td>
                    <td><input aria-label={`Age, row ${i + 1}`} className="input" inputMode="numeric" style={{ width: 64 }} value={r.age} onChange={e => patch(r.key, { age: e.target.value })} disabled={locked} /></td>
                    <td><select aria-label={`Language, row ${i + 1}`} className="select" value={r.language} onChange={e => patch(r.key, { language: e.target.value })} disabled={locked}>{LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></td>
                    <td><input aria-label={`Complaint, row ${i + 1}`} className="input" lang={r.language} value={r.complaint} onChange={e => patch(r.key, { complaint: e.target.value })} disabled={locked} maxLength={2000} /></td>
                    <td><input aria-label={`Temperature, row ${i + 1}`} className="input" inputMode="decimal" style={{ width: 72 }} value={r.temperature} onChange={e => patch(r.key, { temperature: e.target.value })} disabled={locked} /></td>
                    <td><label className="small"><input type="checkbox" aria-label={`Consent given, row ${i + 1}`} checked={r.consented} onChange={e => patch(r.key, { consented: e.target.checked })} disabled={locked} /> Read and agreed</label>
                      <label className="tiny" style={{ display: 'block' }}><input type="checkbox" aria-label={`Anonymous training copy agreed, row ${i + 1}`} checked={!!r.training} onChange={e => patch(r.key, { training: e.target.checked })} disabled={locked || !r.consented} /> Also agrees to an anonymous training copy</label></td>
                    <td className="small" aria-live="polite">
                      {r.status === 'run' && 'Saving…'}
                      {r.status === 'done' && <span>{r.message}{r.encounterId && <> <Link to={`/encounters/${r.encounterId}`}>Open</Link></>}</span>}
                      {r.status === 'fail' && <span role="alert">{r.message}</span>}
                      {r.status === 'duplicate' && (
                        <span role="alert">{r.message} {r.duplicates?.map(d => `${d.fullName} (${d.publicRef})`).join(', ')}{' '}
                          <label><input type="checkbox" aria-label={`Different person, row ${i + 1}`} checked={r.notDuplicate} onChange={e => patch(r.key, { notDuplicate: e.target.checked, status: e.target.checked ? 'todo' : 'duplicate' })} /> Different person</label></span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn--small" onClick={() => setRows(r => [...r, ...Array.from({ length: 5 }, newRow)])} disabled={busy}>Add 5 rows</button>
        <button type="button" className="btn btn--primary" onClick={() => void saveAll()} disabled={busy || todo.length === 0 || !api}>{busy ? 'Saving…' : `Save ${todo.length} ${todo.length === 1 ? 'person' : 'people'}`}</button>
        {!busy && problemsNow.length > 0 && <span className="small muted">{problemsNow.length} still need something before they can be saved. They will be marked when you press Save.</span>}
      </div>
      {doneCount > 0 && <Banner kind="info">Saved people are in the queue. Rows that failed keep what you typed; press Save again to continue from where each stopped.</Banner>}
    </>
  );
}
