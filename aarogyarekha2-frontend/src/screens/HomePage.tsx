import { Link, useNavigate } from 'react-router-dom';
import { UrgencyPlate } from '../components/Plate';
import { isTier, TIER_WORD } from '../lib/format';
import type { QueueEntry } from '../lib/types';
import { PaneFrame } from './PaneFrame';
import { canReviewAt, useMe } from './meContext';
import { useQueue } from './queueContext';

export function startHere(entries: QueueEntry[], canReview: boolean) {
  const waiting = entries.filter(e => e.queueStatus !== 'in_review');
  const needsAssess = entries.filter(e => !e.assessed);
  const needsSignoff = entries.filter(e => e.assessed && !e.reviewed && e.queueStatus !== 'in_review');
  const inReview = entries.filter(e => e.queueStatus === 'in_review');
  const calledNext = waiting.find(e => e.assessed && e.reviewed);
  const first = canReview ? (needsSignoff[0] ?? needsAssess[0] ?? calledNext) : (needsAssess[0] ?? calledNext);
  return { waiting: waiting.length, needsAssess: needsAssess.length, needsSignoff: needsSignoff.length, inReview: inReview.length, first };
}

export function HomePage() {
  return <PaneFrame startOn="queue" context={null} center={<StartHere />} />;
}

function StartHere() {
  const { entries, loading } = useQueue();
  const me = useMe();
  const nav = useNavigate();
  const reviewer = !!me?.memberships.some(m => canReviewAt(me, m.facilityId));
  const s = startHere(entries, reviewer);
  const f = s.first;
  return (
    <div className="starthere">
      <header><h2>Triage desk</h2><p className="muted small">Start with a new patient, or pick up the next one in the queue.</p></header>

      <Link className="btn btn--primary btn--big starthere__new" to="/intake">New patient</Link>

      {!loading && entries.length === 0 && <p className="muted">Nobody is waiting. When someone arrives, choose New patient.</p>}

      {f && (
        <section className="nextstep" aria-label="Next patient">
          <p className="nextstep__eyebrow">{reviewer && f.assessed && !f.reviewed ? 'Needs sign-off' : !f.assessed ? 'Not assessed yet' : 'Next in line'}</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <UrgencyPlate tier={f.tier} assessed={f.assessed} />
            <h3 className="nextstep__title">{f.patient.full_name}</h3>
          </div>
          <p className="nextstep__detail small" lang={f.patient.preferred_language}>{f.chiefComplaint ?? 'No complaint recorded'}{isTier(f.tier) ? ` · ${TIER_WORD[f.tier]}` : ''}</p>
          <div className="nextstep__actions"><button type="button" className="btn btn--primary btn--big" onClick={() => nav(`/encounters/${f.encounterId}`)}>Open</button></div>
        </section>
      )}

      {s.needsSignoff > 0 && (
        <ul className="starthere__counts" aria-label="Queue summary">
          <li><strong>{s.needsSignoff}</strong> waiting for a nurse or doctor to sign off</li>
        </ul>
      )}
    </div>
  );
}
