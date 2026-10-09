import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { canRecord, startRecording, type Recording } from '../lib/recorder';
import { speak, stopSpeaking } from '../lib/speech';
import type { Api } from '../lib/types';
import { parseYesNo } from '../lib/yesNo';
import { ConsentForm } from './ConsentForm';
import { Banner } from './Provenance';

type Lang = 'en' | 'hi' | 'or';
const NAME: Record<Lang, string> = { en: 'English', hi: 'Hindi', or: 'Odia' };
const LISTEN_SECONDS = 6;
export interface WalkQuestion { code: string; text: (lang: Lang) => string }

export function VoiceWalkthrough({ api, encounterId, patientId, defaultLanguage, questions, onAnswer }: {
  api: Api; encounterId: string; patientId: string; defaultLanguage: string; questions: WalkQuestion[]; onAnswer: (code: string, value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<WalkQuestion[]>([]);
  const [lang, setLang] = useState<Lang>(defaultLanguage === 'hi' || defaultLanguage === 'or' ? defaultLanguage : 'en');
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'ready' | 'recording' | 'sending'>('ready');
  const [heard, setHeard] = useState<{ text: string; answer: boolean | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [answered, setAnswered] = useState(0);
  const rec = useRef<Recording | null>(null);
  const pending = useRef<Blob | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const q = open ? queue[i] : undefined;
  const mic = canRecord();

  useEffect(() => {
    if (!q) return;
    let live = true;
    void speak(q.text(lang), lang).then(r => {
      if (!live) return;
      setNote(r === 'spoken' ? null : r === 'no_voice' ? `This device has no spoken voice for ${NAME[lang]}. Read the question aloud yourself.` : 'This browser cannot read aloud. Read the question yourself.');
    });
    return () => { live = false; stopSpeaking(); };
  }, [q, lang]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); rec.current?.cancel(); stopSpeaking(); }, []);

  function begin() { setQueue(questions); setI(0); setAnswered(0); setHeard(null); setError(null); setOpen(true); }
  function close() { if (timer.current) clearTimeout(timer.current); rec.current?.cancel(); rec.current = null; stopSpeaking(); setPhase('ready'); setNeedConsent(false); setOpen(false); }
  function move(to: number) { if (timer.current) clearTimeout(timer.current); rec.current?.cancel(); rec.current = null; setPhase('ready'); setHeard(null); setError(null); setNeedConsent(false); setI(to); }
  function apply(value: boolean) { if (!q) return; onAnswer(q.code, value); setAnswered(a => a + 1); move(i + 1); }

  async function send(blob: Blob) {
    setPhase('sending'); setError(null);
    try {
      const r = await api.transcribe(encounterId, blob, lang);
      pending.current = null; setNeedConsent(false);
      const p = parseYesNo(r.text); setHeard({ text: r.text, answer: p === null ? null : p === 'yes' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /outside AI/i.test(e.message)) { pending.current = blob; setNeedConsent(true); } else setError(e as Error);
    } finally { setPhase('ready'); }
  }
  async function listen() {
    setError(null); setHeard(null);
    try { rec.current = await startRecording(); } catch (e) { setError(e as Error); return; }
    setPhase('recording');
    timer.current = setTimeout(() => void stopListening(), LISTEN_SECONDS * 1000);
  }
  async function stopListening() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const r = rec.current; rec.current = null; if (!r) return;
    await send(await r.stop());
  }

  if (!open) return <button type="button" className="btn btn--small" onClick={begin} disabled={questions.length === 0}>Ask by voice</button>;

  return (
    <section className="block" aria-label="Voice walkthrough">
      <div className="block__head">
        <h3>Ask by voice</h3>
        <span className="grow" />
        <label htmlFor="walk-lang" className="small">Language</label>
        <select id="walk-lang" className="select" value={lang} onChange={e => setLang(e.target.value as Lang)} disabled={phase !== 'ready'} style={{ width: 'auto' }}>
          {(Object.keys(NAME) as Lang[]).map(l => <option key={l} value={l}>{NAME[l]}</option>)}
        </select>
        <button type="button" className="btn btn--small btn--quiet" onClick={close}>Close</button>
      </div>
      <div className="block__body">
        {!q ? (
          <>
            <p className="small" role="status">All questions asked. {answered} answer{answered === 1 ? '' : 's'} chosen. Close this, check them, then press Submit answers. The patient is assessed again when you submit.</p>
            <button type="button" className="btn btn--primary" onClick={close}>Close</button>
          </>
        ) : (
          <>
            <p className="small muted">Question {i + 1} of {queue.length}</p>
            <p className="strong" lang={lang} aria-live="polite" style={{ fontSize: 'var(--fs-18, 1.15rem)', margin: '4px 0 8px' }}>{q.text(lang)}</p>
            {note && <p className="tiny muted">{note}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn btn--small" onClick={() => { void speak(q.text(lang), lang); }} disabled={phase !== 'ready'}>Hear again</button>
              {mic && phase !== 'recording' && <button type="button" className="btn btn--small" onClick={() => void listen()} disabled={phase === 'sending'}>{phase === 'sending' ? 'Understanding…' : 'Answer by voice'}</button>}
              {phase === 'recording' && <button type="button" className="btn btn--small btn--primary" onClick={() => void stopListening()}>Stop listening</button>}
              <button type="button" className="btn btn--small" onClick={() => apply(true)} disabled={phase !== 'ready'}>Yes</button>
              <button type="button" className="btn btn--small" onClick={() => apply(false)} disabled={phase !== 'ready'}>No</button>
              <button type="button" className="btn btn--small btn--quiet" onClick={() => move(i + 1)} disabled={phase !== 'ready'}>Skip</button>
              {i > 0 && <button type="button" className="btn btn--small btn--quiet" onClick={() => move(i - 1)} disabled={phase !== 'ready'}>Back</button>}
            </div>
            {phase === 'recording' && <p className="small" role="status">Listening for up to {LISTEN_SECONDS} seconds. Say yes or no.</p>}
            {heard && (
              <div role="status" className="small" style={{ marginTop: 8 }}>
                {heard.answer === null
                  ? <p>Could not tell yes or no from “{heard.text || 'nothing'}”. Say it again, or tap Yes or No.</p>
                  : <p>Heard “{heard.text}”, taken as <strong>{heard.answer ? 'Yes' : 'No'}</strong>. <button type="button" className="btn btn--small btn--primary" onClick={() => apply(heard.answer as boolean)}>Use {heard.answer ? 'Yes' : 'No'}</button></p>}
              </div>
            )}
            <p className="tiny muted">The recording is sent to an outside speech service and is not kept. A spoken answer is only a draft until you submit the answers.</p>
          </>
        )}
        {error && <Banner kind="error" title="Voice answer">{error.message}</Banner>}
        {needConsent && (
          <ConsentForm api={api} patientId={patientId} purpose="external_ai_processing" dialog onCancel={() => setNeedConsent(false)}
            intro={<Banner kind="warn" title="The patient has not agreed to this yet">An outside service would hear the patient's voice. Ask for their separate consent first, or tap Yes or No.</Banner>}
            onRecorded={() => { setNeedConsent(false); if (pending.current) void send(pending.current); }} />
        )}
      </div>
    </section>
  );
}
