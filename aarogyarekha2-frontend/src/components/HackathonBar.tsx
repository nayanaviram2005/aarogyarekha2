import { useState } from 'react';
import { HACKATHON_MESSAGE, SHOW_HACKATHON_BAR } from '../config';

/**
 * A plain black bar with a sliding message. It must stay honest and readable:
 *  - the full message is available to screen readers once (the repeated copy is hidden from them),
 *  - it pauses on hover, on keyboard focus, and with a Pause button (moving text must be stoppable),
 *  - with "reduce motion" set on the device it does not move at all and wraps instead.
 */
export function HackathonBar() {
  const [paused, setPaused] = useState(false);
  if (!SHOW_HACKATHON_BAR) return null;
  return (
    <div className="hbar" role="note" aria-label="Prototype notice" data-paused={paused}>
      <div className="hbar__viewport">
        <div className="hbar__track">
          <span className="hbar__text">{HACKATHON_MESSAGE}</span>
          <span className="hbar__text hbar__text--copy" aria-hidden="true">{HACKATHON_MESSAGE}</span>
        </div>
      </div>
      <button className="hbar__pause" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Play' : 'Pause'}</button>
    </div>
  );
}
