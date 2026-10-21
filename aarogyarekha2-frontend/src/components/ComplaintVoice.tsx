import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { canRecord, startRecording, type Recording } from '../lib/recorder';
import { SPOKEN_LANGUAGES, spokenLabel } from '../lib/sttLanguages';
import type { Api } from '../lib/types';
import { ConsentForm } from './ConsentForm';
import { Banner } from './Provenance';

const MAX_SECONDS = 29;
const BARS = 32;
const MIN_BAR = 3;
const MAX_BAR = 28;

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
  );
}

function LevelMeter({ rec }: { rec: Recording | null }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const history = new Array<number>(BARS).fill(0);
    let raf = 0; let last = 0;
    const tick = (now: number) => {
      if (now - last >= 45) {
        last = now;
        history.shift(); history.push(rec?.level?.() ?? 0);
        history.forEach((v, i) => { const el = bars.current[i]; if (el) el.style.height = `${Math.round(MIN_BAR + v * (MAX_BAR - MIN_BAR))}px`; });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rec]);
  return (
    <div className="mic-level" role="img" aria-label="Live microphone level">
      {Array.from({ length: BARS }, (_, i) => <span key={i} className="mic-level__bar" ref={el => { bars.current[i] = el; }} />)}
    </div>
  );
}

export function ComplaintVoice({ api, patientId, patientName, language, disabled, onText }: { api: Api; patientId: string; patientName: string; language: string; disabled?: boolean; onText: (text: string) => void }) {
  const [spoken, setSpoken] = useState(language === 'hi' || language === 'or' ? language : 'en');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [added, setAdded] = useState(false);
  const [live, setLive] = useState<Recording | null>(null);
  const rec = useRef<Recording | null>(null);
  const pending = useRef<Blob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (language === 'hi' || language === 'or' || language === 'en') setSpoken(language); }, [language]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.cancel(); }, []);
  if (!canRecord()) return null;

  async function send(blob: Blob) {
    setPhase('sending'); setError(null);
    try {
      const r = await api.transcribe({ patientId }, blob, spoken);
      pending.current = null; setNeedConsent(false);
      if (r.text.trim()) { onText(r.text.trim()); setAdded(true); }
      else setError(new Error('Nothing could be heard. Try again, or type the complaint.'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /outside AI/i.test(e.message)) { pending.current = blob; setNeedConsent(true); }
      else setError(e as Error);
    } finally { setPhase('idle'); }
  }

  async function start() {
    setError(null); setAdded(false); setNeedConsent(false); setSeconds(0);
    try { rec.current = await startRecording(); } catch (e) { setError(e as Error); return; }
    setLive(rec.current); setPhase('recording');
    timer.current = setInterval(() => setSeconds(s => { if (s + 1 >= MAX_SECONDS) void finish(); return s + 1; }), 1000);
  }

  async function finish() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    const r = rec.current; rec.current = null; setLive(null); if (!r) return;
    await send(await r.stop());
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="spoken-lang" className="small">Spoken language</label>
        <select id="spoken-lang" className="select" style={{ width: "auto", minWidth: 200 }} value={spoken} disabled={phase !== 'idle' || disabled} onChange={e => setSpoken(e.target.value)}>
          {SPOKEN_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        {phase === 'idle' && <button type="button" className="btn btn--small mic" disabled={disabled} onClick={() => void start()}><MicIcon />Speak the complaint</button>}
        {phase === 'recording' && (
          <>
            <button type="button" className="btn btn--small mic" onClick={() => void finish()}><StopIcon />Stop and convert</button>
            <LevelMeter rec={live} />
            <span className="small mic" role="timer"><span className="mic-dot" aria-hidden="true" />Recording {seconds}s of {MAX_SECONDS}s</span>
          </>
        )}
        {phase === 'sending' && <span className="small" role="status">Converting to text…</span>}
      </div>
      <p className="tiny muted">Spoken language: {spokenLabel(spoken)}. The recording is sent to an outside speech service and is not kept. The text is a machine transcript and is not checked. Read it in the box above and correct it.</p>
      {added && <p className="small" role="status">Transcript added to the complaint. Check it before continuing.</p>}
      {error && <Banner kind="error" title="Voice input">{error.message}</Banner>}
      {needConsent && (
        <ConsentForm api={api} patientId={patientId} purpose="external_ai_processing" dialog onCancel={() => setNeedConsent(false)} intro={<Banner kind="warn" title="The patient has not agreed to this yet">An outside service would hear {patientName}'s voice. Ask for their separate consent first, or type the complaint.</Banner>} onRecorded={() => { setNeedConsent(false); if (pending.current) void send(pending.current); }} />
      )}
    </div>
  );
}
