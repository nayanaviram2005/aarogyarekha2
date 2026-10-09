import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { HACKATHON_MESSAGE, SHOW_HACKATHON_BAR, SHOW_SLOW_SERVER_NOTICE, SLOW_SERVER_MESSAGE } from '../config';

/**
 * A strip with a sliding message. It must stay honest and readable:
 *  - the full message is available to screen readers once (the repeated copy is hidden from them),
 *  - it pauses on hover, on keyboard focus, and with a Pause button (moving text must be stoppable),
 *  - with "reduce motion" set on the device it does not move at all and wraps instead.
 */
function SlidingNote({ message, label, tone }: { message: string; label: string; tone: 'prototype' | 'warn' }) {
  const [paused, setPaused] = useState(false);
  return (
    <div className={tone === 'warn' ? 'hbar hbar--warn' : 'hbar'} role="note" aria-label={label} data-paused={paused}>
      <div className="hbar__viewport">
        <div className="hbar__track">
          <span className="hbar__text">{message}</span>
          <span className="hbar__text hbar__text--copy" aria-hidden="true">{message}</span>
        </div>
      </div>
      <button className="hbar__pause" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Play' : 'Pause'}</button>
    </div>
  );
}

/** A plain black bar saying this is a prototype. */
export function HackathonBar() {
  if (!SHOW_HACKATHON_BAR) return null;
  return <SlidingNote message={HACKATHON_MESSAGE} label="Prototype notice" tone="prototype" />;
}

/**
 * An amber bar warning that answers may be slow. It shows on every page except the sign-in page, which carries the same warning
 * above its card instead (a sliding line over a form is hard to read while typing).
 */
export function SlowServerBar() {
  const { status } = useAuth();
  const { pathname } = useLocation();
  const onSignIn = status === 'signedOut' && pathname !== '/';
  if (!SHOW_SLOW_SERVER_NOTICE || onSignIn) return null;
  return <SlidingNote message={SLOW_SERVER_MESSAGE} label="Speed notice" tone="warn" />;
}
