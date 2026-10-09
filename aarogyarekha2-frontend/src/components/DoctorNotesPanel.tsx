import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatTime } from '../lib/format';
import type { Api, ReviewerNote } from '../lib/types';
import { Banner } from './Provenance';

const SIGNED_OFF = ['reviewed', 'referred', 'closed'];
const MAX = 2000;

export function DoctorNotesPanel({ api, encounterId, status, canWrite, disabled }: { api: Api; encounterId: string; status: string; canWrite: boolean; disabled?: boolean }) {
  const [notes, setNotes] = useState<ReviewerNote[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try { setNotes((await api.notes(encounterId)).filter(n => n.kind === 'doctor_note')); setError(null); } catch (e) { setError(e as Error); setNotes([]); }
  }, [api, encounterId]);
  useEffect(() => { void load(); }, [load]);

  const signedOff = SIGNED_OFF.includes(status);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setError(new Error('Write the doctor’s note.')); return; }
    setBusy(true); setError(null); setDone(false);
    try { await api.addNote(encounterId, { kind: 'doctor_note', body: text.trim() }); setText(''); setDone(true); await load(); } catch (err) { setError(err as Error); } finally { setBusy(false); }
  }

  return (
    <section className="block" aria-label="Doctor’s notes">
      <div className="block__head"><h3>Doctor’s notes</h3></div>
      <div className="block__body">
        <p className="small muted">Treatment given, advice and follow-up. A note joins the patient’s file and can be read by a nurse or doctor who opens this record, including through emergency access. Notes cannot be edited or removed; add another note to correct one.</p>
        {error && <Banner kind="error" title="Doctor’s notes">{error.message}</Banner>}
        {notes === null && !error && <p className="small muted" role="status">Loading…</p>}
        {notes && notes.length === 0 && !error && <p className="small muted">No doctor’s notes yet.</p>}
        <ul style={{ margin: '8px 0', paddingLeft: 0, listStyle: 'none' }}>
          {(notes ?? []).map(n => (
            <li key={n.id} className="small" style={{ padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
              <strong>{n.author ?? 'A doctor'}</strong> · {formatTime(n.at)}
              <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{n.body}</span>
            </li>
          ))}
        </ul>
        {!signedOff && <p className="small muted">A doctor’s note can be added once the priority has been signed off.</p>}
        {signedOff && !canWrite && <p className="small muted">Only a doctor or medical officer at this facility can add a doctor’s note.</p>}
        {signedOff && canWrite && !disabled && (
          <form onSubmit={e => void add(e)} noValidate style={{ display: 'grid', gap: 8 }}>
            <div className="field">
              <label htmlFor="doctor-note">Doctor’s note</label>
              <textarea id="doctor-note" className="textarea" rows={4} value={text} maxLength={MAX} onChange={e => { setText(e.target.value); setDone(false); }} disabled={busy} aria-describedby="doctor-note-count" />
              <span id="doctor-note-count" className="tiny muted">{text.length} of {MAX} characters</span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add doctor’s note'}</button>
              {done && <span className="small" role="status">Added to the patient’s file.</span>}
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
