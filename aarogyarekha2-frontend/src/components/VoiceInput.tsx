import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { canRecord, startRecording, type Recording } from '../lib/recorder';
import type { Api } from '../lib/types';
import { ConsentForm } from './ConsentForm';
import { Banner } from './Provenance';

const MAX_SECONDS = 60;
type Lang = 'en' | 'hi' | 'or';
const LANG_LABEL: Record<Lang, string> = { en: 'English', hi: 'Hindi', or: 'Odia' };

/**
 * Say a symptom instead of typing it. The recording is sent to an outside speech service (needs the patient's separate consent),
 * is never stored, and comes back as text that a person must read and correct before it is saved as a symptom.
 */
export function VoiceInput({ api, encounterId, patientId, defaultLanguage, onSaved }: { api: Api; encounterId: string; patientId: string; defaultLanguage: string; onSaved: () => void }) {
  const [lang, setLang] = useState<Lang>(defaultLanguage === 'hi' || defaultLanguage === 'or' ? defaultLanguage : 'en');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const rec = useRef<Recording | null>(null);
  const pending = useRef<Blob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.cancel(); }, []);
  if (!canRecord()) return <p className="small muted">Voice input is not available in this browser. Type the symptom instead.</p>;

  async function send(blob: Blob) {
    setPhase('sending'); setError(null);
    try {
      const r = await api.transcribe(encounterId, blob, lang);
      pending.current = null; setNeedConsent(false); setDraft(r.text);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /outside AI/i.test(e.message)) { pending.current = blob; setNeedConsent(true); }
      else setError(e as Error);
    } finally { setPhase('idle'); }
  }

  async function start() {
    setError(null); setSaved(false); setDraft(null); setNeedConsent(false); setSeconds(0);
    try { rec.current = await startRecording(); } catch (e) { setError(e as Error); return; }
    setPhase('recording');
    timer.current = setInterval(() => setSeconds(s => { if (s + 1 >= MAX_SECONDS) void finish(); return s + 1; }), 1000);
  }

  async function finish() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    const r = rec.current; rec.current = null; if (!r) return;
    await send(await r.stop());
  }

  async function save() {
    if (!draft?.trim()) return;
    setSaving(true); setError(null);
    try { await api.addSymptom(encounterId, { text: draft.trim(), lang }); setDraft(null); setSaved(true); onSaved(); }
    catch (e) { setError(e as Error); } finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="voice-lang" className="small">Spoken language</label>
        <select id="voice-lang" className="select" value={lang} disabled={phase !== 'idle'} onChange={e => setLang(e.target.value as Lang)}>
          {(Object.keys(LANG_LABEL) as Lang[]).map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
        </select>
        {phase === 'idle' && <button type="button" className="btn btn--small" onClick={() => void start()}>Record</button>}
        {phase === 'recording' && <><button type="button" className="btn btn--small" onClick={() => void finish()}>Stop and convert</button><span className="small" role="timer">Recording {seconds}s of {MAX_SECONDS}s</span></>}
        {phase === 'sending' && <span className="small" role="status">Converting to text…</span>}
      </div>
      <p className="tiny muted">The recording is sent to an outside speech service and is not kept. The text below is a machine transcript, not checked. Read it and correct it before saving.</p>

      {error && <Banner kind="error" title="Voice input">{error.message}</Banner>}
      {needConsent && (
        <>
          <ConsentForm api={api} patientId={patientId} purpose="external_ai_processing" dialog onCancel={() => setNeedConsent(false)} intro={<Banner kind="warn" title="The patient has not agreed to this yet">An outside service would hear the patient's voice. Ask for their separate consent first, or type the symptom.</Banner>} onRecorded={() => { setNeedConsent(false); if (pending.current) void send(pending.current); }} />
        </>
      )}
      {draft !== null && (
        <div className="field">
          <label htmlFor="voice-draft">Machine transcript, not reviewed. Correct it, then save.</label>
          <textarea id="voice-draft" className="textarea" lang={lang} value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} disabled={saving} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--small" onClick={() => void save()} disabled={saving || !draft.trim()}>{saving ? 'Saving…' : 'Save as symptom'}</button>
            <button type="button" className="btn btn--small btn--quiet" onClick={() => setDraft(null)} disabled={saving}>Discard</button>
          </div>
        </div>
      )}
      {saved && <p className="small" role="status">Symptom saved.</p>}
    </div>
  );
}
