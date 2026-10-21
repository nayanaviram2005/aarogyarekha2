import { AiError, postJson, type AiEnvValues } from './provider.js';
import { assertClean, redact, restore } from './redact.js';
import { sarvamCode } from './stt.js';
import { checkNonDiagnostic } from '../guard/nonDiagnostic.js';
import type { TranslateItem, TranslateOutcome } from './translate.js';

export const SARVAM_TRANSLATE_MODEL = 'sarvam-translate:v1';
export const SARVAM_TRANSLATE_MAX_CHARS = 2000;
const NATIVE_MODELS = /^(sarvam-translate|mayura)/;

export interface TextTranslator { name: 'sarvam'; model: string; supported: boolean; translate(a: { text: string; from: string }): Promise<string> }
type Known = { names?: (string | null | undefined)[]; identifiers?: (string | null | undefined)[] };

export function makeSarvamTranslator(env: Partial<AiEnvValues> & { AI_TRANSLATE_MODEL?: string }, fetchImpl: typeof fetch = fetch): TextTranslator {
  const supported = env.AI_PROVIDER === 'sarvam';
  const key = env.SARVAM_API_KEY?.trim();
  const asked = env.AI_TRANSLATE_MODEL?.trim();
  const model = asked && NATIVE_MODELS.test(asked) ? asked : SARVAM_TRANSLATE_MODEL;
  const base = (env.SARVAM_BASE_URL?.trim() || 'https://api.sarvam.ai').replace(/\/+$/, '');
  return {
    name: 'sarvam', model, supported,
    translate: async ({ text, from }) => {
      if (!key) throw new AiError('not_configured', 'The outside AI service is not set up.');
      if (text.length > SARVAM_TRANSLATE_MAX_CHARS) throw new AiError('rejected', 'The text is too long to translate.');
      const j = await postJson(fetchImpl, `${base}/translate`, { 'api-subscription-key': key },
        { input: text, source_language_code: sarvamCode(from as never), target_language_code: 'en-IN', model, mode: 'formal', numerals_format: 'international' }, Math.max(env.AI_TIMEOUT_MS ?? 30000, 30000), env.AI_RETRY_AFTER_MS);
      const out = (j as { translated_text?: unknown }).translated_text;
      if (typeof out !== 'string' || !out.trim()) throw new AiError('bad_response', 'The outside AI service sent a reply that could not be used.');
      return out.trim();
    },
  };
}

export async function translateItemsWithSarvam(t: TextTranslator, items: TranslateItem[], from: string, known: Known): Promise<TranslateOutcome> {
  const out: TranslateOutcome = { translated: new Map(), rejected: [], sentChars: 0, sentItems: 0 };
  for (const it of items) {
    const r = redact(it.text, known); assertClean(r.text, known);
    const english = await t.translate({ text: r.text, from });
    out.sentChars += r.text.length; out.sentItems++;
    const tokens = [...r.names.keys()];
    const ok = english.length >= 1 && english.length <= Math.max(60, it.text.length * 6) && tokens.every(k => english.includes(k)) && checkNonDiagnostic(english.replace(/\[\[NAME_\d+\]\]/g, 'X')).allowed;
    if (ok) out.translated.set(it.id, restore(english, r.names)); else out.rejected.push(it.id);
  }
  return out;
}
