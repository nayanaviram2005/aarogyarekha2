import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { UrgencyPlate } from '../components/Plate';
import { Banner } from '../components/Provenance';
import { OUTCOME_TEXT } from '../components/VisitPanel';
import { formatTime, scenarioLabel, tierOfUrgency } from '../lib/format';
import type { PatientSearchHit, TriageHistory, VisitOutcome } from '../lib/types';
import { PaneFrame } from './PaneFrame';

export function BreakGlassPage() {
  return <PaneFrame startOn="note" center={<BreakGlass />} context={<div style={{ padding: 16 }}><p className="small muted">Emergency access is for a patient you are treating who is registered elsewhere, when waiting for permission would put them at risk. It lasts one hour. Your reason is shown to the administrator, and so is every search you make here.</p></div>} />;
}

const RECORD_NUMBER = /^[A-Za-z0-9-]{4,24}$/;
const describe = (p: PatientSearchHit) => [p.age !== null ? `${p.age} y` : null, p.sex].filter(Boolean).join(', ');

function BreakGlass() {
  const { api } = useAuth();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PatientSearchHit | null>(null);
  const [hits, setHits] = useState<PatientSearchHit[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<{ expiresAt: string; history: TriageHistory | null; historyError: string | null } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!api || picked || q.length < 2) { setHits(null); setSearching(false); return; }
    const id = ++latest.current; setSearching(true);
    const timer = setTimeout(() => {
      api.searchBreakGlassPatients(q)
        .then(r => { if (id === latest.current) { setHits(r.patients); setTruncated(r.truncated); setActive(r.patients.length ? 0 : -1); setError(null); } })
        .catch(e => { if (id === latest.current) { setHits([]); setError((e as Error).message); } })
        .finally(() => { if (id === latest.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [api, query, picked]);

  function choose(p: PatientSearchHit) { setPicked(p); setQuery(''); setHits(null); setOpen(false); setError(null); }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!hits || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(i => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter' && open && active >= 0) { e.preventDefault(); choose(hits[active]!); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!api) return;
    const typed = query.trim();
    const ref = picked?.publicRef ?? (RECORD_NUMBER.test(typed) ? typed : '');
    if (!ref) { setError('Find the patient by name or record number, then choose them from the list.'); return; }
    if (reason.trim().length < 10) { setError('Give the reason in at least 10 characters.'); return; }
    setBusy(true); setError(null);
    try {
      const g = await api.requestBreakGlass({ publicRef: ref, reason: reason.trim() });
      let history: TriageHistory | null = null; let historyError: string | null = null;
      try { history = await api.patientTriageHistory(g.patientId); } catch (err) { historyError = (err as Error).message; }
      setGranted({ expiresAt: g.expiresAt, history, historyError });
      setReason(''); setPicked(null); setQuery('');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  const listId = 'bg-results';
  const showList = open && !picked && query.trim().length >= 2;

  return (
    <>
      <header><h2>Emergency access</h2><p className="muted small">Find a patient registered at another facility and open their triage history and doctor’s notes.</p></header>
      <Banner kind="warn" title="Every use is recorded">Your name, the time and your reason are logged and shown to the facility administrator, who reviews each one afterwards. Searches are logged too.</Banner>
      {error && <Banner kind="error">{error}</Banner>}

      {granted ? (
        <section className="block" aria-label="Access granted">
          <div className="block__head"><h3>Access granted for {granted.history ? `${granted.history.patientName} (${granted.history.patientRef})` : 'this patient'}</h3></div>
          <div className="block__body">
            <p className="small" role="status">Until {formatTime(granted.expiresAt)}. After that you will not be able to open this record.</p>
            {granted.historyError && <Banner kind="error" title="Triage history">{granted.historyError}</Banner>}
            {granted.history && granted.history.visits.length === 0 && <p className="small muted">No visits are recorded for this patient.</p>}
            {granted.history && granted.history.visits.length > 0 && (
              <>
                <h4 style={{ margin: '12px 0 4px' }}>Triage history</h4>
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                  {granted.history.visits.map(v => {
                    const urgency = v.finalUrgency ?? v.assessedUrgency; const tier = tierOfUrgency(urgency);
                    return (
                      <li key={v.id} className="block" style={{ margin: 0 }}>
                        <div className="block__body">
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong>{formatTime(v.createdAt)}</strong>
                            <span className="small muted">{v.facility ?? 'Another facility'} · {scenarioLabel(v.scenario)}</span>
                            <UrgencyPlate tier={tier} assessed={tier !== null} />
                          </div>
                          <p className="small" style={{ margin: '6px 0' }}>{v.complaint ? `Complaint: ${v.complaint}` : 'No complaint recorded.'}</p>
                          <p className="small muted" style={{ margin: '0 0 6px' }}>
                            {v.outcome ? `Outcome: ${OUTCOME_TEXT[v.outcome as VisitOutcome] ?? v.outcome.replace(/_/g, ' ')}. ` : `Visit ${v.status.replace(/_/g, ' ')}. `}
                            {v.reviewedAt ? `Signed off${v.reviewedBy ? ` by ${v.reviewedBy}` : ''}, ${formatTime(v.reviewedAt)}.` : 'Not signed off.'}
                          </p>
                          <h5 style={{ margin: '8px 0 4px', fontSize: 14 }}>Doctor’s notes</h5>
                          {v.notes.length === 0 ? <p className="small muted">No doctor’s notes for this visit.</p> : (
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                              {v.notes.map(n => <li key={n.id} className="small" style={{ padding: '6px 0', borderTop: '1px solid var(--rule)' }}><strong>{n.author ?? 'A doctor'}</strong> · {formatTime(n.at)}<span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{n.body}</span></li>)}
                            </ul>
                          )}
                          <p className="small" style={{ margin: '8px 0 0' }}><Link to={`/encounters/${v.id}`}>Open the full visit</Link></p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            <div style={{ marginTop: 12 }}><button type="button" className="btn btn--small" onClick={() => setGranted(null)}>Done</button></div>
          </div>
        </section>
      ) : (
        <form className="block" onSubmit={e => void submit(e)} noValidate>
          <div className="block__head"><h3>Request emergency access</h3></div>
          <div className="block__body">
            <div className="field" style={{ maxWidth: 520, position: 'relative' }}>
              <label htmlFor="bg-search">Find the patient by name or record number</label>
              {picked ? (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} role="status">
                  <span><strong>{picked.name}</strong> · {picked.publicRef}{describe(picked) && ` · ${describe(picked)}`} · {picked.facility}</span>
                  <button type="button" className="btn btn--small" onClick={() => { setPicked(null); setOpen(false); }} disabled={busy}>Change patient</button>
                </div>
              ) : (
                <>
                  <input id="bg-search" className="input" role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={showList && active >= 0 ? `bg-opt-${active}` : undefined}
                    value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} placeholder="Sita Mohanty or AR-0001" maxLength={60} disabled={busy} autoComplete="off" autoFocus />
                  <ul id={listId} role="listbox" aria-label="Matching patients" hidden={!showList} style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', margin: 0, padding: 0, listStyle: 'none', background: 'var(--panel)', border: '1px solid var(--rule-strong)', maxHeight: 320, overflowY: 'auto' }}>
                    {searching && <li className="small muted" style={{ padding: 10 }} role="status">Searching…</li>}
                    {!searching && hits && hits.length === 0 && <li className="small muted" style={{ padding: 10 }}>No patient matches. Check the spelling, or type the record number.</li>}
                    {!searching && (hits ?? []).map((p, i) => (
                      <li key={p.publicRef} id={`bg-opt-${i}`} role="option" aria-selected={i === active} onMouseDown={e => { e.preventDefault(); choose(p); }} onMouseEnter={() => setActive(i)}
                        style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--rule)', background: i === active ? 'var(--action-tint)' : 'transparent' }}>
                        <strong>{p.name}</strong> · {p.publicRef}
                        <span className="small muted" style={{ display: 'block' }}>{[describe(p), p.facility].filter(Boolean).join(' · ')}{p.ownFacility ? ' · your facility (open from the queue)' : ''}</span>
                      </li>
                    ))}
                    {!searching && truncated && <li className="tiny muted" style={{ padding: 8 }}>Showing the first matches only. Type more to narrow the list.</li>}
                  </ul>
                </>
              )}
              <span className="tiny muted">At least 2 characters. Choose the patient from the list; the record number must match.</span>
            </div>
            <div className="field"><label htmlFor="bg-reason">Why do you need this record now?</label><textarea id="bg-reason" className="textarea" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} disabled={busy} /><span className="tiny muted">At least 10 characters. Say what is happening, for example “unconscious on arrival, relatives not found”.</span></div>
            <div><button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Get emergency access'}</button></div>
          </div>
        </form>
      )}
    </>
  );
}
