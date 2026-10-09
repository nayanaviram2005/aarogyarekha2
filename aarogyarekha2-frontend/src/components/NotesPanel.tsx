import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatTime } from '../lib/format';
import type { Api, NoteKind, ReviewerNote } from '../lib/types';
import { Banner } from './Provenance';

const KIND_LABEL: Record<NoteKind, string> = { comment: 'Note', escalation: 'Needs a senior look', feedback_up: 'Assessment was helpful', feedback_down: 'Assessment was not helpful' };

export function NotesPanel({ api, encounterId, assessmentId, canWrite, disabled }: { api: Api; encounterId: string; assessmentId: string | null; canWrite: boolean; disabled?: boolean }) {
  const [notes, setNotes] = useState<ReviewerNote[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [kind, setKind] = useState<'comment' | 'escalation'>('comment');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [why, setWhy] = useState('');

  const load = useCallback(async () => { try { setNotes(await api.notes(encounterId)); setError(null); } catch (e) { setError(e as Error); setNotes([]); } }, [api, encounterId]);
  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<unknown>) { setBusy(true); setError(null); try { await work(); await load(); } catch (e) { setError(e as Error); } finally { setBusy(false); } }
  function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setError(new Error(kind === 'escalation' ? 'Say why this needs a senior look.' : 'Write the note.')); return; }
    void run(async () => { await api.addNote(encounterId, { kind, body: text.trim() }); setText(''); });
  }
  const mine = (n: ReviewerNote) => assessmentId !== null && n.assessmentId === assessmentId;
  const rated = (notes ?? []).some(n => (n.kind === 'feedback_up' || n.kind === 'feedback_down') && mine(n));
  const escalations = (notes ?? []).filter(n => n.kind === 'escalation');

  return (
    <section className="block" aria-label="Reviewer notes">
      <div className="block__head"><h3>Reviewer notes</h3></div>
      <div className="block__body">
        <p className="tiny muted">Notes do not change the priority. To change it, use Change priority above.</p>
        {error && <Banner kind="error" title="Notes">{error.message}</Banner>}
        {escalations.length > 0 && <Banner kind="warn" title="Escalated for a senior look">{escalations.map(n => n.body).join(' / ')}</Banner>}
        {notes === null && <p className="small muted" role="status">Loading…</p>}
        {notes && notes.length === 0 && !error && <p className="small muted">No notes yet.</p>}
        <ul>
          {(notes ?? []).map(n => (
            <li key={n.id} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--rule)' }}>
              <strong>{KIND_LABEL[n.kind]}</strong> · {n.author ?? 'A reviewer'} · {formatTime(n.at)}{n.body && <span style={{ display: 'block' }}>{n.body}</span>}
            </li>
          ))}
        </ul>
        {canWrite && !disabled && (
          <>
            <form onSubmit={add} noValidate style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="field"><label htmlFor="note-kind">Add</label>
                <select id="note-kind" className="select" value={kind} onChange={e => setKind(e.target.value as 'comment' | 'escalation')} disabled={busy}><option value="comment">A note</option><option value="escalation">Ask for a senior look</option></select></div>
              <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="note-text">{kind === 'escalation' ? 'Why does this need a senior look?' : 'Note'}</label><input id="note-text" className="input" value={text} onChange={e => setText(e.target.value)} maxLength={1000} disabled={busy} /></div>
              <button className="btn btn--small" type="submit" disabled={busy}>Add</button>
            </form>
            {assessmentId && !rated && (
              <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 8, marginTop: 8 }}>
                <p className="small strong">Was this draft assessment helpful?</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="btn btn--small" disabled={busy} onClick={() => void run(() => api.addNote(encounterId, { kind: 'feedback_up', assessmentId }))}>Helpful</button>
                  <button type="button" className="btn btn--small" disabled={busy} onClick={() => setWrong(true)}>Not helpful</button>
                </div>
                {wrong && (
                  <div className="field" style={{ marginTop: 8 }}><label htmlFor="fb-why">What was wrong or missing? (optional)</label><input id="fb-why" className="input" value={why} onChange={e => setWhy(e.target.value)} maxLength={1000} disabled={busy} />
                    <button type="button" className="btn btn--small" disabled={busy} onClick={() => void run(async () => { await api.addNote(encounterId, { kind: 'feedback_down', assessmentId, ...(why.trim() ? { body: why.trim() } : {}) }); setWrong(false); setWhy(''); })}>Send feedback</button></div>
                )}
              </div>
            )}
            {rated && <p className="tiny muted">Thank you. Feedback for this assessment is recorded.</p>}
          </>
        )}
      </div>
    </section>
  );
}
