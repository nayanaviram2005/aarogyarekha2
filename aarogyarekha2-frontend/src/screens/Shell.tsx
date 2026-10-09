import { useCallback, useEffect, useState } from 'react';
import { MfaPanel } from '../components/MfaPanel';
import { SwitchPatient } from '../components/SwitchPatient';
import { useLowData } from '../lib/lowBandwidth';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n/I18n';
import { AccountMenu } from '../components/AccountMenu';
import type { Me } from '../lib/types';
import { QueueProvider } from './queueContext';
import { MeContext } from './meContext';
import { useApiHealth } from '../lib/useApiHealth';

export function Shell() {
  const { api, demo, signOut, mfa } = useAuth();
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const health = useApiHealth(api ?? null);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [lowData, setLowData] = useLowData();
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSwitchOpen(o => !o); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const [meFailed, setMeFailed] = useState(false);
  const reloadMe = useCallback(() => { void api?.me().then(x => { setMe(x); setMeFailed(false); }).catch(() => { setMe(null); setMeFailed(true); }); }, [api]);
  useEffect(reloadMe, [reloadMe]);
  useEffect(() => { if (!meFailed) return; const t = window.setTimeout(reloadMe, 2500); return () => window.clearTimeout(t); }, [meFailed, reloadMe]);
  const nav = useNavigate(); const loc = useLocation();
  useEffect(() => { if (me?.isPlatformAdmin && me.memberships.length === 0 && loc.pathname === '/') nav('/platform', { replace: true }); }, [me, loc.pathname, nav]);
  const needMfa = !demo && me?.mfaRequired === true && me.aal !== 'aal2';

  const facilityLine = [...new Set((me?.memberships ?? []).map(x => x.facilityName).filter(Boolean))].join(' · ');
  const isPlatform = me?.isPlatformAdmin === true;
  const isAdmin = !!me?.memberships.some(x => x.role === 'facility_admin');
  const isClinical = !!me?.memberships.some(x => ['health_worker', 'nurse', 'doctor', 'medical_officer'].includes(x.role));
  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar__brand">AarogyaRekha</span>
        <nav className="topbar__nav" aria-label="Main"><NavLink to="/" end>Queue</NavLink><NavLink to="/scenarios">Scenarios</NavLink>{isClinical && <NavLink to="/referrals">Referrals</NavLink>}<NavLink to="/offline">Offline notes</NavLink>{isClinical && <NavLink to="/emergency">Emergency access</NavLink>}{isAdmin && <NavLink to="/admin">Admin</NavLink>}{isPlatform && <NavLink to="/platform">Facilities</NavLink>}</nav>
        <div className="topbar__ctx">
          {facilityLine && <span><strong>{facilityLine}</strong></span>}
        </div>
        <div className="topbar__right">
          {demo && <span className="demo-flag" title="Synthetic data held in memory. Not connected to any database.">DEMO DATA</span>}
          <span className={`status ${health === 'online' ? 'status--ok' : health === 'offline' ? 'status--bad' : 'status--wait'}`} role="status">
            <span className="status__mark" aria-hidden="true" />
            {health === 'online' ? t('shell.connected') : health === 'offline' ? t('shell.offline') : t('shell.connecting')}
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
