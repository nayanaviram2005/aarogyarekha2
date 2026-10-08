/**
 * Guesses the language of a short piece of text, from the writing system first.
 * Devanagari letters mean Hindi here, Odia letters mean Odia. Plain Latin letters are English unless they contain common Hindi
 * words written in English letters ("bukhar", "dard"), which is how many people type on a phone.
 * It is a SUGGESTION shown to the person typing. It never changes a saved language by itself.
 */
export type Detected = 'en' | 'hi' | 'or' | 'unknown';
export interface Detection { lang: Detected; romanizedHindi: boolean; mixed: boolean }

const DEVANAGARI = /[ऀ-ॿ]/g;
const ODIA = /[଀-୿]/g;
const LATIN = /[A-Za-z]/g;

/** Common Hindi words typed in English letters. Not exhaustive; a hit needs at least one and the text must have no English-only symptom words alone. */
const ROMAN_HI = new Set(['bukhar', 'bukhaar', 'khansi', 'khasi', 'dard', 'sir', 'pet', 'ulti', 'dast', 'kamzori', 'saans', 'sans', 'chakkar', 'jukam', 'zukam', 'gala', 'seene', 'sine', 'peeth', 'kamar', 'pasina', 'bhookh', 'pyaas', 'neend', 'ghabrahat', 'thand', 'sujan', 'khoon', 'peshab', 'hai', 'hain', 'se', 'ko', 'mein', 'nahi', 'nahin', 'bahut', 'teen', 'din', 'raat']);
const STRONG_ROMAN_HI = new Set(['bukhar', 'bukhaar', 'khansi', 'ulti', 'dast', 'kamzori', 'chakkar', 'jukam', 'zukam', 'pasina', 'peshab', 'ghabrahat', 'dard']);

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export function detectLanguage(text: string): Detection {
  const dev = count(text, DEVANAGARI), od = count(text, ODIA), lat = count(text, LATIN);
  const total = dev + od + lat;
  if (total < 2) return { lang: 'unknown', romanizedHindi: false, mixed: false };
  const scripts = [dev > 0, od > 0, lat > 0].filter(Boolean).length;
  const mixed = scripts > 1 && Math.min(...[dev, od, lat].filter(n => n > 0)) / total >= 0.2;
  if (dev >= od && dev > lat) return { lang: 'hi', romanizedHindi: false, mixed };
  if (od > dev && od > lat) return { lang: 'or', romanizedHindi: false, mixed };
  if (dev > 0 && dev >= lat) return { lang: 'hi', romanizedHindi: false, mixed };
  if (od > 0 && od >= lat) return { lang: 'or', romanizedHindi: false, mixed };
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = words.filter(w => ROMAN_HI.has(w));
  const strong = words.some(w => STRONG_ROMAN_HI.has(w));
  if (strong && hits.length >= 1) return { lang: 'hi', romanizedHindi: true, mixed };
  if (hits.length >= 2) return { lang: 'hi', romanizedHindi: true, mixed };
  return { lang: 'en', romanizedHindi: false, mixed };
}

/** The suggestion to show when the typed text and the chosen language disagree, or null. */
export function languageSuggestion(text: string, chosen: string): { lang: 'en' | 'hi' | 'or'; message: string } | null {
  const d = detectLanguage(text);
  if (d.lang === 'unknown' || d.lang === chosen) return null;
  if (text.trim().length < 6) return null;
  const name = { en: 'English', hi: 'Hindi', or: 'Odia' }[d.lang];
  return { lang: d.lang, message: `This looks like ${name}${d.romanizedHindi ? ' typed in English letters' : ''}. The language is set to ${({ en: 'English', hi: 'Hindi', or: 'Odia' } as Record<string, string>)[chosen] ?? chosen}.` };
}
