import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatTime, PRIORITY_LABEL } from '../lib/format';
import type { Api, Facility, ReferralMeta, ReferralPriority, ReferralView, UrgencyCode } from '../lib/types';
import { ConsentForm } from './ConsentForm';
import { Banner } from './Provenance';
import { ReferralNote } from './ReferralNote';

const OPEN = new Set(['draft', 'requested', 'accepted', 'in_progress']);
const STATUS_WORD: Record<string, string> = { draft: 'Draft', requested: 'Sent', accepted: 'Accepted', rejected: 'Declined', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
export const SUGGESTED: Record<UrgencyCode, ReferralPriority> = { red: 'stat', orange: 'asap', yellow: 'urgent', green: 'routine' };

interface Props {
  api: Api; encounterId: string; patientId: string;
  effectiveUrgency: UrgencyCode; signedOff: boolean; canReview: boolean; disabled?: boolean;
  onChanged: () => void;
}

export function ReferralPanel({ api, encounterId, patientId, effectiveUrgency, signedOff, canReview, disabled, onChanged }: Props) {
  const [list, setList] = useState<ReferralMeta[] | null>(null);
  const [view, setView] = useState<ReferralView | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirmSend' | 'confirmDiscard' | 'note'>('idle');

  const active = list?.find(r => OPEN.has(r.status)) ?? null;
  const past = (list ?? []).filter(r => !OPEN.has(r.status));

  const load = useCallback(async () => {
    try {
      const rows = await api.referralsFor(encounterId);
      setList(rows);
      const a = rows.find(r => OPEN.has(r.status));
      setView(a ? await api.referral(a.id) : null);
      setError(null);
    } catch (e) { setError(e as Error); setList(l => l ?? []); }
  }, [api, encounterId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (mode === 'edit' || (!active && signedOff && canReview)) void api.facilities().then(setFacilities).catch(() => {}); }, [api, mode, active, signedOff, canReview]);

  async function run(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true); setError(null);
    try { await work(); await load(); after?.(); onChanged(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }

  async function download(id: string) {
    setBusy(true); setError(null);
    try {
      const f = await api.downloadReferral(id);
      const url = URL.createObjectURL(new Blob([f.text], { type: 'application/fhir+json' }));
      const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }

  async function downloadPdf(id: string) {
    setBusy(true); setError(null);
    try {
      const f = await api.downloadReferralPdf(id);
      const url = URL.createObjectURL(f.blob);
      const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }

  const head = <div className="block__head"><h3>Referral</h3>{active && <span className="chip">{STATUS_WORD[active.status]}</span>}</div>;
  const err = error && <Banner kind="error" title="Not completed">{error.message}</Banner>;

  if (list === null) return <section className="block" aria-label="Referral">{head}<div className="block__body"><p className="muted small">Loading…</p></div></section>;

  if (!active) {
    return (
      <section className="block" aria-label="Referral">
        {head}
        <div className="block__body">
          {err}
          {past.length > 0 && <p className="small muted">Earlier referral: {(STATUS_WORD[past[past.length - 1]!.status] ?? '').toLowerCase()}{past[past.length - 1]!.toFacility?.name ? ` to ${past[past.length - 1]!.toFacility!.name}` : ''}.</p>}
          {!canReview ? <p className="small muted">A nurse, doctor or medical officer prepares referrals.</p>
            : !signedOff ? <p className="small">Sign off the priority above first. A referral can only be prepared after a reviewer has confirmed or changed the priority.</p>
            : <ReferralForm facilities={facilities} initialPriority={SUGGESTED[effectiveUrgency]} suggestedFrom={effectiveUrgency} busy={busy || !!disabled} submitLabel="Save referral draft"
                onSubmit={v => run(() => api.createReferral(encounterId, v))} />}
        </div>
      </section>
    );
  }

  const r = view?.readiness;
  const sent = active.status !== 'draft';
  const ready = !!r && r.signedOff && r.hasReceiver && r.hasReason && r.sharingConsent;
  const to = active.toFacility?.name ?? 'the receiving facility';

  return (
    <section className="block" aria-label="Referral">
      {head}
      <div className="block__body">
        {err}
        <dl className="kv">
          <dt>To</dt><dd>{active.toFacility?.name ?? <span className="muted">Not chosen</span>}</dd>
          <dt>Request</dt><dd>{PRIORITY_LABEL[active.priority]}</dd>
          <dt>Reason</dt><dd>{active.reasonText}</dd>
          {sent && <><dt>Sent</dt><dd>{formatTime(active.sentAt)}</dd></>}
          {sent && active.bundleSha256 && <><dt>Checksum</dt><dd className="small">{active.bundleSha256.slice(0, 16)}…</dd></>}
        </dl>

        {!sent && r && (
          <ul aria-label="Before sending" className="small" style={{ display: 'grid', gap: 4 }}>
            <Check ok={r.signedOff} text="A reviewer has signed off the priority" />
            <Check ok={r.hasReceiver} text="A receiving facility is chosen" />
            <Check ok={r.hasReason} text="The reason for referral is written" />
            <Check ok={r.sharingConsent} text="The patient has consented to sharing this referral" />
          </ul>
        )}

        {!sent && r && !r.sharingConsent && canReview && (
          <ConsentForm api={api} patientId={patientId} purpose="referral_sharing" facilityName={active.toFacility?.name ?? null} onRecorded={() => void run(async () => {})} />
        )}

        {mode === 'edit' && !sent && (
          <ReferralForm facilities={facilities} initialFacility={active.toFacility?.id} initialPriority={active.priority} initialReason={active.reasonText ?? ''} busy={busy} submitLabel="Save changes"
            onCancel={() => setMode('idle')} onSubmit={v => run(() => api.updateReferral(active.id, v), () => setMode('idle'))} />
        )}

        {mode === 'confirmSend' && (
          <div className="banner banner--warn" role="group" aria-label="Confirm sending">
            <p className="small" style={{ marginBottom: 8 }}>Send this referral to <strong>{to}</strong>? A summary of the patient's record is shared with them. It cannot be changed or taken back after it is sent.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--primary" disabled={busy} onClick={() => void run(() => api.sendReferral(active.id), () => setMode('idle'))}>{busy ? 'Sending…' : 'Send referral'}</button>
              <button className="btn btn--quiet" disabled={busy} onClick={() => setMode('idle')}>Cancel</button>
            </div>
          </div>
        )}

        {mode === 'confirmDiscard' && (
          <div className="banner banner--info" role="group" aria-label="Confirm discarding the draft">
            <p className="small" style={{ marginBottom: 8 }}>Discard this draft? Nothing has been shared.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={busy} onClick={() => void run(() => api.cancelReferral(active.id), () => setMode('idle'))}>Discard draft</button>
              <button className="btn btn--quiet" disabled={busy} onClick={() => setMode('idle')}>Keep it</button>
            </div>
          </div>
        )}

        {mode === 'idle' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!view} onClick={() => setMode('note')}>{sent ? 'View note' : 'Preview note'}</button>
            {!sent && <button className="btn btn--primary" disabled={!ready || busy || !!disabled || !canReview} onClick={() => setMode('confirmSend')}>Send referral</button>}
            {!sent && canReview && <button className="btn btn--quiet" disabled={busy} onClick={() => setMode('edit')}>Edit</button>}
            {!sent && canReview && <button className="btn btn--quiet" disabled={busy} onClick={() => setMode('confirmDiscard')}>Discard draft</button>}
            {sent && <button className="btn" disabled={busy} onClick={() => void download(active.id)}>Download FHIR file</button>}
            {sent && <button className="btn" disabled={busy} onClick={() => void downloadPdf(active.id)}>Download PDF</button>}
          </div>
        )}
        {!sent && !ready && r && <p className="tiny muted">Send is available when every item above is ticked.</p>}
      </div>

      {mode === 'note' && view && <ReferralNote view={view} onClose={() => setMode('idle')} onDownload={sent ? () => void download(active.id) : undefined} />}
    </section>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return <li style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span aria-hidden="true" style={{ fontWeight: 700, color: ok ? 'var(--urg-green)' : 'var(--urg-red)' }}>{ok ? '✓' : '✗'}</span><span>{text}<span className="visually-hidden">{ok ? ': done' : ': not done'}</span></span></li>;
}

interface FormProps {
  facilities: Facility[]; initialFacility?: string; initialPriority: ReferralPriority; initialReason?: string; suggestedFrom?: UrgencyCode;
  busy: boolean; submitLabel: string; onSubmit: (v: { toFacilityId: string; priority: ReferralPriority; reasonText: string }) => void | Promise<unknown>; onCancel?: () => void;
}
function ReferralForm(p: FormProps) {
  const [fac, setFac] = useState(p.initialFacility ?? '');
  const [pri, setPri] = useState<ReferralPriority>(p.initialPriority);
  const [reason, setReason] = useState(p.initialReason ?? '');
  const ok = !!fac && reason.trim().length >= 10;
  const submit = (e: FormEvent) => { e.preventDefault(); if (ok) void p.onSubmit({ toFacilityId: fac, priority: pri, reasonText: reason.trim() }); };
  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Referral details">
      <div className="row row--top">
        <div className="field">
          <label htmlFor="rf-fac">Refer to</label>
          <select id="rf-fac" className="select" value={fac} onChange={e => setFac(e.target.value)}>
            <option value="">Choose a facility…</option>
            {p.facilities.map(f => <option key={f.id} value={f.id}>{f.name}{f.district ? `, ${f.district}` : ''}</option>)}
          </select>
          {fac && p.facilities.find(f => f.id === fac)?.capabilities.length ? <span className="hint">Can receive: {p.facilities.find(f => f.id === fac)!.capabilities.map(c => c.replace(/_/g, ' ')).join(', ')}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="rf-pri">Request priority</label>
          <select id="rf-pri" className="select" value={pri} onChange={e => setPri(e.target.value as ReferralPriority)}>
            {(Object.keys(PRIORITY_LABEL) as ReferralPriority[]).map(k => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}
          </select>
          {p.suggestedFrom && <span className="hint">Suggested from the review priority. You can change it.</span>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="rf-reason">Reason for referral</label>
        <textarea id="rf-reason" className="textarea" value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} />
        <span className="hint">Write this yourself, in your own words (at least 10 characters). The system does not suggest a reason, a diagnosis or a treatment.</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--primary" type="submit" disabled={!ok || p.busy}>{p.busy ? 'Saving…' : p.submitLabel}</button>
        {p.onCancel && <button className="btn btn--quiet" type="button" disabled={p.busy} onClick={p.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
