import type { Deps } from '../deps.js';
import { translateToEnglish } from './translate.js';
import { translateItemsWithSarvam } from './sarvamTranslate.js';

export interface TranscriptTranslation { text: string; provider: string; model: string }
type Known = { names?: (string | null | undefined)[]; identifiers?: (string | null | undefined)[] };

export async function translateTranscript(deps: Pick<Deps, 'textTranslator' | 'translator'>, text: string, from: string, known: Known): Promise<TranscriptTranslation | null> {
  if (!from || from === 'en' || from === 'auto' || from === 'other') return null;
  try {
    const item = [{ id: 'transcript', text }];
    if (deps.textTranslator?.supported) {
      const o = await translateItemsWithSarvam(deps.textTranslator, item, from, known);
      const english = o.translated.get('transcript');
      return english ? { text: english, provider: deps.textTranslator.name, model: deps.textTranslator.model } : null;
    }
    if ((from === 'hi' || from === 'or') && deps.translator.name !== 'mock') {
      const o = await translateToEnglish(deps.translator.generate, item, from, known);
      const english = o.translated.get('transcript');
      return english ? { text: english, provider: deps.translator.name, model: deps.translator.model } : null;
    }
  } catch { return null; }
  return null;
}
