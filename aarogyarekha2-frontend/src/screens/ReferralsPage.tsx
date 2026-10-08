import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Banner } from '../components/Provenance';
import { ReferralNote } from '../components/ReferralNote';
import { formatAge, formatSex, formatTime, languageLabel, PRIORITY_LABEL } from '../lib/format';
import type { BoardReferral, ReferralAction, ReferralStatus, ReferralView } from '../lib/types';
import { PaneFrame } from './PaneFrame';

export const STATUS_LABEL: Record<ReferralStatus, string> = { draft: 'Draft', requested: 'Waiting for a reply', accepted: 'Accepted', rejected: 'Declined', in_progress: 'Patient arrived', completed: 'Completed', cancelled: 'Cancelled' };
const NEXT: Partial<Record<ReferralStatus, { action: ReferralAction; label: string; noteLabel?: string; noteRequired?: boolean }[]>> = {
  requested: [{ action: 'accept', label: 'Accept' }, { action: 'reject', label: 'Decline', noteLabel: 'Reason for declining (the sending facility will see this)', noteRequired: true }],
  accepted: [{ action: 'start', label: 'Patient has arrived' }],
  in_progress: [{ action: 'complete', label: 'Mark completed', noteLabel: 'Note for the sending facility (optional)' }],
};
const ageText = (p: NonNullable<BoardReferral['patient']>) => formatAge({ birth_date: p.birthDate, age_years_reported: p.ageYears });

export function ReferralsPage() {
  return <PaneFrame startOn="note" center={<Referrals />} context={<div style={{ padding: 16 }}><p className="small muted">Referrals sent to your facility appear under Incoming. Replying tells the sending facility whether to expect the patient. Only a reviewing doctor or nurse can reply.</p></div>} />;
}

function Referrals() {
  const { api } = useAuth();
  const [side, setSide] = useState<'incoming' | 'sent'>('incoming');
  const [showClosed, setShowClosed] = useState(false);
  const [rows, setRows] = useState<BoardReferral[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; view: ReferralView } | null>(null);
  const [asking, setAsking] = useState<{ id: string; action: ReferralAction } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setError(null);
    const closed: ReferralStatus[] = ['rejected', 'completed', 'cancelled'];
    const statuses: ReferralStatus[] | undefined = showClosed ? ['requested', 'accepted', 'in_progress', ...closed] : undefined;
    try { setRows(await (side === 'incoming' ? api.incomingReferrals(statuses) : api.sentReferrals(statuses))); } catch (e) { setError((e as Error).message); setRows([]); }
  }, [api, side, showClosed]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function view(id: string) {
    if (!api) return;
    try { setOpen({ id, view: await api.referral(id) }); } catch (e) { setError((e as Error).message); }
  }
  async function respond(r: BoardReferral, action: ReferralAction, required: boolean) {
    if (!api) return;
    if (required && note.trim().length < 5) { setError('Give a reason of at least 5 characters.'); return; }
    setBusy(true); setError(null);
    try { await api.respondToReferral(r.id, action, note.trim() || undefined); setAsking(null); setNote(''); await load(); } catch (e) { await load(); setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <header><h2>Referrals</h2><p className="muted small">{side === 'incoming' ? 'Patients other facilities are sending to you.' : 'Referrals your facility has sent.'}</p></header>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="tablist" aria-label="Referral lists" style={{ display: 'flex', gap: 8 }}>
        {(['incoming', 'sent'] as const).map(s => <button key={s} role="tab" aria-selected={s === side} className={`btn btn--small${s === side ? ' btn--primary' : ''}`} onClick={() => setSide(s)}>{s === 'incoming' ? 'Incoming' : 'Sent'}</button>)}
        </div>
        <label className="small"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Include finished and declined</label>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {rows === null && !error && <p className="small muted" role="status">Loading…</p>}
      {rows && rows.length === 0 && !error && <p className="small muted">{side === 'incoming' ? 'No referrals are waiting for you.' : 'No referrals sent.'}</p>}

      {rows && rows.map(r => (
        <section key={r.id} className="block" aria-label={`Referral ${r.patient?.publicRef ?? r.id.slice(0, 8)}`}>
          <div className="block__head"><h3>{r.patient ? `${r.patient.fullName}` : 'Patient not visible to you'} <span className="muted small">· {PRIORITY_LABEL[r.priority]}</span></h3></div>
          <div className="block__body">
            <p className="small">{r.patient && <>{r.patient.publicRef} · {ageText(r.patient)}, {formatSex(r.patient.sex).toLowerCase()} · {languageLabel(r.patient.language)} · </>}{side === 'incoming' ? `from ${r.from.name ?? 'another facility'}` : `to ${r.to?.name ?? 'a facility'}`} · {formatTime(r.sentAt ?? r.updatedAt)}</p>
            <p className="small"><strong>{STATUS_LABEL[r.status]}</strong>{r.statusReason && <> — {r.statusReason}</>}</p>
            {r.reasonText && <p className="small">Reason for referral: {r.reasonText}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--small" onClick={() => void view(r.id)}>View referral note</button>
              {side === 'incoming' && NEXT[r.status]?.map(n => (
                <button key={n.action} type="button" className={`btn btn--small${n.action === 'accept' ? ' btn--primary' : ''}`} disabled={busy}
                  onClick={() => (n.noteLabel ? (setAsking({ id: r.id, action: n.action }), setNote('')) : void respond(r, n.action, false))}>{n.label}</button>))}
            </div>
            {asking?.id === r.id && (() => { const n = NEXT[r.status]!.find(x => x.action === asking.action)!; return (
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor={`note-${r.id}`}>{n.noteLabel}</label>
                <textarea id={`note-${r.id}`} className="textarea" value={note} onChange={e => setNote(e.target.value)} maxLength={500} disabled={busy} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => void respond(r, n.action, !!n.noteRequired)}>{busy ? 'Saving…' : `Confirm: ${n.label.toLowerCase()}`}</button>
                  <button type="button" className="btn btn--small btn--quiet" disabled={busy} onClick={() => setAsking(null)}>Cancel</button>
                </div>
              </div>); })()}
          </div>
        </section>
      ))}
      {open && <ReferralNote view={open.view} onClose={() => setOpen(null)} />}
    </>
  );
}
