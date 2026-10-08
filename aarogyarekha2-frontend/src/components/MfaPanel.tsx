import { useEffect, useState, type FormEvent } from 'react';
import type { MfaApi } from '../lib/types';
import { Banner } from './Provenance';

/**
 * Second sign-in step for people who change priorities or send records out. Either type the code from the authenticator app
 * the account already has, or set one up first (scan the picture, then type the code it shows).
 */
export function MfaPanel({ mfa, onVerified }: { mfa: MfaApi; onVerified: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'code' | 'setup' | 'scan'>('loading');
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    mfa.hasFactor().then(has => { if (live) setPhase(has ? 'code' : 'setup'); }).catch((e: Error) => { if (live) { setError(e.message); setPhase('setup'); } });
    return () => { live = false; };
  }, [mfa]);

  async function startSetup() {
    setBusy(true); setError(null);
    try { setSetup(await mfa.enroll()); setPhase('scan'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const msg = await mfa.verify(code, phase === 'scan' ? setup?.factorId : undefined).catch(() => 'Verification failed. Check your connection and try again.');
    setBusy(false);
    if (msg) { setError(msg); setCode(''); return; }
    setCode(''); onVerified();
  }

  const codeField = (
    <form onSubmit={submit} noValidate style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="field">
        <label htmlFor="mfa-code">6-digit code from your authenticator app</label>
        <input id="mfa-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} disabled={busy} style={{ width: 140 }} />
      </div>
      <button className="btn btn--primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
    </form>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <Banner kind="error" title="Two-factor sign-in">{error}</Banner>}
      {phase === 'loading' && <p className="small muted" role="status">Loading…</p>}
      {phase === 'code' && codeField}
      {phase === 'setup' && (
        <>
          <p className="small">This account has no authenticator app yet. Set one up with an app such as Google Authenticator or Microsoft Authenticator.</p>
          <div><button type="button" className="btn btn--small" onClick={() => void startSetup()} disabled={busy}>{busy ? 'Starting…' : 'Set up authenticator app'}</button></div>
        </>
      )}
      {phase === 'scan' && setup && (
        <>
          <p className="small">1. Scan this picture with your authenticator app. 2. Type the 6-digit code the app shows.</p>
          <img src={setup.qr} alt="QR code to scan with your authenticator app" width={176} height={176} style={{ background: '#fff', padding: 8, border: '1px solid var(--rule-strong)' }} />
          <p className="small">Cannot scan? Type this key into the app instead: <strong style={{ wordBreak: 'break-all' }}>{setup.secret}</strong></p>
          {codeField}
        </>
      )}
    </div>
  );
}
