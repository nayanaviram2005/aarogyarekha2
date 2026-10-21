import { describe, expect, it, vi } from 'vitest';
import { AiEnv, envForTask, makeProvider } from '../src/ai/provider.js';
import { makeTranscriber, STT_LANGUAGE_NAMES } from '../src/ai/stt.js';
import { makeVision } from '../src/ai/vision.js';

const bytes = Buffer.from('fake-audio');
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const env = { AI_PROVIDER: 'sarvam' as const, SARVAM_API_KEY: 'sk_test', SARVAM_MODEL: undefined };

describe('Sarvam speech to text', () => {
  it('sends the recording with the key in the Sarvam header, the language as an Indian language code, and reads the transcript', async () => {
    const f = vi.fn().mockImplementation(() => reply({ request_id: 'r1', transcript: '  ଜ୍ୱର ତିନି ଦିନ  ଧରି  ', language_code: 'od-IN' }));
    const t = makeTranscriber(env, f as never);
    expect(t.supported).toBe(true); expect(t.model).toBe('saaras:v4');
    const r = await t.transcribe({ bytes, mime: 'audio/webm', language: 'or' });
    expect(r).toEqual({ text: 'ଜ୍ୱର ତିନି ଦିନ ଧରି', language: 'or', provider: 'sarvam', model: 'saaras:v4' });
    const [url, init] = f.mock.calls[0]!; expect(url).toBe('https://api.sarvam.ai/speech-to-text');
    expect((init as RequestInit).headers).toEqual({ 'api-subscription-key': 'sk_test' });
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get('model')).toBe('saaras:v4'); expect(fd.get('language_code')).toBe('od-IN');
    const file = fd.get('file') as File; expect(file.name).toBe('audio.webm'); expect(file.type).toBe('audio/webm');
  });
  it('maps Hindi and English, and asks Sarvam to detect the language when none is given', async () => {
    const f = vi.fn().mockImplementation(() => reply({ transcript: 'बुखार है', language_code: 'hi-IN' }));
    const t = makeTranscriber(env, f as never);
    expect(((await t.transcribe({ bytes, mime: 'audio/ogg', language: 'hi' })).language)).toBe('hi'); expect((f.mock.calls[0]![1].body as FormData).get('language_code')).toBe('hi-IN');
    await t.transcribe({ bytes, mime: 'audio/mp4' }); expect((f.mock.calls[1]![1].body as FormData).get('language_code')).toBe('unknown'); expect(((f.mock.calls[1]![1].body as FormData).get('file') as File).name).toBe('audio.mp4');
    const en = makeTranscriber(env, vi.fn().mockImplementation(() => reply({ transcript: 'fever', language_code: 'en-IN' })) as never);
    expect((await en.transcribe({ bytes, mime: 'audio/wav', language: 'en' })).language).toBe('en');
  });
  it('reports the language Sarvam heard, "other" for one the app does not know, and falls back to the requested one when none came back', async () => {
    const mk = (body: unknown) => makeTranscriber(env, vi.fn().mockImplementation(() => reply(body)) as never);
    expect((await mk({ transcript: 'x', language_code: 'xx-IN' }).transcribe({ bytes, mime: 'audio/webm' })).language).toBe('other');
    expect((await mk({ transcript: 'x', language_code: 'ta-IN' }).transcribe({ bytes, mime: 'audio/webm' })).language).toBe('ta');
    expect((await mk({ transcript: 'x', language_code: null }).transcribe({ bytes, mime: 'audio/webm', language: 'hi' })).language).toBe('hi');
    expect((await mk({ transcript: 'x' }).transcribe({ bytes, mime: 'audio/webm' })).language).toBeNull();
  });
  it('sends the right Sarvam code for every spoken language it offers, and detects the language for auto', async () => {
    const sent: string[] = [];
    const t = makeTranscriber(env, vi.fn().mockImplementation((_u: string, init: { body: FormData }) => { sent.push(String(init.body.get('language_code'))); return reply({ transcript: 'x' }); }) as never);
    const all = Object.keys(STT_LANGUAGE_NAMES) as (keyof typeof STT_LANGUAGE_NAMES)[];
    for (const l of all) await t.transcribe({ bytes, mime: 'audio/webm', language: l });
    await t.transcribe({ bytes, mime: 'audio/webm', language: 'auto' });
    expect(all).toHaveLength(23);
    expect(sent).toEqual([...all.map(l => (l === 'or' ? 'od-IN' : `${l}-IN`)), 'unknown']);
    expect(sent).toEqual(expect.arrayContaining(['hi-IN', 'od-IN', 'en-IN', 'ta-IN', 'te-IN', 'bn-IN', 'kok-IN', 'sat-IN', 'mni-IN']));
  });
  it('uses another address when one is set, and trims a trailing slash', async () => {
    const f = vi.fn().mockImplementation(() => reply({ transcript: 'x' }));
    await makeTranscriber({ ...env, SARVAM_BASE_URL: 'https://example.sarvam.test/' }, f as never).transcribe({ bytes, mime: 'audio/webm' });
    expect(f.mock.calls[0]![0]).toBe('https://example.sarvam.test/speech-to-text');
  });
  it('uses the model from the settings when one is given', async () => {
    const f = vi.fn().mockImplementation(() => reply({ transcript: 'x' }));
    const t = makeTranscriber({ ...env, SARVAM_MODEL: 'saaras:v3' }, f as never); await t.transcribe({ bytes, mime: 'audio/webm' });
    expect(t.model).toBe('saaras:v3'); expect((f.mock.calls[0]![1].body as FormData).get('model')).toBe('saaras:v3');
  });
  it('says it is not set up without a key, and does not call out', async () => {
    const f = vi.fn(); await expect(makeTranscriber({ AI_PROVIDER: 'sarvam' }, f as never).transcribe({ bytes, mime: 'audio/webm' })).rejects.toMatchObject({ kind: 'not_configured' }); expect(f).not.toHaveBeenCalled();
  });
  it('turns a refusal, a slow answer, a dead network and an empty or unreadable reply into plain errors', async () => {
    const run = (f: unknown) => makeTranscriber(env, f as never).transcribe({ bytes, mime: 'audio/webm' });
    await expect(run(() => reply({}, 429))).rejects.toMatchObject({ kind: 'rejected' });
    await expect(run(() => reply({}, 400))).rejects.toMatchObject({ kind: 'rejected' });
    await expect(run(() => reply({ transcript: '   ' }))).rejects.toMatchObject({ kind: 'bad_response' });
    await expect(run(() => Promise.resolve(new Response('not json', { status: 200 })))).rejects.toMatchObject({ kind: 'bad_response' });
    await expect(run(() => Promise.reject(new TypeError('fetch failed')))).rejects.toMatchObject({ kind: 'network' });
    await expect(run(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })))).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('Sarvam as a provider for the other jobs', () => {
  it('is only for speech: text and photo jobs say they are not set up', async () => {
    await expect(makeProvider({ ...env }, vi.fn() as never).generate({ system: 's', user: 'u' })).rejects.toMatchObject({ kind: 'not_configured' });
    expect(makeVision({ ...env }).supported).toBe(false);
  });
  it('a per-job key and model for speech reach the Sarvam settings, and the other jobs keep their own', () => {
    const e = AiEnv.parse({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gm', AI_STT_PROVIDER: 'sarvam', AI_STT_API_KEY: 'sk_stt', AI_STT_MODEL: 'saaras:v4' });
    expect(envForTask(e, 'STT')).toMatchObject({ AI_PROVIDER: 'sarvam', SARVAM_API_KEY: 'sk_stt', SARVAM_MODEL: 'saaras:v4' });
    expect(envForTask(e, 'TRANSLATE')).toMatchObject({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' });
    const t = makeTranscriber(envForTask(e, 'STT')); expect(t).toMatchObject({ name: 'sarvam', model: 'saaras:v4', supported: true });
  });
  it('is accepted by the configuration', () => { expect(AiEnv.parse({ AI_STT_PROVIDER: 'sarvam', SARVAM_API_KEY: 'k' })).toMatchObject({ AI_STT_PROVIDER: 'sarvam', SARVAM_API_KEY: 'k' }); expect(() => AiEnv.parse({ AI_STT_PROVIDER: 'nope' })).toThrow();
    expect(AiEnv.parse({ SARVAM_BASE_URL: '' }).SARVAM_BASE_URL).toBeUndefined(); expect(() => AiEnv.parse({ SARVAM_BASE_URL: 'http://api.sarvam.ai' })).toThrow(); expect(() => AiEnv.parse({ SARVAM_BASE_URL: 'not a url' })).toThrow(); });
});
