import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createApi } from '../lib/api';
import type { Api, MfaApi } from '../lib/types';

/** Development-only demo mode: ?demo=1 (add &rules=unapproved to see the "rules not approved" state, ?demo=0 to leave). */
function demoRequested(): { on: boolean; rulesApproved: boolean } {
  if (!import.meta.env.DEV) return { on: false, rulesApproved: true };
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('demo') === '0') { sessionStorage.removeItem('ar.demo'); sessionStorage.removeItem('ar.demo.rules'); }
    if (q.get('demo') === '1') { sessionStorage.setItem('ar.demo', '1'); if (q.get('rules')) sessionStorage.setItem('ar.demo.rules', q.get('rules')!); }
    return { on: sessionStorage.getItem('ar.demo') === '1', rulesApproved: sessionStorage.getItem('ar.demo.rules') !== 'unapproved' };
  } catch { return { on: false, rulesApproved: true }; }
}

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  // The session lives in sessionStorage, not localStorage: closing the tab ends it. Clinic computers are shared.
  client ??= createClient(__SUPABASE_URL__, __SUPABASE_ANON_KEY__, { auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage } });
  return client;
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  demo: boolean;
  api: Api | null;
  notice: string | null;
  signIn(email: string, password: string): Promise<string | null>;   // returns an error message, or null on success
  signOut(): Promise<void>;
  /** Null in demo mode (no real login to protect). */
  mfa: MfaApi | null;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => { const v = useContext(Ctx); if (!v) throw new Error('useAuth outside AuthProvider'); return v; };

export function AuthProvider({ children }: { children: ReactNode }) {
  const demo = useMemo(demoRequested, []);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [api, setApi] = useState<Api | null>(null);
  const [notice, setNotice] = useState<string | null>(() => { try { const n = sessionStorage.getItem('ar.notice'); sessionStorage.removeItem('ar.notice'); return n; } catch { return null; } });

  // Demo mode: synthetic data, no login. The module is only imported in development builds.
  useEffect(() => {
    if (!demo.on) return;
    let live = true;
    // The import sits INSIDE the DEV check so the bundler removes the whole demo module from a production build.
    if (import.meta.env.DEV) {
      void import('../demo/demoApi').then(m => { if (live) { setApi(m.createDemoApi({ rulesApproved: demo.rulesApproved })); setStatus('signedIn'); } });
    }
    return () => { live = false; };
  }, [demo]);

  // Real mode.
  useEffect(() => {
    if (demo.on) return;
    const sb = supabase();
    setApi(createApi(__API_URL__, async () => (await sb.auth.getSession()).data.session?.access_token ?? null));
    void sb.auth.getSession().then(({ data }) => setStatus(data.session ? 'signedIn' : 'signedOut'));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setStatus(session ? 'signedIn' : 'signedOut'));
    return () => sub.subscription.unsubscribe();
  }, [demo]);

  const signOut = useCallback(async () => { if (demo.on) { sessionStorage.removeItem('ar.demo'); window.location.assign('/'); return; } await supabase().auth.signOut(); }, [demo]);

  // Sign out after a period with no activity.
  useEffect(() => {
    if (status !== 'signedIn' || demo.on) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try { sessionStorage.setItem('ar.notice', `You were signed out after ${__IDLE_MINUTES__} minutes without activity.`); } catch { /* ignore */ }
        setNotice(`You were signed out after ${__IDLE_MINUTES__} minutes without activity.`);
        void supabase().auth.signOut();
      }, __IDLE_MINUTES__ * 60000);
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach(e => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => { window.clearTimeout(timer); events.forEach(e => window.removeEventListener(e, arm)); };
  }, [status, demo]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (!error) { setNotice(null); return null; }
    return error.status === 400 || error.status === 401 ? 'The email or password is not correct.' : 'Sign-in failed. Check your connection and try again.';
  }, []);

  const mfa = useMemo<MfaApi | null>(() => (demo.on ? null : {
    async hasFactor() {
      const { data, error } = await supabase().auth.mfa.listFactors();
      if (error) throw new Error('Two-factor settings could not be loaded. Try again.');
      return data.totp.some(f => f.status === 'verified');
    },
    async enroll() {
      const sb = supabase();
      // A half-finished earlier attempt blocks a new one; remove it first.
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.all ?? []) if (f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
      if (error || !data) throw new Error('Two-factor setup could not be started. Try again.');
      return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    async verify(code, factorId) {
      const sb = supabase();
      let id = factorId;
      if (!id) { const { data } = await sb.auth.mfa.listFactors(); id = data?.totp.find(f => f.status === 'verified')?.id; }
      if (!id) return 'No authenticator is set up for this account.';
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: id, code: code.trim() });
      return error ? 'That code is not correct, or it has expired. Check the code in your app and try again.' : null;
    },
  }), [demo.on]);

  const value = useMemo<AuthState>(() => ({ status, demo: demo.on, api, notice, signIn, signOut, mfa }), [status, demo.on, api, notice, signIn, signOut, mfa]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
