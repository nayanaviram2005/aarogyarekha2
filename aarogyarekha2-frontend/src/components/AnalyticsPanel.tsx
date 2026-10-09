import { useEffect, useState } from 'react';
import { scenarioLabel, TIER_WORD, tierOfUrgency } from '../lib/format';
import type { Api, AnalyticsView, Spread } from '../lib/types';
import { Banner } from './Provenance';

const fmtSec = (s: number | null) => (s === null ? 'no data' : s < 60 ? `${s} seconds` : `${Math.round(s / 6) / 10} minutes`);
const fmtMin = (m: number | null) => (m === null ? 'no data' : m < 60 ? `${m} minutes` : `${Math.round(m / 6) / 10} hours`);
const spread = (s: Spread, f: (n: number | null) => string) => (s.n === 0 ? 'No data yet' : `Typical ${f(s.median)}; 9 in 10 within ${f(s.p90)} (${s.n} visits)`);

export function AnalyticsPanel({ api }: { api: Api }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [a, setA] = useState<AnalyticsView | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { let live = true; setA(null); api.analytics(days).then(x => { if (live) { setA(x); setError(null); } }).catch(e => { if (live) setError(e as Error); }); return () => { live = false; }; }, [api, days]);

  return (
    <section className="block" aria-label="Activity and agreement">
      <div className="block__head"><h3>Activity and agreement</h3></div>
      <div className="block__body">
        <div className="field" style={{ maxWidth: 220 }}><label htmlFor="an-days">Period</label>
          <select id="an-days" className="select" value={days} onChange={e => setDays(Number(e.target.value) as 7 | 30 | 90)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></div>
        {error && <Banner kind="error" title="Figures">{error.message}</Banner>}
        {!a && !error && <p className="small muted" role="status">Loading…</p>}
        {a && (
          <>
            <p className="tiny muted">{a.note}</p>
            <table className="table"><tbody>
              <tr><th scope="row">Visits started</th><td className="num">{a.encounters}</td></tr>
              <tr><th scope="row">Submitted to the queue</th><td className="num">{a.submitted}</td></tr>
              <tr><th scope="row">Assessed by the rules</th><td className="num">{a.assessed}</td></tr>
              <tr><th scope="row">Signed off by a reviewer</th><td className="num">{a.reviewed}</td></tr>
              <tr><th scope="row">Time to a draft assessment</th><td>{spread(a.secondsToAssessment, fmtSec)}</td></tr>
              <tr><th scope="row">Wait until a reviewer acts</th><td>{spread(a.minutesToReview, fmtMin)}</td></tr>
              <tr><th scope="row">Reviewer confirmed the rules' priority</th><td className="num">{a.review.approved}</td></tr>
              <tr><th scope="row">Reviewer changed the priority</th><td className="num">{a.review.changed} ({a.review.loweredBelowRules} to less urgent)</td></tr>
              <tr><th scope="row">Agreement</th><td className="num">{a.review.agreementRate === null ? 'no data' : `${Math.round(a.review.agreementRate * 1000) / 10}%`}</td></tr>
              {a.feedback && <tr><th scope="row">Feedback on drafts</th><td>{a.feedback.helpful} helpful, {a.feedback.notHelpful} not helpful</td></tr>}
            </tbody></table>
            {a.byUrgency.length > 0 && <p className="small">By priority: {a.byUrgency.map(u => { const t = tierOfUrgency(u.urgency); return `${t ? TIER_WORD[t] : u.urgency} ${u.n}`; }).join(', ')}</p>}
            {a.byScenario.length > 0 && <p className="small">By type of visit: {a.byScenario.map(s => `${scenarioLabel(s.scenario)} ${s.n}`).join(', ')}</p>}
          </>
        )}
      </div>
    </section>
  );
}
