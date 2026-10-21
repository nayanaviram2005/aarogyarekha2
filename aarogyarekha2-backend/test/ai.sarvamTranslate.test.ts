import { describe, expect, it, vi } from 'vitest';
import { AiError } from '../src/ai/provider.js';
import { makeSarvamTranslator, translateItemsWithSarvam, type TextTranslator } from '../src/ai/sarvamTranslate.js';

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const env = { AI_PROVIDER: 'sarvam' as const, SARVAM_API_KEY: 'sk_test', AI_RETRY_AFTER_MS: 1 };

describe('Sarvam translation to English', () => {
  it('sends the text with the key in the Sarvam header, the source language as an Indian code, English as the target, and reads the translated text', async () => {
    const f = vi.fn().mockImplementation(() => reply({ request_id: 'r', translated_text: '  Fever for three days  ', source_language_code: 'od-IN' }));
    const t = makeSarvamTranslator(env, f as never);
    expect(t.supported).toBe(true); expect(t.model).toBe('sarvam-translate:v1');
    expect(await t.translate({ text: 'ଜ୍ୱର ତିନି ଦିନ', from: 'or' })).toBe('Fever for three days');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.sarvam.ai/translate'); expect(init.headers['api-subscription-key']).toBe('sk_test');
    expect(JSON.parse(init.body)).toMatchObject({ input: 'ଜ୍ୱର ତିନି ଦିନ', source_language_code: 'od-IN', target_language_code: 'en-IN', model: 'sarvam-translate:v1', mode: 'formal', numerals_format: 'international' });
  });
  it('maps every other language to its own code', async () => {
    const f = vi.fn().mockImplementation(() => reply({ translated_text: 'x' }));
    const t = makeSarvamTranslator(env, f as never);
    for (const from of ['hi', 'ta', 'kok', 'sat']) await t.translate({ text: 'a', from });
    expect(f.mock.calls.map(c => JSON.parse(c[1].body).source_language_code)).toEqual(['hi-IN', 'ta-IN', 'kok-IN', 'sat-IN']);
  });
  it('is only active when Sarvam is chosen for translation, and keeps the translation model apart from the speech model', () => {
    expect(makeSarvamTranslator({ ...env, AI_PROVIDER: 'gemini' }).supported).toBe(false);
    expect(makeSarvamTranslator({ ...env, AI_TRANSLATE_MODEL: 'saaras:v4' }).model).toBe('sarvam-translate:v1');
    expect(makeSarvamTranslator({ ...env, AI_TRANSLATE_MODEL: 'mayura:v1' }).model).toBe('mayura:v1');
  });
  it('uses another address when one is set', async () => {
    const f = vi.fn().mockImplementation(() => reply({ translated_text: 'x' }));
    await makeSarvamTranslator({ ...env, SARVAM_BASE_URL: 'https://indus.example/' }, f as never).translate({ text: 'a', from: 'hi' });
    expect(f.mock.calls[0]![0]).toBe('https://indus.example/translate');
  });
  it('says it is not set up without a key, refuses text over 2000 characters, and turns refusals and empty replies into plain errors', async () => {
    const f = vi.fn();
    await expect(makeSarvamTranslator({ ...env, SARVAM_API_KEY: '' }, f as never).translate({ text: 'a', from: 'hi' })).rejects.toMatchObject({ kind: 'not_configured' });
    await expect(makeSarvamTranslator(env, f as never).translate({ text: 'a'.repeat(2001), from: 'hi' })).rejects.toBeInstanceOf(AiError);
    expect(f).not.toHaveBeenCalled();
    await expect(makeSarvamTranslator(env, (() => reply({}, 403)) as never).translate({ text: 'a', from: 'hi' })).rejects.toMatchObject({ kind: 'rejected' });
    await expect(makeSarvamTranslator(env, (() => reply({ translated_text: '  ' })) as never).translate({ text: 'a', from: 'hi' })).rejects.toMatchObject({ kind: 'bad_response' });
  });
});

describe('translating statements with Sarvam', () => {
  const known = { names: ['Anita Rao'], identifiers: ['AR-0001', '+919876543210'] };
  const fake = (out: (sent: string) => string): { t: TextTranslator; sent: string[] } => {
    const sent: string[] = [];
    return { sent, t: { name: 'sarvam', model: 'm', supported: true, translate: async ({ text }) => { sent.push(text); return out(text); } } };
  };
  it('removes the patient name before sending and puts it back after', async () => {
    const { t, sent } = fake(s => `${s} has fever`);
    const o = await translateItemsWithSarvam(t, [{ id: 'c', text: 'Anita Rao ko bukhar hai' }], 'hi', known);
    expect(sent[0]).not.toContain('Anita'); expect(sent[0]).toMatch(/\[\[NAME_1\]\]/);
    expect(o.translated.get('c')).toBe('Anita Rao ko bukhar hai has fever'); expect(o.rejected).toEqual([]); expect(o.sentItems).toBe(1);
  });
  it('drops a translation that lost the name token or that states a diagnosis', async () => {
    const lost = await translateItemsWithSarvam(fake(() => 'Fever since three days').t, [{ id: 'c', text: 'Anita Rao ko bukhar hai' }], 'hi', known);
    expect(lost.translated.size).toBe(0); expect(lost.rejected).toEqual(['c']);
    const diag = await translateItemsWithSarvam(fake(() => 'The patient has diabetes').t, [{ id: 'd', text: 'chai ke bina' }], 'hi', known);
    expect(diag.rejected).toEqual(['d']);
  });
  it('sends nothing when an identifier would leak', async () => {
    const { t, sent } = fake(s => s);
    const o = await translateItemsWithSarvam(t, [{ id: 'a', text: 'bukhar hai teen din se' }, { id: 'b', text: 'khansi' }], 'hi', known);
    expect(o.translated.size).toBe(2); expect(sent).toHaveLength(2);
  });
});
