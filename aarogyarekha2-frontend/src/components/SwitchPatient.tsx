import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ageSex } from '../lib/format';
import { clearRecent, readRecent } from '../lib/recentPatients';
import type { Api, PatientBrief } from '../lib/types';

/** A quick way to change patient (Ctrl+K): search, or jump back to a record opened earlier in this tab. */
export function SwitchPatient({ api, open, onClose }: { api: Api | null; open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PatientBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState(() => readRecent(typeof sessionStorage !== 'undefined' ? sessionStorage : null));
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setRecent(readRecent(sessionStorage)); setQ(''); setRows(null); setError(null); setTimeout(() => box.current?.focus(), 0); } }, [open]);
  useEffect(() => { if (!open) return; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [open, onClose]);
  if (!open) return null;

  async function search(e: FormEvent) {
    e.preventDefault(); if (!api) return; setError(null);
    try { setRows(await api.patients(q.trim() || undefined)); } catch (err) { setError((err as Error).message); }
  }
  async function pick(p: PatientBrief) {
    if (!api) return;
    try {
      const r = await api.patientEncounters(p.id);
      const latest = r.encounters[0];
      onClose();
      if (latest) nav(`/encounters/${latest.id}`); else nav('/intake', { state: { patient: p } });
    } catch { onClose(); nav('/intake', { state: { patient: p } }); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Switch patient" className="switch">
      <div className="switch__box">
        <form onSubmit={search} role="search" style={{ display: 'flex', gap: 8 }}>
          <input ref={box} className="input" aria-label="Name or record number" placeholder="Name or record number" value={q} onChange={e => setQ(e.target.value)} maxLength={60} />
          <button className="btn btn--primary" type="submit">Search</button>
          <button className="btn btn--quiet" type="button" onClick={onClose}>Close</button>
        </form>
        {error && <p className="small" role="alert">{error}</p>}
        {rows && rows.length === 0 && <p className="small muted">No patients match.</p>}
        {rows && rows.length > 0 && <ul>{rows.map(p => <li key={p.id}><button type="button" className="queue-row" onClick={() => void pick(p)}><span className="queue-row__name"><span>{p.full_name}</span></span><span className="queue-row__sub">{p.public_ref} · {ageSex(p)}</span></button></li>)}</ul>}
        {!rows && (
          <>
            <p className="small strong">Opened earlier in this tab</p>
            {recent.length === 0 ? <p className="small muted">Nothing yet.</p> : (
              <>
                <ul>{recent.map(r => <li key={r.encounterId}><button type="button" className="queue-row" onClick={() => { onClose(); nav(`/encounters/${r.encounterId}`); }}><span className="queue-row__name"><span>{r.ref}</span></span><span className="queue-row__sub">Open this record</span></button></li>)}</ul>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => { clearRecent(sessionStorage); setRecent([]); }}>Clear this list</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
