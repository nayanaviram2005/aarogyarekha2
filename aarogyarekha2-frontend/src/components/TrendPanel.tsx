import { useEffect, useState } from 'react';
import { formatTime } from '../lib/format';
import { DIRECTION_TEXT, summarizeTrend, TREND_KINDS, type TrendSummary } from '../lib/trends';
import type { Api, TrendReading } from '../lib/types';
import { Banner } from './Provenance';

function Spark({ s }: { s: TrendSummary }) {
  const w = 120, h = 28; const pts = s.points.slice(-12); const lo = Math.min(...pts.map(p => p.value)), hi = Math.max(...pts.map(p => p.value));
  const x = (i: number) => (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * (w - 4) + 2); const y = (v: number) => (hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6));
  return <svg width={w} height={h} role="img" aria-label={`Last ${pts.length} readings`}><polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />{pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="2" fill="currentColor" />)}</svg>;
}

export function TrendPanel({ api, patientId, refreshKey }: { api: Api; patientId: string; refreshKey?: unknown }) {
  const [pts, setPts] = useState<TrendReading[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { let live = true; api.trends(patientId).then(p => { if (live) { setPts(p); setError(null); } }).catch(e => { if (live) { setError(e as Error); setPts([]); } }); return () => { live = false; }; }, [api, patientId, refreshKey]);

  const sums = TREND_KINDS.map(k => ({ k, s: summarizeTrend((pts ?? []).map(p => ({ kind: p.kind, value: p.value, unit: p.unit, at: p.at })), k.kind) }));
  return (
    <section className="block" aria-label="Readings over time">
      <div className="block__head"><h3>Readings over time</h3></div>
      <div className="block__body">
        <p className="tiny muted">Readings from this patient's visits. The system shows what changed. It does not say whether a value is good or bad.</p>
        {error && <Banner kind="error" title="Readings">{error.message}</Banner>}
        {pts === null && <p className="small muted" role="status">Loading…</p>}
        {pts && !sums.some(x => x.s) && !error && <p className="small muted">No blood pressure or sugar readings recorded yet.</p>}
        {sums.filter(x => x.s).map(({ k, s }) => (
          <div key={k.kind} style={{ borderTop: '1px solid var(--rule)', padding: '8px 0' }}>
            <p className="small"><strong>{k.label}</strong> · {s!.n} reading{s!.n === 1 ? '' : 's'}</p>
            <p className="small">Latest <strong>{s!.latest.value} {k.unit}</strong> on {formatTime(s!.latest.at)}{s!.previous && <>. Before that {s!.previous.value} on {formatTime(s!.previous.at)}</>}. Lowest {s!.min}, highest {s!.max}.</p>
            <p className="small muted">{DIRECTION_TEXT[s!.direction]}.</p>
            <span style={{ color: 'var(--ink-2)' }}><Spark s={s!} /></span>
          </div>
        ))}
      </div>
    </section>
  );
}
