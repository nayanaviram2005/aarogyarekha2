import { describe, expect, it, vi } from 'vitest';
import { AiError, makeProvider } from '../src/ai/provider.js';

const reply = (json: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
const KEYS = { GEMINI_API_KEY: 'g-SECRETKEY', GEMINI_MODEL: 'gemini-x', ANTHROPIC_API_KEY: 'a-SECRETKEY', ANTHROPIC_MODEL: 'claude-x', OPENAI_API_KEY: 'o-SECRETKEY', OPENAI_MODEL: 'gpt-x', OPENROUTER_API_KEY: 'r-SECRETKEY', OPENROUTER_MODEL: 'vendor/model' };
const req = { system: 'SYS', user: 'USER TEXT', json: true, maxTokens: 200 };
const call = (f: ReturnType<typeof vi.fn>) => ({ url: String(f.mock.calls[0]![0]), init: f.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> }, body: JSON.parse(String((f.mock.calls[0]![1] as RequestInit).body)) });

describe('mock', () => {
  it('needs no key and never touches the network', async () => {
    const f = vi.fn(); const p = makeProvider({ AI_PROVIDER: 'mock' }, f as never);
    expect((await p.generate({ system: 's', user: 'hello' })).text).toBe('[mock] hello');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('request shape per provider', () => {
  it('gemini: key in a header (not the URL), system instruction, json mode, temperature 0', async () => {
    const f = vi.fn().mockReturnValue(reply({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }));
    const r = await makeProvider({ AI_PROVIDER: 'gemini', ...KEYS }, f as never).generate(req);
    const c = call(f);
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(c.url).not.toContain('SECRETKEY');
    expect(c.init.headers['x-goog-api-key']).toBe('g-SECRETKEY');
    expect(c.body).toMatchObject({ systemInstruction: { parts: [{ text: 'SYS' }] }, contents: [{ role: 'user', parts: [{ text: 'USER TEXT' }] }], generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json' } });
    expect(r).toEqual({ text: '{"a":1}', provider: 'gemini', model: 'gemini-x' });
  });
  it('claude: x-api-key header, version header, system as its own field', async () => {
    const f = vi.fn().mockReturnValue(reply({ content: [{ type: 'text', text: 'hi' }] }));
    const r = await makeProvider({ AI_PROVIDER: 'claude', ...KEYS }, f as never).generate(req);
    const c = call(f);
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.init.headers).toMatchObject({ 'x-api-key': 'a-SECRETKEY', 'anthropic-version': '2023-06-01' });
    expect(c.body).toMatchObject({ model: 'claude-x', max_tokens: 200, temperature: 0, system: 'SYS', messages: [{ role: 'user', content: 'USER TEXT' }] });
    expect(r.text).toBe('hi');
  });
  it('openai: bearer header, max_completion_tokens, json response format', async () => {
    const f = vi.fn().mockReturnValue(reply({ choices: [{ message: { content: 'ok' } }] }));
    await makeProvider({ AI_PROVIDER: 'openai', ...KEYS }, f as never).generate(req);
    const c = call(f);
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(c.init.headers.authorization).toBe('Bearer o-SECRETKEY');
    expect(c.body).toMatchObject({ model: 'gpt-x', temperature: 0, max_completion_tokens: 200, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER TEXT' }] });
  });
  it('openrouter: its own URL and key, max_tokens', async () => {
    const f = vi.fn().mockReturnValue(reply({ choices: [{ message: { content: 'ok' } }] }));
    await makeProvider({ AI_PROVIDER: 'openrouter', ...KEYS }, f as never).generate({ ...req, json: false });
    const c = call(f);
    expect(c.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(c.init.headers.authorization).toBe('Bearer r-SECRETKEY');
    expect(c.body).toMatchObject({ model: 'vendor/model', max_tokens: 200 });
    expect(c.body.response_format).toBeUndefined();
  });
});

describe('failures are safe', () => {
  const p = (f: ReturnType<typeof vi.fn>, name: 'gemini' | 'claude' | 'openai' | 'openrouter' = 'gemini') => makeProvider({ AI_PROVIDER: name, ...KEYS }, f as never);
  it('a missing key or model is "not configured" and nothing is sent', async () => {
    const f = vi.fn();
    await expect(makeProvider({ AI_PROVIDER: 'gemini' }, f as never).generate(req)).rejects.toMatchObject({ kind: 'not_configured' });
    await expect(makeProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }, f as never).generate(req)).rejects.toMatchObject({ kind: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
  it('an error response never leaks the key or the body', async () => {
    const e = await p(vi.fn().mockReturnValue(reply({ error: { message: 'bad key g-SECRETKEY for USER TEXT' } }, 401))).generate(req).catch(x => x as AiError) as AiError;
    expect(e).toMatchObject({ kind: 'rejected' });
    expect(e.message).not.toMatch(/SECRETKEY|USER TEXT/);
  });
  it('a network failure never leaks the key', async () => {
    const e = await p(vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED https://x?key=g-SECRETKEY'))).generate(req).catch(x => x as AiError) as AiError;
    expect(e).toMatchObject({ kind: 'network' });
    expect(e.message).not.toContain('SECRETKEY');
  });
  it('a timeout aborts the request', async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }));
    await expect(makeProvider({ AI_PROVIDER: 'openai', ...KEYS, AI_TIMEOUT_MS: 1000 }, f as never).generate(req)).rejects.toMatchObject({ kind: 'timeout' });
  }, 10000);
  it.each([['gemini', { candidates: [] }], ['claude', { content: [] }], ['openai', { choices: [] }], ['openrouter', { choices: [{ message: {} }] }], ['gemini', { candidates: [{ content: { parts: [{ text: '   ' }] } }] }]] as const)('%s with an unusable reply is "bad_response"', async (name, body) => {
    await expect(p(vi.fn().mockReturnValue(reply(body)), name).generate(req)).rejects.toMatchObject({ kind: 'bad_response' });
  });
  it('a reply that is not JSON is "bad_response"', async () => {
    await expect(p(vi.fn().mockReturnValue(Promise.resolve(new Response('<html>', { status: 200 })))).generate(req)).rejects.toMatchObject({ kind: 'bad_response' });
  });
  const gem = (f: ReturnType<typeof vi.fn>) => makeProvider({ AI_PROVIDER: 'gemini', ...KEYS, AI_RETRY_AFTER_MS: 0 }, f as never);
  const ok = () => reply({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] });
  it('a request the service rejects as wrong (400, 401, 403, 404) is never retried', async () => {
    for (const status of [400, 401, 403, 404]) { const f = vi.fn().mockImplementation(() => reply({}, status)); await expect(gem(f).generate(req)).rejects.toMatchObject({ kind: 'rejected' }); expect(f, String(status)).toHaveBeenCalledTimes(1); }
  });
  it('a busy service (429 or 5xx) is tried once more, and a success on the second try is used', async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const f = vi.fn().mockReturnValueOnce(reply({ error: { message: 'high demand' } }, status)).mockReturnValueOnce(ok());
      expect((await gem(f).generate(req)).text, String(status)).toBe('{"a":1}'); expect(f).toHaveBeenCalledTimes(2);
    }
  });
  it('still busy on the second try is a clear "busy" error, after exactly two requests, and the body is never surfaced', async () => {
    const f = vi.fn().mockImplementation(() => reply({ error: { message: 'SECRET ECHO of USER TEXT' } }, 503));
    const e = await gem(f).generate(req).catch(x => x); expect(e).toBeInstanceOf(AiError); expect(e.kind).toBe('busy'); expect(e.message).toBe('The outside AI service is busy right now.'); expect(e.message).not.toMatch(/SECRET|USER TEXT/); expect(f).toHaveBeenCalledTimes(2);
  });
  it('a timeout or a network failure is not retried (it may have been processed)', async () => {
    const f = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })); await expect(gem(f).generate(req)).rejects.toMatchObject({ kind: 'timeout' }); expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockRejectedValue(new Error('fetch failed')); await expect(gem(g).generate(req)).rejects.toMatchObject({ kind: 'network' }); expect(g).toHaveBeenCalledTimes(1);
  });
});
