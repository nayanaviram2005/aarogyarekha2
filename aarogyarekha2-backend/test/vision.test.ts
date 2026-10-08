import { describe, expect, it } from 'vitest';
import { AiEnv, AiError, envForTask } from '../src/ai/provider.js';
import { makeVision, parseVisionReply } from '../src/ai/vision.js';
import { crossCheck } from '../src/ocr/crossCheck.js';
import type { ParsedField } from '../src/deps.js';

const bytes = Buffer.from('fake-image-bytes');
const reply = (rows: unknown[]) => JSON.stringify({ rows });
const okFetch = (body: unknown, calls: { url: string; init: RequestInit }[] = []): typeof fetch => (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status: 200 }); }) as never;
const vr = (name: string, value: string, unit: string | null = null) => ({ name, value, unit, referenceRange: null, flag: null });

describe('per-task AI settings', () => {
  const env = AiEnv.parse({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'main-key', GEMINI_MODEL: 'main-model', AI_VISION_API_KEY: 'vision-key', AI_VISION_MODEL: 'vision-model', AI_STT_PROVIDER: 'openai', OPENAI_API_KEY: 'o-key', OPENAI_MODEL: 'o-model' });
  it('a task with its own key and model uses them; the others keep the main ones', () => {
    expect(envForTask(env, 'VISION')).toMatchObject({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'vision-key', GEMINI_MODEL: 'vision-model' });
    expect(envForTask(env, 'TRANSLATE')).toMatchObject({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'main-key', GEMINI_MODEL: 'main-model' });
    expect(envForTask(env, 'TRIAGE')).toMatchObject({ GEMINI_API_KEY: 'main-key' });
  });
  it('a task can use a different provider', () => { expect(envForTask(env, 'STT')).toMatchObject({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'o-key' }); });
  it('does not change the original settings', () => { envForTask(env, 'VISION'); expect(env.GEMINI_API_KEY).toBe('main-key'); });
  it('the mock provider ignores keys', () => { expect(envForTask(AiEnv.parse({ AI_VISION_API_KEY: 'k' }), 'VISION')).toMatchObject({ AI_PROVIDER: 'mock' }); });
  it('rejects an unknown provider name', () => { expect(AiEnv.safeParse({ AI_VISION_PROVIDER: 'nope' }).success).toBe(false); });
});

describe('parseVisionReply', () => {
  it('keeps clean rows and trims them', () => {
    const r = parseVisionReply('```json\n' + reply([{ name: ' Hemoglobin ', value: '9.1', unit: 'g/dL', referenceRange: '12-15', flag: 'low' }]) + '\n```');
    expect(r.rows).toEqual([{ name: 'Hemoglobin', value: '9.1', unit: 'g/dL', referenceRange: '12-15', flag: 'low' }]); expect(r.dropped).toBe(0);
  });
  it('drops malformed rows, unknown flags, and rows the non-diagnostic guard rejects', () => {
    const r = parseVisionReply(reply([{ name: 'ESR', value: '30' }, { name: 'X' }, { name: 'Y', value: '1', flag: 'critical' }, { name: 'This is dengue fever', value: '1' }, 'junk']));
    expect(r.rows.map(x => x.name)).toEqual(['ESR']); expect(r.dropped).toBe(4);
  });
  it('caps the number of rows', () => { expect(parseVisionReply(reply(Array.from({ length: 200 }, (_, i) => ({ name: `T${i}`, value: '1' })))).rows.length).toBe(60); });
  it('anything that is not the expected JSON is a bad response', () => {
    for (const t of ['', 'sorry', '{"rows":"x"}', '[]']) expect(() => parseVisionReply(t)).toThrow(AiError);
  });
});

describe('makeVision', () => {
  const rows = [{ name: 'ESR', value: '30', unit: 'mm/hr' }];
  it('gemini: image goes as inline data, the key is in a header and never in the URL', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const v = makeVision({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'sekret', GEMINI_MODEL: 'g' }, okFetch({ candidates: [{ content: { parts: [{ text: reply(rows) }] } }] }, calls));
    const r = await v.read({ bytes, mime: 'image/jpeg' });
    expect(r.rows[0]).toMatchObject({ name: 'ESR', value: '30' }); expect(calls[0]!.url).not.toContain('sekret'); expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('sekret');
    const body = JSON.parse(String(calls[0]!.init.body)); expect(body.contents[0].parts[1].inline_data).toMatchObject({ mime_type: 'image/jpeg', data: bytes.toString('base64') }); expect(body.generationConfig.temperature).toBe(0);
    expect(body.contents[0].parts[0].text).toMatch(/Do NOT decide whether a value is abnormal/); expect(v.accepts('application/pdf')).toBe(true);
  });
  it('claude and openai: image blocks in the provider shape; pdf not accepted', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const c = makeVision({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' }, okFetch({ content: [{ type: 'text', text: reply(rows) }] }, calls));
    expect((await c.read({ bytes, mime: 'image/png' })).rows).toHaveLength(1); expect(JSON.parse(String(calls[0]!.init.body)).messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } }); expect(c.accepts('application/pdf')).toBe(false);
    const o = makeVision({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm' }, okFetch({ choices: [{ message: { content: reply(rows) } }] }, calls));
    expect((await o.read({ bytes, mime: 'image/webp' })).rows).toHaveLength(1); expect(JSON.parse(String(calls[1]!.init.body)).messages[0].content[1].image_url.url).toMatch(/^data:image\/webp;base64,/);
  });
  it('not configured, a refused request and a bad reply all raise AiError without echoing the body', async () => {
    const off = makeVision({ AI_PROVIDER: 'gemini' }); expect(off.supported).toBe(false); await expect(off.read({ bytes, mime: 'image/jpeg' })).rejects.toMatchObject({ kind: 'not_configured' });
    const refused = makeVision({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' }, (async () => new Response('SECRET BODY', { status: 400 })) as never);
    await expect(refused.read({ bytes, mime: 'image/jpeg' })).rejects.toThrow(/refused/);
    const bad = makeVision({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' }, okFetch({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }));
    await expect(bad.read({ bytes, mime: 'image/jpeg' })).rejects.toMatchObject({ kind: 'bad_response' });
  });
});

const f = (fieldName: string, valueNum: number | null, over: Partial<ParsedField> = {}): ParsedField => ({ fieldName, extractedValueText: `${fieldName} ${valueNum}`, valueNum, unit: null, referenceRangeText: null, printedFlag: null, confidence: 0.9, ...over });
describe('crossCheck', () => {
  it('agree, differ, ocr_only and ai_only, and never raises confidence', () => {
    const m = crossCheck([f('haemoglobin', 9.1), f('esr', 30), f('wbc_count', 11200)], [vr('Hb', '9.1'), vr('ESR', '38'), vr('Vitamin D', '12', 'ng/mL')]);
    expect(m.counts).toEqual({ agree: 1, differ: 1, ocr_only: 1, ai_only: 1 });
    expect(m.fields.find(x => x.fieldName === 'haemoglobin')).toMatchObject({ agreement: 'agree', confidence: 0.9 });
    expect(m.fields.find(x => x.fieldName === 'esr')).toMatchObject({ agreement: 'differ', secondRead: '38', confidence: 0.5 });
    expect(m.fields.find(x => x.fieldName === 'vitamin_d')).toMatchObject({ agreement: 'ai_only', confidence: 0.5, unit: 'ng/mL' });
  });
  it('a low OCR confidence stays low when they differ', () => { expect(crossCheck([f('esr', 30, { confidence: 0.2 })], [vr('ESR', '31')]).fields[0]!.confidence).toBe(0.2); });
  it('tiny rounding differences count as agreement; Indian digit grouping is understood', () => {
    expect(crossCheck([f('wbc_count', 11200)], [vr('WBC', '11,200')]).counts.agree).toBe(1);
    expect(crossCheck([f('haemoglobin', 9.1)], [vr('Haemoglobin', '9.1 ')]).counts.agree).toBe(1);
  });
  it('two rows for the same test are paired one to one', () => {
    expect(crossCheck([f('glucose', 90), f('glucose', 140)], [vr('Glucose', '140'), vr('Glucose', '90')]).counts).toEqual({ agree: 2, differ: 0, ocr_only: 0, ai_only: 0 });
  });
  it('a non-numeric AI value is stored as text with no number', () => {
    expect(crossCheck([], [vr('Urine protein', 'trace')]).fields[0]).toMatchObject({ valueNum: null, secondRead: 'trace', agreement: 'ai_only' });
  });
});

describe('empty lines in .env', () => {
  it('empty per-task settings mean "not set" and fall back to the main ones', () => {
    const env = AiEnv.parse({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'main', GEMINI_MODEL: 'm', AI_VISION_PROVIDER: '', AI_VISION_API_KEY: '', AI_VISION_MODEL: '' });
    expect(envForTask(env, 'VISION')).toMatchObject({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'main', GEMINI_MODEL: 'm' });
  });
});
