import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Banner } from '../components/Provenance';
import { formatTime } from '../lib/format';
import { PaneFrame } from './PaneFrame';

export function BreakGlassPage() {
  return <PaneFrame startOn="note" center={<BreakGlass />} context={<div style={{ padding: 16 }}><p className="small muted">Emergency access is for a patient you are treating who is registered elsewhere, when waiting for permission would put them at risk. It lasts one hour. Your reason is shown to the administrator.</p></div>} />;
}

type Enc = { id: string; status: string; scenario: string; created_at: string };

function BreakGlass() {
  const { api } = useAuth();
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<{ patientRef: string; expiresAt: string; encounters: Enc[] } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!api) return;
    if (reason.trim().length < 10) { setError('Give the reason in at least 10 characters.'); return; }
    if (!ref.trim()) { setError('Enter the patient record number.'); return; }
    setBusy(true); setError(null);
    try {
      const g = await api.requestBreakGlass({ publicRef: ref.trim(), reason: reason.trim() });
      const enc = await api.patientEncounters(g.patientId).catch(() => ({ encounters: [] as Enc[] }));
      setGranted({ patientRef: g.patientRef, expiresAt: g.expiresAt, encounters: enc.encounters });
      setReason('');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <header><h2>Emergency access</h2><p className="muted small">Open the record of a patient you are not otherwise allowed to see.</p></header>
      <Banner kind="warn" title="Every use is recorded">Your name, the time and your reason are logged and shown to the facility administrator, who reviews each one afterwards.</Banner>
      {error && <Banner kind="error">{error}</Banner>}

      {granted ? (
        <section className="block" aria-label="Access granted">
          <div className="block__head"><h3>Access granted for {granted.patientRef}</h3></div>
          <div className="block__body">
            <p className="small" role="status">Until {formatTime(granted.expiresAt)}. After that you will not be able to open this record.</p>
            {granted.encounters.length === 0 ? <p className="small muted">No visits are recorded for this patient.</p>
              : <ul>{granted.encounters.map(x => <li key={x.id}><Link to={`/encounters/${x.id}`}>{formatTime(x.created_at)} · {x.status.replace(/_/g, ' ')}</Link></li>)}</ul>}
            <button type="button" className="btn btn--small" onClick={() => setGranted(null)}>Done</button>
          </div>
        </section>
      ) : (
        <form className="block" onSubmit={submit} noValidate>
          <div className="block__head"><h3>Request emergency access</h3></div>
          <div className="block__body">
            <div className="field" style={{ maxWidth: 260 }}><label htmlFor="bg-ref">Patient record number</label><input id="bg-ref" className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="AR-0001" maxLength={24} disabled={busy} autoFocus /></div>
            <div className="field"><label htmlFor="bg-reason">Why do you need this record now?</label><textarea id="bg-reason" className="textarea" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} disabled={busy} /><span className="tiny muted">At least 10 characters. Say what is happening, for example “unconscious on arrival, relatives not found”.</span></div>
            <div><button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Get emergency access'}</button></div>
          </div>
        </form>
      )}
    </>
  );
}
