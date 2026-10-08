import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Banner } from '../components/Provenance';
import { LanguageSwitcher, useI18n } from '../i18n/I18n';

export function SignIn() {
  const { signIn, notice } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const msg = await signIn(email, password);
    if (msg) { setError(msg); setBusy(false); }
  }

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={submit} noValidate>
        <div className="signin__head">
          <h1>AarogyaRekha</h1>
          <p>{t('app.tagline')}</p>
        </div>
        <div className="signin__body">
          <LanguageSwitcher />
          {notice && <Banner kind="info">{notice}</Banner>}
          {error && <Banner kind="error" title={t('signin.errorTitle')}>{error}</Banner>}
          <div className="field">
            <label htmlFor="email">{t('signin.email')}</label>
            <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} aria-invalid={!!error} />
          </div>
          <div className="field">
            <label htmlFor="password">{t('signin.password')}</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} aria-invalid={!!error} />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy || !email || !password}>{busy ? t('signin.busy') : t('signin.submit')}</button>
        </div>
        <div className="signin__foot">{t('signin.foot')}</div>
      </form>
    </main>
  );
}
