import type { Journey, StepKey } from '../lib/journey';

/**
 * The steps of a triage-desk visit. Each one is a button: choosing it shows that step right here, so something already done can be
 * looked at or changed. The step the system recommends next is marked; the one on screen is highlighted.
 */
export function JourneyBar({ j, selected, onSelect }: { j: Journey; selected: StepKey; onSelect: (k: StepKey) => void }) {
  return (
    <nav aria-label="Steps for this patient">
      <ol className="journey">
        {j.steps.map((s, n) => (
          <li key={s.key} className={`journey__step journey__step--${s.state}${s.key === selected ? ' journey__step--selected' : ''}`}>
            <button type="button" className="journey__button" aria-current={s.key === selected ? 'step' : undefined} onClick={() => onSelect(s.key)}
              title={s.state === 'done' ? 'Done. Choose to look at it or change it.' : s.state === 'current' ? 'The next step' : undefined}>
              <span className="journey__mark" aria-hidden="true">{s.state === 'done' ? '✓' : n + 1}</span>
              <span className="journey__text"><span className="journey__label">{s.label}</span>{s.note && <span className="journey__note">{s.note}</span>}</span>
              {s.state === 'current' && <span className="journey__next">Next</span>}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
