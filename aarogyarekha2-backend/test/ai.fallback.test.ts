import { describe, expect, it, vi } from 'vitest';
import { AiEnv, AiError, envForTask, makeProvider } from '../src/ai/provider.js';
import { makeVision } from '../src/ai/vision.js';

const res = (status: number, body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const gemOk = (text = '{"a":1}') => res(200, { candidates: [{ content: { parts: [{ text }] } }] });
const orOk = (text = '{"b":2}') => res(200, { choices: [{ message: { content: text } }] });
const base = { GEMINI_API_KEY: 'g-key', GEMINI_MODEL: 'g-main', OPENROUTER_API_KEY: 'o-key', OPENROUTER_MODEL: 'o-model', AI_RETRY_AFTER_MS: 0 };
const req = { system: 'S', user: 'U', json: true };
const router = (h: { main?: () => Promise<Response>; fallbackModel?: () => Promise<Response>; openrouter?: () => Promise<Response> }) => vi.fn().mockImplementation((url: string) => {
  if (String(url).includes('g-main')) return (h.main ?? (() => res(503)))();
  if (String(url).includes('g-fallback')) return (h.fallbackModel ?? (() => res(503)))();
  if (String(url).includes('openrouter')) return (h.openrouter ?? (() => res(503)))();
  throw new Error('unexpected url ' + url);
});

describe('fallback model', () => {
  const p = (f: ReturnType<typeof vi.fn>) => makeProvider({ AI_PROVIDER: 'gemini', ...base, AI_FALLBACK_MODEL: 'g-fallback' }, f as never);
  it('is used once when the main model stays busy, and the answer says which model served it', async () => {
    const f = router({ fallbackModel: () => gemOk('{"ok":"fallback"}') }); const r = await p(f).generate(req);
    expect(r).toEqual({ text: '{"ok":"fallback"}', provider: 'gemini', model: 'g-fallback' }); expect(f).toHaveBeenCalledTimes(3);
  });
  it('is not used when the main model works, or when the request itself was wrong (4xx)', async () => {
    const a = router({ main: () => gemOk() }); await p(a).generate(req); expect(a).toHaveBeenCalledTimes(1);
    const b = router({ main: () => res(400) }); await expect(p(b).generate(req)).rejects.toMatchObject({ kind: 'rejected' }); expect(b).toHaveBeenCalledTimes(1);
  });
  it('a wrong fallback (4xx) is reported as rejected, not hidden', async () => {
    const f = router({ fallbackModel: () => res(404) }); await expect(p(f).generate(req)).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('fallback provider', () => {
  const p = (f: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) => makeProvider({ AI_PROVIDER: 'gemini', ...base, AI_FALLBACK_PROVIDER: 'openrouter', ...extra } as never, f as never);
  it('answers when the first provider stays busy or out of quota (429), and the answer names the provider that served it', async () => {
    for (const status of [429, 503]) {
      const f = router({ main: () => res(status, { error: { message: 'quota' } }), openrouter: () => orOk('{"ok":"or"}') });
      expect(await p(f).generate(req), String(status)).toEqual({ text: '{"ok":"or"}', provider: 'openrouter', model: 'o-model' });
    }
  });
  it('goes model fallback first, then provider fallback', async () => {
    const f = router({ openrouter: () => orOk() }); const r = await p(f, { AI_FALLBACK_MODEL: 'g-fallback' }).generate(req);
    expect(r.provider).toBe('openrouter'); const urls = f.mock.calls.map(c => String(c[0]));
    expect(urls.findIndex(u => u.includes('g-fallback'))).toBeLessThan(urls.findIndex(u => u.includes('openrouter')));
  });
  it('if the fallback provider is not set up, the original busy error stands', async () => {
    const f = router({}); const e = await p(f, { OPENROUTER_API_KEY: undefined }).generate(req).catch(x => x); expect(e).toBeInstanceOf(AiError); expect(e.kind).toBe('busy');
  });
  it('is never used for a request the first provider rejected as wrong', async () => {
    const f = router({ main: () => res(401) }); await expect(p(f).generate(req)).rejects.toMatchObject({ kind: 'rejected' }); expect(f.mock.calls.every(c => String(c[0]).includes('g-main'))).toBe(true);
  });
});

describe('which tasks may use a fallback provider', () => {
  const env = AiEnv.parse({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', OPENROUTER_API_KEY: 'o', OPENROUTER_MODEL: 'x', AI_FALLBACK_PROVIDER: 'openrouter' });
  it('translation and the priority opinion use the general fallback provider', () => { expect(envForTask(env, 'TRANSLATE').AI_FALLBACK_PROVIDER).toBe('openrouter'); expect(envForTask(env, 'TRIAGE').AI_FALLBACK_PROVIDER).toBe('openrouter'); });
  it('reading images (unredacted) and speech do NOT, unless their own setting names one', () => {
    expect(envForTask(env, 'VISION').AI_FALLBACK_PROVIDER).toBeUndefined(); expect(envForTask(env, 'STT').AI_FALLBACK_PROVIDER).toBeUndefined();
    expect(envForTask({ ...env, AI_VISION_FALLBACK_PROVIDER: 'openrouter' }, 'VISION').AI_FALLBACK_PROVIDER).toBe('openrouter');
  });
  it('a task can set its own fallback model, and empty settings mean "not set"', () => {
    expect(envForTask({ ...env, AI_TRIAGE_FALLBACK_MODEL: 'fm' }, 'TRIAGE').AI_FALLBACK_MODEL).toBe('fm'); expect(envForTask(AiEnv.parse({ AI_FALLBACK_PROVIDER: '', AI_TRIAGE_FALLBACK_PROVIDER: '' }), 'TRIAGE').AI_FALLBACK_PROVIDER).toBeUndefined();
  });
});

describe('vision fallback', () => {
  const rows = JSON.stringify({ rows: [{ name: 'ESR', value: '30' }] });
  const v = (f: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) => makeVision({ AI_PROVIDER: 'gemini', ...base, ...extra } as never, f as never);
  const file = { bytes: Buffer.from('x'), mime: 'image/jpeg' as const };
  it('uses the fallback MODEL when the main one stays busy', async () => {
    const f = router({ fallbackModel: () => gemOk(rows) }); const r = await v(f, { AI_FALLBACK_MODEL: 'g-fallback' }).read(file); expect(r.rows).toHaveLength(1);
  });
  it('uses a fallback PROVIDER only when one was named for this task, and the provider can read the file type', async () => {
    const f = router({ openrouter: () => orOk(rows) });
    expect((await v(f, { AI_FALLBACK_PROVIDER: 'openrouter' }).read(file)).provider).toBe('openrouter');
    const g = router({ openrouter: () => orOk(rows) }); await expect(v(g, { AI_FALLBACK_PROVIDER: 'openrouter' }).read({ bytes: Buffer.from('x'), mime: 'application/pdf' })).rejects.toMatchObject({ kind: 'busy' });
    const h = router({ openrouter: () => orOk(rows) }); await expect(v(h).read(file)).rejects.toMatchObject({ kind: 'busy' }); expect(h.mock.calls.every(c => !String(c[0]).includes('openrouter'))).toBe(true);
  });
});
