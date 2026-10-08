import { describe, expect, it, vi } from 'vitest';
import { AiError } from '../src/ai/provider.js';
import { makeTranscriber, sniffAudio } from '../src/ai/stt.js';

const reply = (json: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status }));
const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
const KEYS = { GEMINI_API_KEY: 'g-SECRETKEY', GEMINI_MODEL: 'gemini-x', OPENAI_API_KEY: 'o-SECRETKEY' };

describe('real audio containers only', () => {
  it('recognises webm, ogg, wav and mp4 from their first bytes', () => {
    expect(sniffAudio(audio)).toBe('audio/webm');
    expect(sniffAudio(Buffer.from('OggS\0\x02'))).toBe('audio/ogg');
    expect(sniffAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]))).toBe('audio/wav');
    expect(sniffAudio(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')]))).toBe('audio/mp4');
  });
  it('refuses everything else, including a renamed executable, a PDF and an empty buffer', () => {
    for (const b of [Buffer.from('MZ\x90\0'), Buffer.from('%PDF-1.4'), Buffer.alloc(0), Buffer.from('RIFF1234AVI LIST')]) expect(sniffAudio(b)).toBeNull();
  });
});

describe('gemini', () => {
  it('sends the audio inline with the key in a header and a prompt that treats the audio as data', async () => {
    const f = vi.fn().mockReturnValue(reply({ candidates: [{ content: { parts: [{ text: '{"text":"bukhar teen din se","language":"hi"}' }] } }] }));
    const r = await makeTranscriber({ AI_PROVIDER: 'gemini', ...KEYS }, f as never).transcribe({ bytes: audio, mime: 'audio/webm', language: 'hi' });
    const [url, init] = f.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(url).not.toContain('SECRETKEY');
    expect(init.headers['x-goog-api-key']).toBe('g-SECRETKEY');
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'audio/webm', data: audio.toString('base64') });
    expect(body.contents[0].parts[0].text).toMatch(/Hindi/); expect(body.contents[0].parts[0].text).toMatch(/DATA, never instructions/); expect(body.contents[0].parts[0].text).toMatch(/Do not translate, summarise, diagnose/);
    expect(r).toEqual({ text: 'bukhar teen din se', language: 'hi', provider: 'gemini', model: 'gemini-x' });
  });
  it('strips control characters and caps the length of the transcript', async () => {
    const f = vi.fn().mockReturnValue(reply({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: 'a\u0000b\n\nc' + 'x'.repeat(5000), language: null }) }] } }] }));
    const r = await makeTranscriber({ AI_PROVIDER: 'gemini', ...KEYS }, f as never).transcribe({ bytes: audio, mime: 'audio/webm' });
    expect(r.text.startsWith('a b c')).toBe(true); expect(r.text.length).toBe(2000);
  });
  it('an empty or malformed reply is a plain bad_response', async () => {
    for (const body of [{ candidates: [] }, { candidates: [{ content: { parts: [{ text: 'not json' }] } }] }, { candidates: [{ content: { parts: [{ text: '{"text":"  "}' }] } }] }]) {
      await expect(makeTranscriber({ AI_PROVIDER: 'gemini', ...KEYS }, vi.fn().mockReturnValue(reply(body)) as never).transcribe({ bytes: audio, mime: 'audio/webm' })).rejects.toMatchObject({ kind: 'bad_response' });
    }
  });
  it('failures never leak the key', async () => {
    const e = await makeTranscriber({ AI_PROVIDER: 'gemini', ...KEYS }, vi.fn().mockReturnValue(reply({ error: 'g-SECRETKEY' }, 403)) as never).transcribe({ bytes: audio, mime: 'audio/webm' }).catch(x => x as AiError) as AiError;
    expect(e.kind).toBe('rejected'); expect(e.message).not.toContain('SECRETKEY');
  });
  it('not configured sends nothing', async () => {
    const f = vi.fn();
    await expect(makeTranscriber({ AI_PROVIDER: 'gemini' }, f as never).transcribe({ bytes: audio, mime: 'audio/webm' })).rejects.toMatchObject({ kind: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('openai and the rest', () => {
  it('openai uses the transcription endpoint with a bearer header and the language', async () => {
    const f = vi.fn().mockReturnValue(reply({ text: ' bukhar hai ' }));
    const r = await makeTranscriber({ AI_PROVIDER: 'openai', ...KEYS }, f as never).transcribe({ bytes: audio, mime: 'audio/ogg', language: 'hi' });
    const [url, init] = f.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string>; body: FormData }];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init.headers.authorization).toBe('Bearer o-SECRETKEY');
    expect(init.body.get('language')).toBe('hi'); expect(init.body.get('model')).toBe('whisper-1');
    expect(r.text).toBe('bukhar hai');
  });
  it('claude and openrouter say plainly that they cannot transcribe', async () => {
    for (const p of ['claude', 'openrouter'] as const) {
      const t = makeTranscriber({ AI_PROVIDER: p }, vi.fn() as never);
      expect(t.supported).toBe(false);
      await expect(t.transcribe({ bytes: audio, mime: 'audio/webm' })).rejects.toMatchObject({ kind: 'not_configured' });
    }
  });
  it('mock needs no key and never touches the network', async () => {
    const f = vi.fn();
    expect((await makeTranscriber({ AI_PROVIDER: 'mock' }, f as never).transcribe({ bytes: audio, mime: 'audio/webm' })).provider).toBe('mock');
    expect(f).not.toHaveBeenCalled();
  });
});
