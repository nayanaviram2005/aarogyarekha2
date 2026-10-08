import { useState } from 'react';
import { Banner } from './Provenance';
import type { Api, EncounterSummary, VisitOutcome } from '../lib/types';

export const OUTCOME_TEXT: Record<VisitOutcome, string> = { treated_here: 'Treated here', sent_home: 'Sent home', did_not_wait: 'Did not wait', referred: 'Referred' };
type Choice = Exclude<VisitOutcome, 'referred'>;

/**
 * Moves a patient through the visit: call in, then complete with an outcome so the patient leaves the queue and room opens up.
 * Treated here and sent home need a nurse or doctor and a priority that has already been signed off. A referral is not completed here:
 * sending the referral takes the patient off the queue.
 */
export function VisitPanel({ api, summary, canReview, reviewedCurrent, onChanged, bare = false }: { api: Api; summary: EncounterSummary; canReview: boolean; reviewedCurrent: boolean; onChanged: () => Promise<void> | void; /** Without its own heading and frame, for use inside the next-step card. */ bare?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Choice | ''>('');
  const status = summary.encounter.status;
  const qs = summary.queue?.status ?? null;

  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await work(); setOutcome(''); await onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (status === 'closed') return <section className="block" aria-label="Visit"><div className="block__body"><Banner kind="info" title="Visit completed">This patient has left the queue. The record stays readable here and under Done today.</Banner></div></section>;
  if (status === 'referred') return <section className="block" aria-label="Visit"><div className="block__body"><Banner kind="info" title="Referred">A referral was sent, so this patient has left the queue.</Banner></div></section>;
  if (!summary.queue || (status !== 'submitted' && status !== 'in_review')) return null;

  const beingSeen = qs === 'in_review';
  const needsReview = outcome !== '' && outcome !== 'did_not_wait';
  const blocked = needsReview && (!canReview || !reviewedCurrent);

  const inner = (
      <>
        {error && <Banner kind="error" title="Not done">{error}</Banner>}
        {!beingSeen && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void run(() => api.callIn(summary.encounter.id))}>{busy ? 'Calling in…' : 'Call in patient'}</button>
            <span className="small muted">Marks the patient as called in and with staff, so the next person in the queue is clear. A priority sign-off also puts a patient in review.</span>
          </div>
        )}
        {beingSeen && (
          <div style={{ display: 'grid', gap: 8, maxWidth: 460 }}>
            <label htmlFor="visit-outcome" className="small strong">How did the visit end?</label>
            <select id="visit-outcome" className="select" value={outcome} disabled={busy} onChange={e => setOutcome(e.target.value as Choice | '')}>
              <option value="" disabled>Choose…</option>
              <option value="treated_here">{OUTCOME_TEXT.treated_here}</option>
              <option value="sent_home">{OUTCOME_TEXT.sent_home}</option>
              <option value="did_not_wait">{OUTCOME_TEXT.did_not_wait} (left before being seen)</option>
            </select>
            {blocked && <p className="small" role="status" style={{ color: 'var(--urg-red)' }}>{!canReview ? 'Only a nurse or doctor can complete a visit as treated or sent home. You can record that the patient did not wait.' : 'Review and sign off the priority first, then complete the visit.'}</p>}
            <p className="tiny muted">To refer the patient, use the Referral section below. Sending it takes the patient off the queue.</p>
            <div><button type="button" className="btn btn--primary" disabled={busy || outcome === '' || blocked} onClick={() => outcome && void run(() => api.completeVisit(summary.encounter.id, outcome))}>{busy ? 'Completing…' : 'Complete visit'}</button></div>
          </div>
        )}
      </>
  );
  return bare ? <div aria-label="Visit">{inner}</div> : (
    <section className="block" aria-label="Visit">
      <div className="block__head"><h3>Visit</h3><span className={beingSeen ? 'chip chip--ok' : 'chip'}>{beingSeen ? 'In review' : 'Waiting'}</span></div>
      <div className="block__body">{inner}</div>
    </section>
  );
}
