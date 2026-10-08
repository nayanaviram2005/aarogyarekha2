import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LanguageSwitcher } from '../i18n/I18n';
import { accountLabel, rolesByFacility, rolesOf } from '../lib/account';
import type { Me } from '../lib/types';

/**
 * The person's name and role in the top right, as a button that opens a menu: who they are, quick settings, other settings and sign out.
 * It is a disclosure: Escape or a click outside closes it and returns focus to the button.
 */
export function AccountMenu({ me, loadFailed, onRetry, lowData, setLowData, needMfa, onVerifyMfa, onSignOut }: {
  me: Me | null; loadFailed?: boolean; onRetry?: () => void;
  lowData: boolean; setLowData: (v: boolean) => void; needMfa: boolean; onVerifyMfa: () => void; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null); const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  const roles = rolesOf(me); const byFacility = rolesByFacility(me);
  const close = () => setOpen(false);
  return (
    <div className="account" ref={root}>
      <button ref={button} type="button" className="account__button" aria-expanded={open} aria-controls="account-menu" aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        <span className="account__label">{accountLabel(me)}</span><span aria-hidden="true" className="account__caret">▾</span>
      </button>
      {open && (
        <div id="account-menu" className="account__menu" role="group" aria-label="Account">
          <div className="account__who">
            <strong>{me?.displayName ?? 'Signed in'}</strong>
            {loadFailed && !me && <p className="small" role="alert">Your name and role could not be loaded. <button type="button" className="linklike" onClick={onRetry}>Try again</button></p>}
            {byFacility.map(f => <p key={f.facility} className="small muted">{f.facility}: {f.roles.join(', ')}</p>)}
            {me && roles.length === 0 && <p className="small muted">No role at any facility yet. Ask your facility administrator.</p>}
          </div>
          <Link className="account__item" to="/settings" onClick={close}>Settings</Link>
          {roles.includes('facility_admin') && <Link className="account__item" to="/admin" onClick={close}>Administration and people</Link>}
          <div className="account__item account__item--row"><LanguageSwitcher /></div>
          <label className="account__item account__item--row small" title="Smaller photo uploads and fewer background refreshes"><input type="checkbox" checked={lowData} onChange={e => setLowData(e.target.checked)} /> Low data mode</label>
          {needMfa && <button type="button" className="account__item" onClick={() => { close(); onVerifyMfa(); }}>Verify two-factor sign-in</button>}
          <button type="button" className="account__item account__item--danger" onClick={() => { close(); onSignOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
