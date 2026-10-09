import { buildCaseSummary } from '../lib/caseSummary';
import type { EncounterSummary } from '../lib/types';

export function CaseSummary({ summary }: { summary: EncounterSummary }) {
  const lines = buildCaseSummary(summary);
  return (
    <section className="block" aria-label="Timeline summary">
      <div className="block__head"><h3>Timeline summary</h3></div>
      <div className="block__body">
        {lines.length === 0
          ? <p className="small muted">Nothing is recorded for this visit yet.</p>
          : <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', gap: '6px 16px' }}>
              {lines.map(l => (<div key={l.label} style={{ display: 'contents' }}><dt className="small muted">{l.label}</dt><dd style={{ margin: 0 }}>{l.text}</dd></div>))}
            </dl>}
        <p className="tiny muted" style={{ marginTop: 8 }}>Built from what has been recorded. Nothing is inferred or added.</p>
      </div>
    </section>
  );
}
