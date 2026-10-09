import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { formatTime, isTier, REASON_CODES, TIER_WORD, tierOfUrgency, URGENCY_OF_TIER } from '../lib/format';
import type { Api, ReasonCode, ReviewRecord, ReviewResult, Tier, UrgencyCode } from '../lib/types';
import { ConsentForm } from './ConsentForm';
import { UrgencyPlate } from './Plate';
import { Banner } from './Provenance';

export const REVIEW_ROLES = ['nurse', 'doctor', 'medical_officer'];

interface Props {
  api: Api;
  encounterId: string;
  patientId?: string;
  assessmentId: string;
  rulesUrgency: UrgencyCode;
  effectiveUrgency: UrgencyCode;
  ruleFloor: boolean;
  current: ReviewRecord | null;
  reviewerName: string | null;
  canReview: boolean;
  disabled?: boolean;
  onDone: () => void;
}

const LEVELS: Tier[] = [1, 2, 3, 4];

export function ReviewPanel(p: Props) {
  const [mode, setMode] = useState<'idle' | 'confirm' | 'change'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [to, setTo] = useState<Tier | ''>('');
  const [code, setCode] = useState<ReasonCode | ''>('');
  const [reason, setReason] = useState('');
  const [confirmLower, setConfirmLower] = useState(false);
  const [sms, setSms] = useState<ReviewResult['sms'] | null>(null);

  const effTier = tierOfUrgency(p.effectiveUrgency)!;
  const rulesTier = tierOfUrgency(p.rulesUrgency)!;
  const lowerThanRules = isTier(to) && to > rulesTier;

  if (!p.canReview) {
    return (
      <section className="block" aria-label="Reviewer sign-off">
        <div className="block__head"><h3>Reviewer sign-off</h3></div>
        <div className="block__body"><p className="small muted">A nurse, doctor or medical officer reviews and signs off the priority. You can see their decision here once it is recorded.</p></div>
      </section>
    );
  }

  async function run(work: () => Promise<ReviewResult>) {
    setBusy(true); setError(null);
    try { const r = await work(); setSms(r?.sms ?? null); setMode('idle'); setTo(''); setCode(''); setReason(''); setConfirmLower(false); p.onDone(); }
    catch (e) { setError(e as Error); }
    finally { setBusy(false); }
  }

  const approve = () => run(() => p.api.review(p.encounterId, { action: 'approve', assessmentId: p.assessmentId }));
  const change = (e: FormEvent) => {
    e.preventDefault();
    if (!isTier(to) || !code) return;
    void run(() => p.api.review(p.encounterId, { action: 'override', assessmentId: p.assessmentId, toUrgency: URGENCY_OF_TIER[to], reasonCode: code, reason: reason.trim(), confirmDowngrade: lowerThanRules ? confirmLower : undefined }));
  };
  const canSubmit = isTier(to) && !!code && reason.trim().length >= 10 && (!lowerThanRules || confirmLower) && !busy;

  const errView = error && (
    (error as ApiError).isStale
      ? <Banner kind="warn" title="This assessment has changed">{error.message}<div style={{ marginTop: 8 }}><button className="btn btn--small" onClick={() => p.onDone()}>Show the latest assessment</button></div></Banner>
      : <Banner kind="error" title="Not recorded">{error.message}</Banner>
  );

  return (
    <section className="block" aria-label="Reviewer sign-off">
      <div className="block__head"><h3>Reviewer sign-off</h3>{p.current && <span className="chip chip--ok">Signed off</span>}</div>
      <div className="block__body">
        {p.current ? (
          <p className="small">
            <strong>{p.current.reviewer_name ?? 'A reviewer'}</strong>{' '}
            {p.current.action === 'approve' ? 'confirmed the priority' : 'changed the priority'} on {formatTime(p.current.created_at)}. You can still change it if the situation changes.
          </p>
        ) : (
          <p className="small">The rules set the priority to <strong>{TIER_WORD[rulesTier]}</strong>. Confirm it, or change it and say why. Your name is recorded with the decision.</p>
        )}

        {errView}
        {sms && <SmsNote sms={sms} patientId={p.patientId} api={p.api} />}

        {mode === 'idle' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!p.current && <button className="btn btn--primary" disabled={p.disabled || busy} onClick={() => setMode('confirm')}>Confirm priority</button>}
            <button className="btn" disabled={p.disabled || busy} onClick={() => setMode('change')}>Change priority</button>
          </div>
        )}

        {mode === 'confirm' && (
          <div className="banner banner--info" role="group" aria-label="Confirm sign-off">
            <p className="small" style={{ marginBottom: 8 }}>Sign off <strong>{TIER_WORD[effTier]}</strong> as <strong>{p.reviewerName ?? 'you'}</strong>? This is recorded and cannot be removed.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--primary" disabled={busy} onClick={() => void approve()}>{busy ? 'Recording…' : 'Sign off'}</button>
              <button className="btn btn--quiet" disabled={busy} onClick={() => setMode('idle')}>Cancel</button>
            </div>
          </div>
        )}

        {mode === 'change' && (
          <form onSubmit={change} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Change priority">
            <div className="row">
              <div className="field">
                <label htmlFor="rv-to">New priority</label>
                <select id="rv-to" className="select" value={to} onChange={e => { setTo(e.target.value ? (Number(e.target.value) as Tier) : ''); setConfirmLower(false); }}>
                  <option value="">Choose…</option>
                  {LEVELS.filter(t => t !== effTier).map(t => <option key={t} value={t}>{TIER_WORD[t]}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rv-code">Reason</label>
                <select id="rv-code" className="select" value={code} onChange={e => setCode(e.target.value as ReasonCode)}>
                  <option value="">Choose…</option>
                  {REASON_CODES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="rv-text">Explain the change</label>
              <textarea id="rv-text" className="textarea" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
              <span className="hint">At least 10 characters. This is part of the permanent record.</span>
            </div>
            {lowerThanRules && (
              <Banner kind="warn" title={`Lower than the rules set (${TIER_WORD[rulesTier]})`}>
                {p.ruleFloor ? 'A danger-sign rule set this priority. ' : ''}Making a case less urgent than the rules is allowed, but it is recorded and needs your confirmation.
                <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={confirmLower} onChange={e => setConfirmLower(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>I confirm I am lowering this priority and I have checked the reason above.</span>
                </label>
              </Banner>
            )}
            {isTier(to) && <p className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>Will become <UrgencyPlate tier={to} /></p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--primary" type="submit" disabled={!canSubmit}>{busy ? 'Recording…' : 'Change priority'}</button>
              <button className="btn btn--quiet" type="button" disabled={busy} onClick={() => { setMode('idle'); setError(null); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

const SMS_WHY: Record<string, string> = {
  no_consent: 'The patient has not agreed to text messages.', no_phone: 'There is no phone number on record.', bad_phone: 'The phone number on record is not a valid mobile number.',
  opted_out: 'The patient has asked to stop text messages.', not_configured: 'Text messages are not set up.', provider_error: 'The message could not be sent.', duplicate: 'The patient was already told this.',
};
const LANG_NAME = { en: 'English', hi: 'Hindi', or: 'Odia' } as const;

function SmsNote({ sms, patientId, api }: { sms: NonNullable<ReviewResult['sms']>; patientId?: string; api: Api }) {
  const [asked, setAsked] = useState(false);
  if (sms.status === 'sent') return <Banner kind="info" title="Text message sent">The patient was told their queue status in {LANG_NAME[sms.language]}.</Banner>;
  if (sms.reason === 'duplicate') return null;
  const why = SMS_WHY[sms.reason ?? ''] ?? 'The message was not sent.';
  return (
    <Banner kind="warn" title="No text message was sent">
      {why} Tell the patient their status in person.
      {sms.reason === 'no_consent' && patientId && !asked && <div style={{ marginTop: 8 }}><button type="button" className="btn btn--small" onClick={() => setAsked(true)}>Ask for text-message consent</button></div>}
      {asked && patientId && <ConsentForm api={api} patientId={patientId} purpose="status_messages" dialog onCancel={() => setAsked(false)} onRecorded={() => setAsked(false)} />}
    </Banner>
  );
}
