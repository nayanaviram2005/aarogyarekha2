import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { HACKATHON_MESSAGE, SHOW_HACKATHON_BAR, SHOW_SLOW_SERVER_NOTICE, SLOW_SERVER_MESSAGE } from '../config';

interface SharedPause { paused: boolean; toggle: () => void; showButton: boolean }

function SlidingNote({ message, label, tone, shared }: { message: string; label: string; tone: 'prototype' | 'warn'; shared?: SharedPause }) {
  const [own, setOwn] = useState(false);
  const paused = shared ? shared.paused : own;
  const toggle = shared ? shared.toggle : () => setOwn(p => !p);
  return (
    <div className={tone === 'warn' ? 'hbar hbar--warn' : 'hbar'} role="note" aria-label={label} data-paused={paused}>
      <div className="hbar__viewport">
        <div className="hbar__track">
          <span className="hbar__text">{message}</span>
          <span className="hbar__text hbar__text--copy" aria-hidden="true">{message}</span>
        </div>
      </div>
      {(!shared || shared.showButton) && <button className="hbar__pause" aria-pressed={paused} onClick={toggle} title={shared ? 'Pause or play both moving notices' : undefined}>{paused ? 'Play' : 'Pause'}</button>}
    </div>
  );
}

export function HackathonBar() {
  if (!SHOW_HACKATHON_BAR) return null;
  return <SlidingNote message={HACKATHON_MESSAGE} label="Prototype notice" tone="prototype" />;
}

export function SlowServerBar() {
  const { status } = useAuth();
  const { pathname } = useLocation();
  const onSignIn = status === 'signedOut' && pathname !== '/';
  if (!SHOW_SLOW_SERVER_NOTICE || onSignIn) return null;
  return <SlidingNote message={SLOW_SERVER_MESSAGE} label="Speed notice" tone="warn" />;
}

export function NoticeBars() {
  const [paused, setPaused] = useState(false);
  const { status } = useAuth();
  const { pathname } = useLocation();
  const showSlow = SHOW_SLOW_SERVER_NOTICE && !(status === 'signedOut' && pathname !== '/');
  const toggle = () => setPaused(p => !p);
  return (
    <div className="bars" data-paused={paused}>
      {SHOW_HACKATHON_BAR && <SlidingNote message={HACKATHON_MESSAGE} label="Prototype notice" tone="prototype" shared={{ paused, toggle, showButton: true }} />}
      {showSlow && <SlidingNote message={SLOW_SERVER_MESSAGE} label="Speed notice" tone="warn" shared={{ paused, toggle, showButton: !SHOW_HACKATHON_BAR }} />}
    </div>
  );
}
