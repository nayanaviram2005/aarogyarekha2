import { useState } from 'react';

export function SignOutOthers({ signOutOthers }: { signOutOthers: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true); setMessage(null);
    const problem = await signOutOthers();
    setMessage(problem ? { ok: false, text: problem } : { ok: true, text: 'Every other device or browser where you were signed in has been signed out. This one stays signed in.' });
    setBusy(false);
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p className="small" style={{ margin: 0 }}>If you signed in on a shared or lost device, sign out everywhere else.</p>
      <div><button type="button" className="btn btn--small" onClick={() => void run()} disabled={busy}>{busy ? 'Signing out…' : 'Sign out of my other devices'}</button></div>
      {message && <p className="small" role={message.ok ? 'status' : 'alert'} style={{ margin: 0 }}>{message.text}</p>}
    </div>
  );
}
