import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Banner } from '../components/Provenance';
import { FACILITY_TYPE_LABEL, formatTime } from '../lib/format';
import type { PlatformFacilityView, TrainingSummary } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';

const TYPES = Object.keys(FACILITY_TYPE_LABEL);
const blank = { name: '', type: 'phc', state: '', district: '', pincode: '', code: '' };

export function PlatformPage() {
  const { api } = useAuth();
  const [rows, setRows] = useState<PlatformFacilityView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [appoint, setAppoint] = useState<Record<string, string>>({});

  const load = useCallback(async () => { if (!api) return; try { setRows(await api.platformFacilities()); } catch (e) { setError((e as Error).message); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  const [training, setTraining] = useState<TrainingSummary | null>(null);
  const [trainingErr, setTrainingErr] = useState<string | null>(null);
  useEffect(() => {
    if (!api) return;
    void Promise.resolve().then(() => api.trainingSummary()).then(s => { setTraining(s); setTrainingErr(null); }).catch((e: Error) => setTrainingErr(e.message));
  }, [api]);
  function download(format: 'csv' | 'jsonl') {
    if (!api) return;
    void run('dl-' + format, async () => {
      const f = await api.downloadTrainingData(format);
      const url = URL.createObjectURL(f.blob); const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }, 'Training data downloaded.');
  }

  async function run(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key); setError(null); setDone(null);
    try { await fn(); await load(); setDone(message); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  function create(e: FormEvent) {
    e.preventDefault();
    const f = form; if (!api || f.name.trim().length < 2) { setError('Enter the facility name.'); return; }
    void run('create', async () => { await api.createFacility({ name: f.name.trim(), type: f.type, state: f.state, district: f.district, pincode: f.pincode, code: f.code }); setForm(blank); }, `${f.name.trim()} was added.`);
  }
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setForm(v => ({ ...v, [k]: e.target.value }));
  if (!api) return null;

  return (
    <>
      <header><h2>Facilities</h2><p className="muted small">Add a facility, switch one off or on, and choose who administers it. Administrators then add their own staff. You cannot see patient records from here. Every change is recorded in the audit log.</p></header>
      {error && <Banner kind="error" title="Not done">{error}</Banner>}
      {done && <p className="small" role="status">{done}</p>}

      <section className="block" aria-label="Facilities">
        <div className="block__head"><h3>All facilities</h3></div>
        <div className="block__body">
          {rows === null && !error && <p className="small muted" role="status">Loading…</p>}
          {rows && rows.length === 0 && <p className="small muted">No facilities yet. Add the first one below.</p>}
          {rows && rows.map(f => (
            <div key={f.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--rule)' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{f.name}</strong>
                <span className="muted small">{FACILITY_TYPE_LABEL[f.type] ?? f.type}{f.district ? ` · ${f.district}` : ''}{f.state ? `, ${f.state}` : ''}{f.code ? ` · ${f.code}` : ''}</span>
                <span className={f.active ? 'chip chip--ok' : 'chip'}>{f.active ? 'Active' : 'Switched off'}</span>
                <span className="small muted">{f.staff} staff</span>
                <span className="small muted">{f.visits30} visits and {f.referrals30} referrals sent in 30 days · {f.lastActivity ? `last activity ${formatTime(f.lastActivity)}` : 'no activity yet'}</span>
                <button type="button" className="btn btn--small" disabled={busy === f.id}
                  onClick={() => { if (f.active && !window.confirm(`Switch off ${f.name}? Its staff keep their accounts, and nothing is deleted.`)) return; void run(f.id, () => api.setFacilityActive(f.id, !f.active), `${f.name} is now ${f.active ? 'switched off' : 'active'}.`); }}>
                  {f.active ? 'Switch off' : 'Switch on'}
                </button>
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                <span className="muted">Administrators: </span>
                {f.admins.length === 0 && <span className="muted">none yet</span>}
                {f.admins.map(a => (
                  <span key={a.userId} style={{ marginRight: 12 }}>{a.name ?? a.email ?? a.userId.slice(0, 8)}{a.email && a.name ? ` (${a.email})` : ''}{' '}
                    <button type="button" className="btn btn--small btn--quiet" disabled={busy === f.id + a.userId}
                      onClick={() => { if (window.confirm(`Remove ${a.name ?? a.email ?? 'this person'} as administrator of ${f.name}?`)) void run(f.id + a.userId, () => api.removeFacilityAdmin(f.id, a.userId), 'Administrator removed.'); }}>Remove</button>
                  </span>))}
              </div>
              <form style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }} onSubmit={e => { e.preventDefault(); const addr = (appoint[f.id] ?? '').trim(); if (addr) void run('app' + f.id, async () => { await api.appointFacilityAdmin(f.id, addr); setAppoint(a => ({ ...a, [f.id]: '' })); }, `${addr} is now an administrator of ${f.name}.`); }}>
                <label htmlFor={`adm-${f.id}`} className="small">Appoint an administrator, by the email of their account</label>
                <input id={`adm-${f.id}`} className="input" type="email" autoComplete="off" style={{ width: 260 }} value={appoint[f.id] ?? ''} onChange={e => setAppoint(a => ({ ...a, [f.id]: e.target.value }))} />
                <button type="submit" className="btn btn--small" disabled={busy === 'app' + f.id || !(appoint[f.id] ?? '').trim()}>{busy === 'app' + f.id ? 'Appointing…' : 'Appoint'}</button>
              </form>
            </div>))}
          <p className="small muted" style={{ marginTop: 12 }}>The person must have signed in at least once before you can appoint them.</p>
        </div>
      </section>

      <form className="block" onSubmit={create} aria-label="Add a facility">
        <div className="block__head"><h3>Add a facility</h3></div>
        <div className="block__body" style={{ display: 'grid', gap: 8, maxWidth: 460 }}>
          <label htmlFor="pf-name">Name</label><input id="pf-name" className="input" value={form.name} onChange={set('name')} maxLength={120} />
          <label htmlFor="pf-type">Type</label>
          <select id="pf-type" className="select" value={form.type} onChange={set('type')}>{TYPES.map(t => <option key={t} value={t}>{FACILITY_TYPE_LABEL[t]}</option>)}</select>
          <label htmlFor="pf-district">District (optional)</label><input id="pf-district" className="input" value={form.district} onChange={set('district')} maxLength={80} />
          <label htmlFor="pf-state">State (optional)</label><input id="pf-state" className="input" value={form.state} onChange={set('state')} maxLength={80} />
          <label htmlFor="pf-pin">Pincode (optional)</label><input id="pf-pin" className="input" inputMode="numeric" value={form.pincode} onChange={set('pincode')} maxLength={6} />
          <label htmlFor="pf-code">Registry code (optional)</label><input id="pf-code" className="input" value={form.code} onChange={set('code')} maxLength={40} />
          <div><button type="submit" className="btn btn--primary" disabled={busy === 'create'}>{busy === 'create' ? 'Adding…' : 'Add facility'}</button></div>
        </div>
      </form>

      <section className="block" aria-label="Training data">
        <div className="block__head"><h3>Training data</h3>{training?.enabled && <span className="chip">{training.count}</span>}</div>
        <div className="block__body">
          <p className="small muted">After a nurse or doctor signs off, an anonymous copy of the case is saved here, but only when the patient agreed. It has no name, phone, address, dates, facility or clinician name, and it cannot be traced back to the patient.</p>
          {trainingErr && <Banner kind="warn" title="Training data could not be checked">{trainingErr}</Banner>}
          {!training && !trainingErr && <p className="small muted" role="status">Loading…</p>}
          {training && !training.enabled && <Banner kind="info" title="Training data is off">Set TRAINING_PSEUDONYM_KEY on the server and apply migration 0022 to turn it on.</Banner>}
          {training?.enabled && (
            <>
              <p className="small">{training.count} {training.count === 1 ? 'case' : 'cases'} saved{training.latestAt ? ` · latest ${formatTime(training.latestAt)}` : ''}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn" disabled={training.count === 0 || busy !== null} onClick={() => download('csv')}>{busy === 'dl-csv' ? 'Preparing…' : 'Download CSV'}</button>
                <button type="button" className="btn" disabled={training.count === 0 || busy !== null} onClick={() => download('jsonl')}>{busy === 'dl-jsonl' ? 'Preparing…' : 'Download JSON lines with FHIR'}</button>
              </div>
              <p className="tiny muted">Every download is logged and needs your second factor.</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
