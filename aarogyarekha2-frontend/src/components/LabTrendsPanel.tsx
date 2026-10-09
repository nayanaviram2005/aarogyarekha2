import { useEffect, useState } from 'react';
import { changeWord, sparkPoints } from '../lib/sparkline';
import type { Api, LabTrend, LabTrends } from '../lib/types';
import { formatTime } from '../lib/format';

const W = 140, H = 36;

function Spark({ t }: { t: LabTrend }) {
  const nums = t.points.filter(p => p.value !== null);
  const pts = sparkPoints(nums.map(p => p.value as number), W, H);
  const summary = `${t.label}: ${nums.map(p => p.value).join(', then ')}${t.unit ? ' ' + t.unit : ''}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ flex: 'none' }}>
      <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--ink-2)" strokeWidth="1.5" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={nums[i]!.verified ? 'var(--ink)' : 'var(--paper)'} stroke="var(--ink)" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

export function LabTrendsPanel({ api, patientId, refreshKey = 0 }: { api: Api; patientId: string; refreshKey?: number }) {
  const [data, setData] = useState<LabTrends | null>(null);
  useEffect(() => {
    let live = true;
    api.labTrends(patientId).then(d => { if (live) setData(d); }).catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [api, patientId, refreshKey]);

  const shown = (data?.tests ?? []).filter(t => t.points.filter(p => p.value !== null).length >= 2);
  if (shown.length === 0) return null;
  return (
    <section className="block" aria-label="Results over time">
      <div className="block__head"><h3>Results over time</h3><span className="chip">{data!.visits} visits</span></div>
      <div className="block__body">
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {shown.map(t => {
            const nums = t.points.filter(p => p.value !== null);
            const last = nums[nums.length - 1]!, first = nums[0]!;
            return (
              <li key={t.name} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
                <strong style={{ minWidth: 150 }}>{t.label}</strong>
                <Spark t={t} />
                <span className="small">
                  {nums.map(p => p.value).join(' → ')}{t.unit ? ` ${t.unit}` : ''}
                  {t.change && <span className="muted"> · {changeWord(t.change.direction)} than the one before ({t.change.from} to {t.change.to})</span>}
                  {t.unitsDiffer && <span className="muted"> · the units differ between reports, so no comparison is shown</span>}
                </span>
                <span className="tiny muted">{formatTime(first.at)} to {formatTime(last.at)}{nums.some(p => !p.verified) ? ' · hollow dots are not yet checked by a person' : ''}</span>
              </li>
            );
          })}
        </ul>
        <p className="tiny muted">Values copied from the patient's earlier reports, by the date each report was added. This only shows how numbers changed. It does not say whether a change is good or bad, and it does not change the priority.</p>
      </div>
    </section>
  );
}
