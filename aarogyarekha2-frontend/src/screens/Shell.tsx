import { useCallback, useEffect, useState } from 'react';
import { MfaPanel } from '../components/MfaPanel';
import { SwitchPatient } from '../components/SwitchPatient';
import { useLowData } from '../lib/lowBandwidth';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18n';
import { AccountMenu } from '../components/AccountMenu';
import type { Me } from '../lib/types';
import { QueueProvider } from './queueContext';
import { MeContext } from './meContext';

export function Shell() {
  const { api, demo, signOut, mfa } = useAuth();
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [online, setOnline] = useState(true);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [lowData, setLowData] = useLowData();
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSwitchOpen(o => !o); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const [meFailed, setMeFailed] = useState(false);
  const reloadMe = useCallback(() => { void api?.me().then(x => { setMe(x); setMeFailed(false); }).catch(() => { setMe(null); setMeFailed(true); }); }, [api]);
  useEffect(reloadMe, [reloadMe]);
  // The name and roles decide what every screen shows. If they could not load, try once more soon instead of leaving the person with no access.
  useEffect(() => { if (!meFailed) return; const t = window.setTimeout(reloadMe, 2500); return () => window.clearTimeout(t); }, [meFailed, reloadMe]);
  const needMfa = !demo && me?.mfaRequired === true && me.aal !== 'aal2';
  useEffect(() => {
    if (!api) return;
    let live = true;
    const ping = () => void api.health().then(ok => live && setOnline(ok));
    ping();
    const t = window.setInterval(ping, 20_000);
    return () => { live = false; window.clearInterval(t); };
  }, [api]);

  const facilityLine = [...new Set((me?.memberships ?? []).map(x => x.facilityName).filter(Boolean))].join(' · ');
  const isAdmin = !!me?.memberships.some(x => x.role === 'facility_admin');
  const isClinical = !!me?.memberships.some(x => ['health_worker', 'nurse', 'doctor', 'medical_officer'].includes(x.role));
  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar__brand">AarogyaRekha</span>
        <nav className="topbar__nav" aria-label="Main"><NavLink to="/" end>Queue</NavLink><NavLink to="/scenarios">Scenarios</NavLink>{isClinical && <NavLink to="/referrals">Referrals</NavLink>}<NavLink to="/offline">Offline notes</NavLink>{isClinical && <NavLink to="/emergency">Emergency access</NavLink>}{isAdmin && <NavLink to="/admin">Admin</NavLink>}</nav>
        <div className="topbar__ctx">
          {facilityLine && <span><strong>{facilityLine}</strong></span>}
        </div>
        <div className="topbar__right">
          {demo && <span className="demo-flag" title="Synthetic data held in memory. Not connected to any database.">DEMO DATA</span>}
          <span className={`status ${online ? 'status--ok' : 'status--bad'}`} role="status">
            <span className="status__mark" aria-hidden="true" />
            {online ? t('shell.connected') : t('shell.offline')}
          </span>
          <NavLink className="btn btn--small btn--primary topbar__new" to="/intake">New patient</NavLink>
          <button className="btn btn--small" onClick={() => setSwitchOpen(true)} aria-keyshortcuts="Control+K">Switch patient</button>
          <AccountMenu me={me} loadFailed={meFailed} onRetry={reloadMe} lowData={lowData} setLowData={setLowData} needMfa={needMfa} onVerifyMfa={() => setMfaOpen(true)} onSignOut={() => void signOut()} />
        </div>
      </header>
      <div className={needMfa ? 'app-main' : 'app-main app-main--plain'}>
        {needMfa && mfa && (
          <section className="mfa-strip" aria-label="Two-factor sign-in">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong className="small">Two-factor sign-in needed to review cases or send referrals.</strong>
              {!mfaOpen && <button type="button" className="btn btn--small" onClick={() => setMfaOpen(true)}>Verify now</button>}
            </div>
            {mfaOpen && <div style={{ marginTop: 8 }}><MfaPanel mfa={mfa} onVerified={() => { setMfaOpen(false); reloadMe(); }} /></div>}
          </section>
        )}
        <div className="app-main__body"><MeContext.Provider value={me}><QueueProvider><Outlet /></QueueProvider></MeContext.Provider></div>
      </div>
      <SwitchPatient api={api} open={switchOpen} onClose={() => setSwitchOpen(false)} />
      <footer className="legal">{t('shell.legal')}</footer>
    </div>
  );
}
