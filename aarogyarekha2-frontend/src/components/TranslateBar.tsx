import { useState } from 'react';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';
import { ConsentForm } from './ConsentForm';
import { Banner } from './Provenance';

/**
 * "Translate to English" for what the patient said in Hindi or Odia. The patient's separate consent to an outside AI service
 * is required first. The original text stays on screen; the translation is labelled machine output, not verified.
 */
export function TranslateBar({ api, encounterId, patientId, onDone }: { api: Api; encounterId: string; patientId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.translate(encounterId);
      setNeedConsent(false);
      setResult(r.nothingToDo ? 'Everything is already translated.' : `Translated ${r.translated}${r.rejected ? `; ${r.rejected} could not be translated safely and stay in the original language` : ''}.`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /outside AI/i.test(e.message)) setNeedConsent(true); else setError(e as Error);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn--small" onClick={() => void run()} disabled={busy}>{busy ? 'Translating…' : 'Translate to English'}</button>
        <span className="tiny muted">Machine translation, not verified. The original stays on screen. Names and phone numbers are removed before anything is sent.</span>
      </div>
      {result && <p className="small" role="status">{result}</p>}
      {error && <Banner kind="error" title="Not translated">{error.message}</Banner>}
      {needConsent && (
        <>
          <ConsentForm api={api} patientId={patientId} purpose="external_ai_processing" dialog onCancel={() => setNeedConsent(false)} intro={<Banner kind="warn" title="The patient has not agreed to this yet">An outside AI service would read what the patient said. Ask for their separate consent first. You can also just read the original.</Banner>} onRecorded={() => { setNeedConsent(false); void run(); }} />
        </>
      )}
    </div>
  );
}
