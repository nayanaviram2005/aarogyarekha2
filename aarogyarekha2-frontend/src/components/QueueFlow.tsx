import { useEffect, useState } from 'react';
import { OUTCOME_TEXT } from './VisitPanel';
import { formatTime, TIER_WORD, tierOfUrgency } from '../lib/format';
import type { Api, DoneEntry, QueueEntry } from '../lib/types';

const TIERS = [1, 2, 3, 4] as const;

/** How full the queue is, at a glance: who waits at each priority, who is in review, and how many were finished today. */
export function QueueCounts({ entries, doneCount, onShowDone, showingDone }: { entries: QueueEntry[]; doneCount: number | null; onShowDone: () => void; showingDone: boolean }) {
  const waiting = entries.filter(e => e.queueStatus !== 'in_review');
  const seeing = entries.length - waiting.length;
  const byTier = TIERS.map(t => ({ t, n: waiting.filter(e => e.tier === t).length }));
  const unassessed = waiting.filter(e => !e.assessed).length;
  return (
    <div className="queue-counts" role="group" aria-label="Queue at a glance" style={{ padding: '8px 12px', display: 'grid', gap: 6, borderBottom: '1px solid var(--rule)' }}>
      <p className="small" style={{ margin: 0 }}><strong>{waiting.length} waiting</strong>{byTier.some(x => x.n > 0) && <> · {byTier.filter(x => x.n > 0).map(x => `${x.n} ${TIER_WORD[x.t].toLowerCase()}`).join(', ')}</>}{unassessed > 0 && <> · {unassessed} not assessed</>}</p>
      <p className="small muted" style={{ margin: 0 }}>{seeing} in review · <button type="button" className="linklike" aria-pressed={showingDone} onClick={onShowDone}>{showingDone ? 'Back to the queue' : `Done today${doneCount != null ? ` (${doneCount})` : ''}`}</button></p>
    </div>
  );
}

/** Patients who were seen or sent on in the last day. They have left the queue; the list is kept for the day so nothing is lost track of. */
export function DoneToday({ api, onLoaded }: { api: Api; onLoaded?: (n: number) => void }) {
  const [rows, setRows] = useState<DoneEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.queueDone(24).then(r => { if (live) { setRows(r); setError(null); onLoaded?.(r.length); } }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [api, onLoaded]);
  return (
    <div className="pane__body" aria-label="Done today">
      {error && <p className="small" role="alert" style={{ padding: 12 }}>{error}</p>}
      {rows === null && !error && <p className="small muted" role="status" style={{ padding: 12 }}>Loading…</p>}
      {rows && rows.length === 0 && <p className="small muted" style={{ padding: 12 }}>No one has been completed in the last 24 hours.</p>}
      {rows && rows.length > 0 && (
        <ul>{rows.map(r => {
          const t = tierOfUrgency(r.urgencyCode);
          return (
            <li key={r.encounterId} className="queue-row" style={{ cursor: 'default' }}>
              <span className="queue-row__name"><span>{r.patientName ?? r.patientRef}</span><span className="muted small">{r.patientRef}</span></span>
              <span className="queue-row__side"><span className="chip">{r.outcome ? OUTCOME_TEXT[r.outcome] : 'Done'}</span>{t && <span className="small muted">{TIER_WORD[t]}</span>}<span className="queue-row__wait">{formatTime(r.finishedAt)}</span></span>
              <span className="queue-row__sub tiny muted">{r.by ? `By ${r.by}` : ''}{r.by && r.waitedMinutes != null ? ' · ' : ''}{r.waitedMinutes != null ? `waited ${r.waitedMinutes} min` : ''}</span>
            </li>
          );
        })}</ul>
      )}
    </div>
  );
}
