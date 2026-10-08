import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AnalyticsPanel } from '../components/AnalyticsPanel';
import { MembersPanel } from '../components/MembersPanel';
import { Banner } from '../components/Provenance';
import { formatTime } from '../lib/format';
import type { BreakGlassGrantView, ChainStatus, FlagsResponse } from '../lib/types';
import { PaneFrame } from './PaneFrame';

const KIND: Record<string, string> = { many_patients: 'Many records opened', repeated_refusals: 'Repeated refusals', failed_logins: 'Failed sign-ins', off_hours_reads: 'Night-time reading', emergency_access: 'Emergency access used' };

export function AdminPage() {
  return <PaneFrame startOn="note" center={<Admin />} context={<div style={{ padding: 16 }}><p className="small muted">Administrators see activity at their own facilities. Patient names are not shown here, only record numbers and counts. A flag is a reason to ask a question, not a finding.</p></div>} />;
}

/** The audit log is chained: each entry's fingerprint includes the one before. If any entry is edited, the chain stops matching here. */
export function ChainBadge({ chain, busy, onCheck }: { chain: ChainStatus | null; busy: boolean; onCheck: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {chain === null && <span className="chip">Not checked yet</span>}
      {chain?.intact && <span className="chip chip--ok" role="status">Audit log intact · {chain.checked} entries checked</span>}
      {chain && !chain.intact && <span className="chip" role="alert" style={{ background: 'var(--urg-red-tint)', color: 'var(--urg-red)', borderColor: 'var(--urg-red)' }}>AUDIT LOG DOES NOT MATCH · {chain.brokenIds.length}{chain.brokenIds.length >= 20 ? '+' : ''} entries differ (first: {chain.brokenIds[0]})</span>}
      <button type="button" className="btn btn--small" onClick={onCheck} disabled={busy}>{busy ? 'Checking…' : 'Check now'}</button>
      {chain && <span className="tiny muted">Checked {formatTime(chain.checkedAt)}</span>}
    </div>
  );
}

function Admin() {
  const { api } = useAuth();
  const [hours, setHours] = useState(24);
  const [flags, setFlags] = useState<FlagsResponse | null>(null);
  const [grants, setGrants] = useState<BreakGlassGrantView[] | null>(null);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    const [f, g] = await Promise.allSettled([api.auditFlags(hours), api.breakGlassList()]);
    if (f.status === 'fulfilled') setFlags(f.value); else setError((f.reason as Error).message);
    if (g.status === 'fulfilled') setGrants(g.value); else setError(e => e ?? (g.reason as Error).message);
  }, [api, hours]);
  useEffect(() => { void load(); }, [load]);

  async function check() {
    if (!api) return; setChainBusy(true);
    try { setChain(await api.auditChain()); } catch (e) { setError((e as Error).message); } finally { setChainBusy(false); }
  }
  async function review(id: string) {
    if (!api) return; setBusyId(id);
    try { await api.reviewBreakGlass(id); await load(); } catch (e) { setError((e as Error).message); } finally { setBusyId(null); }
  }

  return (
    <>
      <header><h2>Administration</h2><p className="muted small">Audit and emergency access at your facilities.</p></header>
      {error && <Banner kind="error" title="Could not load everything">{error}</Banner>}

      <section className="block" aria-label="Audit log check">
        <div className="block__head"><h3>Audit log</h3></div>
        <div className="block__body"><ChainBadge chain={chain} busy={chainBusy} onCheck={() => void check()} /></div>
      </section>

      {api && <MembersPanel api={api} />}

      {api && <AnalyticsPanel api={api} />}

      <section className="block" aria-label="Unusual access">
        <div className="block__head"><h3>Unusual access</h3></div>
        <div className="block__body">
          {flags && !flags.rulesValidated && <Banner kind="warn" title="Draft thresholds">These limits are placeholders. Your information-security lead must set them before you rely on this list.</Banner>}
          <div className="field" style={{ maxWidth: 220 }}><label htmlFor="adm-hours">Look back</label>
            <select id="adm-hours" className="select" value={hours} onChange={e => setHours(Number(e.target.value))}>{[[24, 'Last 24 hours'], [72, 'Last 3 days'], [168, 'Last 7 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          {flags === null && !error && <p className="small muted" role="status">Loading…</p>}
          {flags && flags.flags.length === 0 && <p className="small muted">Nothing unusual among {flags.examined} logged events.</p>}
          {flags && flags.flags.length > 0 && (
            <table className="table"><thead><tr><th>What</th><th>Who</th><th className="num">Count</th><th>When</th></tr></thead>
              <tbody>{flags.flags.map((f, i) => (
                <tr key={i}><td><strong>{KIND[f.kind] ?? f.kind}</strong><br /><span className="small">{f.text}</span>{f.severity === 'info' && <span className="tiny muted"> For your information.</span>}</td>
                  <td>{f.who.name ?? f.who.ip ?? f.who.actorId?.slice(0, 8) ?? 'Unknown'}</td><td className="num">{f.count}</td><td>{formatTime(f.firstAt)} to {formatTime(f.lastAt)}</td></tr>))}</tbody></table>
          )}
        </div>
      </section>

      <section className="block" aria-label="Emergency access">
        <div className="block__head"><h3>Emergency access</h3></div>
        <div className="block__body block__body--flush">
          {grants === null && !error && <p className="small muted" style={{ padding: 12 }} role="status">Loading…</p>}
          {grants && grants.length === 0 && <p className="small muted" style={{ padding: 12 }}>No emergency access has been used.</p>}
          {grants && grants.length > 0 && (
            <table className="table"><thead><tr><th>Who</th><th>Record</th><th>Reason given</th><th>When</th><th>Review</th></tr></thead>
              <tbody>{grants.map(g => (
                <tr key={g.id}><td>{g.who ?? g.userId.slice(0, 8)}</td><td>{g.patientRef}</td><td>{g.reason}</td><td>{formatTime(g.createdAt)}</td>
                  <td>{g.reviewed ? <span className="chip chip--ok">Reviewed {formatTime(g.reviewedAt)}</span> : <button type="button" className="btn btn--small" onClick={() => void review(g.id)} disabled={busyId === g.id}>Mark reviewed</button>}</td></tr>))}</tbody></table>
          )}
        </div>
      </section>
    </>
  );
}
