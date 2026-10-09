import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { warmApi } from './lib/warm';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { EncounterPage } from './screens/EncounterPage';
import { HomePage } from './screens/HomePage';
import { IntakePage } from './screens/IntakePage';
import { Shell } from './screens/Shell';
import { ScenariosPage } from './screens/ScenariosPage';
import { CampBatchPage } from './screens/CampBatchPage';
import { OfflinePage } from './screens/OfflinePage';
import { SettingsPage } from './screens/SettingsPage';
import { AdminPage } from './screens/AdminPage';
import { PlatformPage } from './screens/PlatformPage';
import { ReferralsPage } from './screens/ReferralsPage';
import { BreakGlassPage } from './screens/BreakGlassPage';
import { HackathonBar, SlowServerBar } from './components/HackathonBar';
import { I18nProvider } from './i18n/I18n';
import { SignIn } from './screens/SignIn';
import { Landing } from './screens/Landing';

function Gate() {
  const { status, demo } = useAuth();
  // Signed out (the landing and sign-in pages): start waking a sleeping API now, so it is ready by the time the person has signed in.
  useEffect(() => { if (status === 'signedOut' && !demo) warmApi(__API_URL__); }, [status, demo]);
  if (status === 'loading') return <p style={{ padding: 24 }} role="status">Loading…</p>;
  // Signed out: the root explains the app; every other address (including a link to a patient) goes straight to sign-in.
  if (status === 'signedOut') return <Routes><Route index element={<Landing />} /><Route path="*" element={<SignIn />} /></Routes>;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="intake" element={<IntakePage />} />
        <Route path="scenarios" element={<ScenariosPage />} />
        <Route path="camp" element={<CampBatchPage />} />
        <Route path="offline" element={<OfflinePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="platform" element={<PlatformPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="referrals" element={<ReferralsPage />} />
        <Route path="emergency" element={<BreakGlassPage />} />
        <Route path="encounters/:id" element={<EncounterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return <BrowserRouter><I18nProvider><AuthProvider><div className="app-root"><div className="bars"><HackathonBar /><SlowServerBar /></div><Gate /></div></AuthProvider></I18nProvider></BrowserRouter>;
}
