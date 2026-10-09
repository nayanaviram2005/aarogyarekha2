import { useState } from 'react';
import type { Api } from '../lib/types';
import { Banner } from './Provenance';

const LANGS: { value: 'en' | 'hi' | 'or'; label: string }[] = [{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }, { value: 'or', label: 'ଓଡ଼ିଆ' }];
const known = (l: string | null | undefined): l is 'en' | 'hi' | 'or' => l === 'en' || l === 'hi' || l === 'or';

export function HandoverButton({ api, encounterId, patientLanguage }: { api: Api; encounterId: string; patientLanguage: string | null }) {
  const [lang, setLang] = useState<'en' | 'hi' | 'or'>(known(patientLanguage) ? patientLanguage : 'en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const f = await api.downloadHandoverPdf(encounterId, lang);
      const url = URL.createObjectURL(f.blob);
      const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }

  return (
    <section className="block" aria-label="Handover summary">
      <div className="block__head"><h3>Handover summary</h3></div>
      <div className="block__body">
        <p className="small muted">One page for the next person: patient, complaint, priority with its reasons and sign-off, latest measurements and what the reports printed.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="handover-lang" className="small">Language</label>
          <select id="handover-lang" className="select" value={lang} onChange={e => setLang(e.target.value as 'en' | 'hi' | 'or')} disabled={busy} style={{ width: 'auto' }}>
            {LANGS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button type="button" className="btn" onClick={() => void download()} disabled={busy}>{busy ? 'Preparing…' : 'Download summary (PDF)'}</button>
        </div>
        {lang !== 'en' && <p className="tiny muted">Hindi and Odia wording is a draft pending native-speaker review.</p>}
        {error && <Banner kind="error" title="Not downloaded">{error.message}</Banner>}
      </div>
    </section>
  );
}
