import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UrgencyPlate } from '../components/Plate';
import { Banner } from '../components/Provenance';
import { ageSex, formatWait } from '../lib/format';
import { BOARD_SCENARIOS, clusterSignal, CLUSTER_RULE, summarizeScenario } from '../lib/scenarios';
import { PaneFrame } from './PaneFrame';
import { useQueue } from './queueContext';

export function ScenariosPage() {
  return <PaneFrame startOn="note" center={<Board />} context={<div style={{ padding: 16 }}><p className="small muted">These boards group people who are waiting by type of visit. They count recorded visits. They do not say what is causing them.</p></div>} />;
}

function Board() {
  const { entries, loading } = useQueue();
  const [scenario, setScenario] = useState(BOARD_SCENARIOS[0]!.value);
  const now = useMemo(() => new Date(), [entries]);   // eslint-disable-line react-hooks/exhaustive-deps
  const def = BOARD_SCENARIOS.find(s => s.value === scenario)!;
  const sum = summarizeScenario(entries, scenario);
  const cluster = scenario === 'campus_fever' ? clusterSignal(entries, scenario, now) : null;
  const rows = entries.filter(e => e.scenario === scenario);

  return (
    <>
      <header><h2>Scenario boards</h2><p className="muted small">People waiting, by type of visit.</p></header>

      <div role="tablist" aria-label="Type of visit" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {BOARD_SCENARIOS.map(s => (
          <button key={s.value} role="tab" aria-selected={s.value === scenario} className={`btn btn--small${s.value === scenario ? ' btn--primary' : ''}`} onClick={() => setScenario(s.value)}>
            {s.label} ({summarizeScenario(entries, s.value).total})
          </button>
        ))}
      </div>
      <p className="small">{def.note}</p>

      {cluster && (cluster.flagged
        ? <Banner kind="warn" title={`${cluster.count} similar visits in the last ${cluster.windowHours} hours`}>
            This is at or above the alert count of {cluster.threshold}. Consider telling the facility in-charge or the district surveillance officer so they can look into it. This is a count of visits, not a finding about the cause.
            <span className="tiny muted" style={{ display: 'block' }}>The alert count is a placeholder, not set by a public-health authority{CLUSTER_RULE.validated ? '' : ' yet'}.</span>
          </Banner>
        : <p className="small muted" role="status">{cluster.count} similar visit{cluster.count === 1 ? '' : 's'} in the last {cluster.windowHours} hours. Alert count: {cluster.threshold} (placeholder).</p>)}

      {scenario === 'health_camp' && <div><Link className="btn btn--primary" to="/camp">Camp registration</Link></div>}

      <section className="block" aria-label="Priority counts">
        <div className="block__head"><h3>{def.label}: {sum.total} waiting</h3></div>
        <div className="block__body" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {([1, 2, 3, 4] as const).map(t => <span key={t} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><UrgencyPlate tier={t} /> <strong>{sum.byTier[t]}</strong></span>)}
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><UrgencyPlate tier={null} assessed={false} /> <strong>{sum.notAssessed}</strong></span>
        </div>
      </section>

      <section className="block" aria-label="People waiting">
        <div className="block__head"><h3>Waiting</h3></div>
        <div className="block__body block__body--flush">
          {loading && <p className="muted small" style={{ padding: 12 }} role="status">Loading…</p>}
          {!loading && rows.length === 0 && <p className="muted small" style={{ padding: 12 }}>No one is waiting for this type of visit.</p>}
          <ul>
            {rows.map(e => (
              <li key={e.encounterId}>
                <Link className="queue-row" to={`/encounters/${e.encounterId}`}>
                  <span className="queue-row__name"><span>{e.patient.full_name}</span><span className="muted small strong">{ageSex(e.patient, now)}</span></span>
                  <span className="queue-row__side"><UrgencyPlate tier={e.tier} assessed={e.assessed} /><span className="queue-row__wait">{formatWait(e.waitingSince, now)}</span></span>
                  <span className="queue-row__sub" lang={e.patient.preferred_language}>{e.chiefComplaint ?? 'No complaint recorded'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
