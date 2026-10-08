import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UrgencyPlate } from '../components/Plate';
import { useI18n } from '../i18n/I18n';
import { ageSex, formatWait, isTier } from '../lib/format';
import { QueueFilterBar } from '../components/QueueFilterBar';
import { applyQueueFilter, NO_FILTER, type QueueFilter } from '../lib/queueFilter';
import { useAuth } from '../auth/AuthProvider';
import { DoneToday, QueueCounts } from '../components/QueueFlow';
import { useMe } from './meContext';
import { useQueue } from './queueContext';

export function QueuePane({ onOpen }: { onOpen?: () => void }) {
  const { entries, loading, error, refresh } = useQueue();
  const { t } = useI18n();
  const { id: current } = useParams();
  const nav = useNavigate();
  const me = useMe();
  const { api } = useAuth();
  const [filter, setFilter] = useState<QueueFilter>(NO_FILTER);
  const [showDone, setShowDone] = useState(false);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const facilityNames = Object.fromEntries((me?.memberships ?? []).map(m => [m.facilityId, m.facilityName ?? m.facilityId.slice(0, 8)]));
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(t); }, []);

  return (
    <section className="pane pane--queue" aria-label={t('queue.title')}>
      <div className="pane__head">
        <h2>{t('queue.title')}</h2>
        <span className="muted small" aria-live="polite">{loading ? t('queue.loading') : t('queue.waiting', { n: entries.length })}</span>
        <span className="grow" />
        <button className="btn btn--small btn--quiet" onClick={() => void refresh()}>{t('queue.refresh')}</button>
        <Link className="btn btn--small btn--primary" to="/intake">{t('queue.new')}</Link>
      </div>
      {api && <QueueCounts entries={entries} doneCount={doneCount} showingDone={showDone} onShowDone={() => setShowDone(v => !v)} />}
      {showDone && api ? <DoneToday api={api} onLoaded={setDoneCount} /> : <>
      {entries.length > 1 && <QueueFilterBar entries={entries} value={filter} onChange={setFilter} facilityNames={facilityNames} shown={applyQueueFilter(entries, filter, now).length} />}
      {error && <div className="banner banner--warn" role="status" style={{ margin: 8 }}><div className="small">{t('queue.stale')} {error}</div></div>}
      <div className="pane__body">
        {!loading && entries.length === 0 && !error && (
          <div className="empty">
            <h3>{t('queue.emptyTitle')}</h3>
            <p>{t('queue.emptyBody')}</p>
            <Link className="btn btn--primary" to="/intake">{t('queue.new')}</Link>
          </div>
        )}
        <ul>
          {applyQueueFilter(entries, filter, now).map(e => (
            <li key={e.encounterId}>
              <button className="queue-row" aria-current={e.encounterId === current} onClick={() => { nav(`/encounters/${e.encounterId}`); onOpen?.(); }}>
                <span className="queue-row__name"><span>{e.patient.full_name}</span><span className="muted small strong">{ageSex(e.patient, now)}</span></span>
                <span className="queue-row__side">
                  <UrgencyPlate tier={e.tier} assessed={e.assessed} />
                  {e.queueStatus === 'in_review' && <span className="chip chip--ok">In review</span>}
                  {e.reviewed && <span className="chip chip--ok">{t('queue.reviewed')}</span>}
                  {e.assessed && !e.reviewed && e.queueStatus !== 'in_review' && <span className="chip chip--warn" title="A nurse or doctor has not signed off the priority yet">Needs sign-off</span>}
                  {e.waitingLong && <span className="chip" title="Has waited a long time for this priority. A person should look.">Waiting long</span>}
                  <span className="queue-row__wait">{formatWait(e.waitingSince, now)}</span>
                </span>
                <span className="queue-row__sub" lang={e.patient.preferred_language}>{e.chiefComplaint ?? t('queue.noComplaint')}</span>
                {e.assessed && isTier(e.potentialTier) && isTier(e.tier) && e.potentialTier < e.tier && (
                  <span className="queue-row__sub tiny strong" style={{ gridColumn: '1 / -1' }}>{t('queue.couldBe', { tier: t(`tier.${e.potentialTier}`).toLowerCase(), n: e.missingCount })}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
      </>}
    </section>
  );
}
