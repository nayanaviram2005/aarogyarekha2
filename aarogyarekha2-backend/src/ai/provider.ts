import { z } from 'zod';

export type ProviderName = 'mock' | 'gemini' | 'claude' | 'openai' | 'openrouter';
export interface AiRequest { system: string; user: string; json?: boolean; maxTokens?: number }
export interface AiResponse { text: string; provider: ProviderName; model: string }
export type Generate = (req: AiRequest) => Promise<AiResponse>;

export class AiError extends Error {
  constructor(public readonly kind: 'not_configured' | 'timeout' | 'rejected' | 'bad_response' | 'network' | 'busy', message: string) { super(message); this.name = 'AiError'; }
}

const ProviderEnum = z.enum(['mock', 'gemini', 'claude', 'openai', 'openrouter']);
const OptProvider = z.preprocess(v => (v === '' ? undefined : v), ProviderEnum.optional());
export const AiEnv = z.object({
  AI_PROVIDER: ProviderEnum.default('mock'),
  GEMINI_API_KEY: z.string().optional(), GEMINI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(), ANTHROPIC_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(), OPENAI_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(), OPENROUTER_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  AI_FALLBACK_MODEL: z.string().optional(),
  AI_FALLBACK_PROVIDER: OptProvider,
  AI_TRANSLATE_FALLBACK_PROVIDER: OptProvider, AI_TRIAGE_FALLBACK_PROVIDER: OptProvider, AI_VISION_FALLBACK_PROVIDER: OptProvider,
  AI_TRANSLATE_FALLBACK_MODEL: z.string().optional(), AI_TRIAGE_FALLBACK_MODEL: z.string().optional(), AI_STT_FALLBACK_MODEL: z.string().optional(), AI_VISION_FALLBACK_MODEL: z.string().optional(),
  AI_RETRY_AFTER_MS: z.coerce.number().int().min(0).max(30000).default(2500),
  AI_TRANSLATE_PROVIDER: OptProvider, AI_TRANSLATE_API_KEY: z.string().optional(), AI_TRANSLATE_MODEL: z.string().optional(),
  AI_TRIAGE_PROVIDER: OptProvider, AI_TRIAGE_API_KEY: z.string().optional(), AI_TRIAGE_MODEL: z.string().optional(),
  AI_STT_PROVIDER: OptProvider, AI_STT_API_KEY: z.string().optional(), AI_STT_MODEL: z.string().optional(),
  AI_VISION_PROVIDER: OptProvider, AI_VISION_API_KEY: z.string().optional(), AI_VISION_MODEL: z.string().optional(),
});
export type AiEnvValues = z.infer<typeof AiEnv>;

export type AiTask = 'TRANSLATE' | 'TRIAGE' | 'STT' | 'VISION';
const KEY_VAR = { gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' } as const;
const MODEL_VAR = { gemini: 'GEMINI_MODEL', claude: 'ANTHROPIC_MODEL', openai: 'OPENAI_MODEL', openrouter: 'OPENROUTER_MODEL' } as const;

export function envForTask(env: AiEnvValues, task: AiTask): AiEnvValues {
  const own = env as unknown as Record<string, string | undefined>;
  const provider = (own[`AI_${task}_PROVIDER`] as ProviderName | undefined) ?? env.AI_PROVIDER;
  const out: Record<string, unknown> = { ...env, AI_PROVIDER: provider, AI_FALLBACK_MODEL: own[`AI_${task}_FALLBACK_MODEL`]?.trim() || env.AI_FALLBACK_MODEL,
    AI_FALLBACK_PROVIDER: (own[`AI_${task}_FALLBACK_PROVIDER`] as ProviderName | undefined) ?? (task === 'TRANSLATE' || task === 'TRIAGE' ? env.AI_FALLBACK_PROVIDER : undefined) };
  if (provider !== 'mock') {
    const key = own[`AI_${task}_API_KEY`]?.trim(); const model = own[`AI_${task}_MODEL`]?.trim();
    if (key) out[KEY_VAR[provider]] = key;
    if (model) out[MODEL_VAR[provider]] = model;
  }
  return out as AiEnvValues;
}

export function withModel(env: Partial<AiEnvValues>, model: string): Partial<AiEnvValues> {
  const p = env.AI_PROVIDER ?? 'mock';
  return p === 'mock' ? env : { ...env, AI_FALLBACK_MODEL: undefined, [MODEL_VAR[p]]: model };
}

const MESSAGES: Record<AiError['kind'], string> = {
  not_configured: 'The outside AI service is not set up.', timeout: 'The outside AI service took too long.',
  busy: 'The outside AI service is busy right now.', rejected: 'The outside AI service refused the request.', bad_response: 'The outside AI service sent a reply that could not be used.', network: 'The outside AI service could not be reached.',
};

export async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, retryAfterMs?: number): Promise<unknown> { return post(fetchImpl, url, headers, body, timeoutMs, retryAfterMs); }

const BUSY = new Set([429, 500, 502, 503, 504]);
const RETRY_AFTER_MS = 2500;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function post(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, retryAfterMs = RETRY_AFTER_MS): Promise<unknown> {
  try { return await postOnce(fetchImpl, url, headers, body, timeoutMs); }
  catch (e) {
    if (!(e instanceof AiError && e.kind === 'busy')) throw e;
    await wait(retryAfterMs);
    return postOnce(fetchImpl, url, headers, body, timeoutMs);
  }
}

async function postOnce(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try { res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal }); }
  catch (e) { throw new AiError((e as { name?: string }).name === 'AbortError' ? 'timeout' : 'network', MESSAGES[(e as { name?: string }).name === 'AbortError' ? 'timeout' : 'network']); }
  finally { clearTimeout(t); }
  if (!res.ok) throw new AiError(BUSY.has(res.status) ? 'busy' : 'rejected', BUSY.has(res.status) ? MESSAGES.busy : MESSAGES.rejected);
  try { return await res.json(); } catch { throw new AiError('bad_response', MESSAGES.bad_response); }
}

const str = (v: unknown): string => { if (typeof v !== 'string' || !v.trim()) throw new AiError('bad_response', MESSAGES.bad_response); return v; };
const at = (v: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>((o, k) => (o as Record<string | number, unknown> | undefined)?.[k], v);

export function makeProvider(env: Partial<AiEnvValues> & { AI_PROVIDER?: ProviderName }, fetchImpl: typeof fetch = fetch): { name: ProviderName; model: string; generate: Generate } {
  const name = env.AI_PROVIDER ?? 'mock'; const timeout = env.AI_TIMEOUT_MS ?? 30000;

  if (name === 'mock') {
    return { name, model: 'mock', generate: async r => ({ text: r.json ? JSON.stringify({ mock: true }) : `[mock] ${r.user}`, provider: 'mock', model: 'mock' }) };
  }

  const cfg = {
    gemini: { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
    claude: { key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL },
    openai: { key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL },
    openrouter: { key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL },
  }[name];
  const key = cfg.key?.trim(); const model = cfg.model?.trim();
  const unconfigured: Generate = async () => { throw new AiError('not_configured', MESSAGES.not_configured); };
  if (!key || !model) return { name, model: model ?? '', generate: unconfigured };

  const run = async (model: string, r: AiRequest): Promise<AiResponse> => {
    const max = r.maxTokens ?? 1024;
    if (name === 'gemini') {
      const j = await post(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key },
        { systemInstruction: { parts: [{ text: r.system }] }, contents: [{ role: 'user', parts: [{ text: r.user }] }], generationConfig: { temperature: 0, maxOutputTokens: max, ...(r.json ? { responseMimeType: 'application/json' } : {}) } }, timeout, env.AI_RETRY_AFTER_MS);
      const parts = at(j, 'candidates', 0, 'content', 'parts');
      return { text: str(Array.isArray(parts) ? parts.map(p => (p as { text?: string }).text ?? '').join('') : null), provider: name, model };
    }
    if (name === 'claude') {
      const j = await post(fetchImpl, 'https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: max, temperature: 0, system: r.system, messages: [{ role: 'user', content: r.user }] }, timeout, env.AI_RETRY_AFTER_MS);
      const blocks = at(j, 'content');
      return { text: str(Array.isArray(blocks) ? blocks.filter(b => (b as { type?: string }).type === 'text').map(b => (b as { text: string }).text).join('') : null), provider: name, model };
    }
    const url = name === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    const j = await post(fetchImpl, url, { authorization: `Bearer ${key}` },
      { model, temperature: 0, [name === 'openai' ? 'max_completion_tokens' : 'max_tokens']: max, messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }], ...(r.json ? { response_format: { type: 'json_object' } } : {}) }, timeout, env.AI_RETRY_AFTER_MS);
    return { text: str(at(j, 'choices', 0, 'message', 'content')), provider: name, model };
  };
  const fallback = env.AI_FALLBACK_MODEL?.trim();
  const other = env.AI_FALLBACK_PROVIDER && env.AI_FALLBACK_PROVIDER !== name ? makeProvider({ ...env, AI_PROVIDER: env.AI_FALLBACK_PROVIDER, AI_FALLBACK_PROVIDER: undefined, AI_FALLBACK_MODEL: undefined }, fetchImpl) : null;
  const generate: Generate = async r => {
    try { return await run(model, r); }
    catch (e) {
      if (!(e instanceof AiError && e.kind === 'busy')) throw e;
      if (fallback && fallback !== model) { try { return await run(fallback, r); } catch (e2) { if (!(e2 instanceof AiError && e2.kind === 'busy')) throw e2; } }
      if (other) { try { return await other.generate(r); } catch (e3) { if (!(e3 instanceof AiError && (e3.kind === 'busy' || e3.kind === 'not_configured'))) throw e3; } }
      throw e;
    }
  };
  return { name, model, generate };
}
