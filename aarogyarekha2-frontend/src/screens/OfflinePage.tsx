import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { NOTICE_TEXT } from '../components/ConsentForm';
import { Banner } from '../components/Provenance';
import { blankRow, processRow, rowProblem, type CampRow } from '../lib/camp';
import { LANGUAGES } from '../lib/format';
import { createOutbox, idbStore, memoryStore, outboxAvailable, type Note, type Outbox } from '../offline/outbox';
import { useOnline } from '../offline/useOnline';
import { PaneFrame } from './PaneFrame';
import { useQueue } from './queueContext';

export function OfflinePage({ outbox }: { outbox?: Outbox }) {
  return <PaneFrame startOn="note" center={<Offline outbox={outbox} />} context={<div style={{ padding: 16 }}><p className="small muted">Notes are encrypted on this computer, deleted after 24 hours, and sent only when you press Send. Use your own computer login on shared computers.</p></div>} />;
}

const asRow = (n: Note): CampRow => ({ ...blankRow(n.id), ...(n.data.row as Partial<CampRow>), key: n.id });

function Offline({ outbox: given }: { outbox?: Outbox }) {
  const { api } = useAuth();
  const queue = useQueue();
  const online = useOnline();
  const available = !!given || outboxAvailable();
  const outbox = useMemo(() => given ?? (available ? createOutbox(idbStore()) : createOutbox(memoryStore())), [given, available]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState(() => blankRow('draft'));
  const [witness, setWitness] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Record<string, { text: string; ok: boolean }>>({});

  const reload = useCallback(async () => { try { setNotes(await outbox.list()); } catch { setError('Saved notes could not be read on this computer.'); } }, [outbox]);
  useEffect(() => { void reload(); }, [reload]);

  async function save() {
    const bad = rowProblem(draft, witness);
    if (bad) { setError(bad); return; }
    setError(null);
    try { await outbox.put(crypto.randomUUID(), { row: { ...draft, status: 'todo', message: undefined }, witness: witness.trim() }); setDraft(blankRow('draft')); await reload(); }
    catch { setError('The note could not be saved on this computer.'); }
  }

  async function send() {
    if (!api || busy) return;
    setBusy(true); setError(null);
    for (const n of notes) {
      const out = await processRow(api, asRow(n), String(n.data.witness ?? ''));
      if (out.status === 'done') { await outbox.remove(n.id); setMsgs(m => ({ ...m, [n.id]: { text: out.message ?? 'Sent.', ok: true } })); }
      else {
        await outbox.put(n.id, { row: { ...out, status: 'todo' }, witness: n.data.witness }).catch(() => {});      // keeps progress so a retry never registers anyone twice
        setMsgs(m => ({ ...m, [n.id]: { text: out.status === 'duplicate' ? `${out.message} ${out.duplicates?.map(d => `${d.fullName} (${d.publicRef})`).join(', ') ?? ''}` : out.message ?? 'Not sent.', ok: false } }));
      }
    }
    await reload(); setBusy(false); void queue.refresh();
  }

  async function discard(id: string) { await outbox.remove(id); await reload(); }
  async function discardAll() { await outbox.wipe(); setMsgs({}); await reload(); }

  const set = <K extends keyof CampRow>(k: K, v: CampRow[K]) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <>
      <header><h2>Offline notes</h2><p className="muted small">Take notes while the connection is down. They stay on this computer until you send them.</p></header>
      {!online && <Banner kind="warn" title="You are offline">Notes you save here are kept on this computer. Send them when the connection returns.</Banner>}
      {!available && <Banner kind="warn" title="Saving on this computer is not available">This browser cannot keep encrypted notes. They will be lost if you close or reload this page.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}

      <section className="block" aria-label="New offline note">
        <div className="block__head"><h3>New note</h3></div>
        <div className="block__body">
          <p className="small">Read the notice to the person first.</p>
          <blockquote style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--rule-strong)', background: 'var(--paper)' }}>{NOTICE_TEXT}</blockquote>
          <div className="field" style={{ maxWidth: 320 }}><label htmlFor="off-witness">Witness name</label><input id="off-witness" className="input" value={witness} onChange={e => setWitness(e.target.value)} maxLength={120} /></div>
          <div className="grid2">
            <div className="field"><label htmlFor="off-name">Name</label><input id="off-name" className="input" value={draft.name} onChange={e => set('name', e.target.value)} maxLength={120} /></div>
            <div className="field"><label htmlFor="off-age">Age in years</label><input id="off-age" className="input" inputMode="numeric" value={draft.age} onChange={e => set('age', e.target.value)} /></div>
            <div className="field"><label htmlFor="off-sex">Sex</label><select id="off-sex" className="select" value={draft.sex} onChange={e => set('sex', e.target.value as CampRow['sex'])}><option value="unknown">Not stated</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
            <div className="field"><label htmlFor="off-lang">Language</label><select id="off-lang" className="select" value={draft.language} onChange={e => set('language', e.target.value)}>{LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></div>
            <div className="field"><label htmlFor="off-temp">Temperature °C (optional)</label><input id="off-temp" className="input" inputMode="decimal" value={draft.temperature} onChange={e => set('temperature', e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="off-cc">Main complaint, in the person's words</label><textarea id="off-cc" className="textarea" lang={draft.language} value={draft.complaint} onChange={e => set('complaint', e.target.value)} maxLength={2000} /></div>
          <label className="small"><input type="checkbox" checked={draft.consented} onChange={e => set('consented', e.target.checked)} /> The notice was read to this person and they agreed</label>
          <div><button type="button" className="btn btn--primary" onClick={() => void save()}>Save on this computer</button></div>
        </div>
      </section>

      <section className="block" aria-label="Saved notes">
        <div className="block__head"><h3>Saved on this computer ({notes.length})</h3></div>
        <div className="block__body">
          {notes.length === 0 && <p className="small muted">Nothing saved.</p>}
          <ul>
            {notes.map(n => {
              const r = asRow(n); const m = msgs[n.id];
              return (
                <li key={n.id} style={{ borderTop: '1px solid var(--rule)', padding: '8px 0' }}>
                  <p className="small"><strong>{r.name}</strong>, {r.age} years · saved {new Date(n.savedAt).toLocaleString('en-IN')}</p>
                  {m && <p className="small" role={m.ok ? 'status' : 'alert'}>{m.text}</p>}
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => void discard(n.id)} disabled={busy}>Discard</button>
                </li>
              );
            })}
          </ul>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary" onClick={() => void send()} disabled={busy || notes.length === 0 || !online || !api}>{busy ? 'Sending…' : `Send ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}</button>
            {notes.length > 0 && <button type="button" className="btn btn--quiet" onClick={() => void discardAll()} disabled={busy}>Delete all saved notes</button>}
          </div>
          {!online && notes.length > 0 && <p className="tiny muted">Sending is off until the connection returns.</p>}
        </div>
      </section>
    </>
  );
}
