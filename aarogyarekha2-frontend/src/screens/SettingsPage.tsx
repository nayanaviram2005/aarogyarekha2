import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { MfaPanel } from '../components/MfaPanel';
import { LanguageSwitcher } from '../i18n/I18n';
import { rolesByFacility, rolesOf } from '../lib/account';
import { useLowData } from '../lib/lowBandwidth';
import { useMe } from './meContext';

/** Personal settings. Things that change how this person works with the app: nothing here changes any patient record or any rule. */
export function SettingsPage() {
  const me = useMe();
  const { mfa, demo } = useAuth();
  const [lowData, setLowData] = useLowData();
  const [mfaOpen, setMfaOpen] = useState(false);
  const aal2 = me?.aal === 'aal2';
  return (
    <main className="settings" aria-label="Settings" style={{ maxWidth: 760, margin: '0 auto', padding: 16, display: 'grid', gap: 16 }}>
      <header><h2>Settings</h2><p className="muted small">Your account and how the app works for you.</p></header>

      <section className="block" aria-label="Account"><div className="block__head"><h3>Account</h3></div><div className="block__body">
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', gap: '6px 16px' }}>
          <dt className="small muted">Name</dt><dd style={{ margin: 0 }}>{!me ? 'Loading…' : me.displayName ?? 'Not set'}</dd>
          <dt className="small muted">Role</dt><dd style={{ margin: 0 }}>{!me ? 'Loading…' : rolesByFacility(me).length === 0 ? 'No role at any facility yet' : rolesByFacility(me).map(f => <div key={f.facility}>{f.facility}: {f.roles.join(', ')}</div>)}</dd>
        </dl>
        {rolesOf(me).length === 0 && me && <p className="small muted" style={{ marginTop: 8 }}>A facility administrator gives roles. Until then you cannot open patient records.</p>}
        <p className="tiny muted" style={{ marginTop: 8 }}>Name and roles are set by your facility administrator. They cannot be changed here.</p>
      </div></section>

      <section className="block" aria-label="Language"><div className="block__head"><h3>Language</h3></div><div className="block__body">
        <LanguageSwitcher />
        <p className="tiny muted" style={{ marginTop: 8 }}>Some screens are still in English only. Hindi and Odia text is written by the team and has not been reviewed by a native speaker.</p>
      </div></section>

      <section className="block" aria-label="Data use"><div className="block__head"><h3>Data use</h3></div><div className="block__body">
        <label className="small" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={lowData} onChange={e => setLowData(e.target.checked)} /> Low data mode</label>
        <p className="tiny muted" style={{ marginTop: 8 }}>Smaller photo uploads and fewer background refreshes, for a weak connection.</p>
      </div></section>

      {!demo && (
        <section className="block" aria-label="Two-factor sign-in"><div className="block__head"><h3>Two-factor sign-in</h3><span className={aal2 ? 'chip chip--ok' : 'chip'}>{aal2 ? 'Verified in this session' : me?.mfaRequired ? 'Needed' : 'Not required here'}</span></div><div className="block__body">
          <p className="small">An authenticator app code is asked before reviewing a case, completing a visit or sending a referral{me?.mfaRequired === false ? ', when this deployment requires it. It is switched off here' : ''}.</p>
          {mfa && !mfaOpen && <button type="button" className="btn btn--small" onClick={() => setMfaOpen(true)}>{aal2 ? 'Verify again' : 'Set up or verify'}</button>}
          {mfa && mfaOpen && <div style={{ marginTop: 8 }}><MfaPanel mfa={mfa} onVerified={() => setMfaOpen(false)} /></div>}
        </div></section>
      )}

      <section className="block" aria-label="Sessions"><div className="block__head"><h3>Sign-in session</h3></div><div className="block__body">
        <p className="small">You are signed out after {__IDLE_MINUTES__} minutes without activity. Closing the tab also ends the session.</p>
      </div></section>

      <section className="block" aria-label="About"><div className="block__head"><h3>About</h3></div><div className="block__body">
        <p className="small">AarogyaRekha organises information for review. It does not diagnose or advise treatment. Every priority is a draft until a nurse or doctor signs it. Every view of a patient record is logged.</p>
      </div></section>
    </main>
  );
}
