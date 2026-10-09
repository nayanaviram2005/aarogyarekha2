export type SpeakLang = 'en' | 'hi' | 'or';
export type SpeakResult = 'spoken' | 'no_voice' | 'unsupported';

const TAGS: Record<SpeakLang, string[]> = { en: ['en-IN', 'en-GB', 'en-US', 'en'], hi: ['hi-IN', 'hi'], or: ['or-IN', 'or', 'od-IN', 'od'] };

export function pickVoice(voices: { lang: string; name: string }[], lang: SpeakLang): { lang: string; name: string } | null {
  const norm = (s: string) => s.replace('_', '-').toLowerCase();
  for (const tag of TAGS[lang]) {
    const exact = voices.find(v => norm(v.lang) === tag.toLowerCase());
    if (exact) return exact;
  }
  return voices.find(v => norm(v.lang).startsWith(lang + '-')) ?? null;
}

export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

export function stopSpeaking(): void { if (canSpeak()) window.speechSynthesis.cancel(); }

export function speak(text: string, lang: SpeakLang, maxMs = 20_000): Promise<SpeakResult> {
  if (!canSpeak()) return Promise.resolve('unsupported');
  const synth = window.speechSynthesis;
  const voice = pickVoice(synth.getVoices() as unknown as { lang: string; name: string }[], lang);
  if (!voice) return Promise.resolve('no_voice');
  return new Promise(resolve => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice as SpeechSynthesisVoice; u.lang = voice.lang; u.rate = 0.95;
    const done = () => { window.clearTimeout(t); resolve('spoken'); };
    const t = window.setTimeout(done, maxMs);
    u.onend = done; u.onerror = done;
    synth.speak(u);
  });
}
