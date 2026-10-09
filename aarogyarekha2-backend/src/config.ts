import { z } from 'zod';
import { AiEnv, type AiEnvValues } from './ai/provider.js';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  DATABASE_URL_DIRECT: z.string().optional(),
  DATABASE_URL_POOLER: z.string().optional(),
  DATABASE_URL_RUNTIME: z.enum(['pooler', 'direct']).default('pooler'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  API_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(20).default(10),
  OCR_PROVIDER: z.enum(['local', 'mock']).default('local'),
  OCR_PHOTOS: z.enum(['local', 'ai', 'ai_then_local']).default('local'),
  TESSDATA_PATH: z.string().optional(),
  MFA_REQUIRED: z.enum(['true', 'false']).default('true'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(60).max(5000).default(600),
  ACCESS_BUDGET_PATIENTS_PER_HOUR: z.coerce.number().int().min(0).max(5000).default(80),
  SMS_PROVIDER: z.preprocess(v => (v === '' ? undefined : v), z.enum(['mock', 'twilio']).default('mock')),
  TWILIO_ACCOUNT_SID: z.string().optional(), TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(), TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  SMS_DEFAULT_COUNTRY_CODE: z.preprocess(v => (v === '' ? undefined : v), z.string().regex(/^\+[0-9]{1,3}$/).default('+91')),
  SMS_WEBHOOK_URL: z.string().optional(),
  TRIAGE_RULESET_NAME: z.string().optional(),
  TRIAGE_RULESET_VERSION: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { databaseUrl: string; allowedOrigins: string[]; uploadMaxMb: number; requireMfa: boolean; rateLimitPerMinute: number; accessBudgetPerHour: number; ocrPhotos: 'local' | 'ai' | 'ai_then_local'; sms: { provider: 'mock' | 'twilio'; accountSid?: string; authToken?: string; from?: string; messagingServiceSid?: string; defaultCountry: string; webhookUrl?: string }; triageRuleSet?: { name: string; version: string }; ai: AiEnvValues };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const bad = parsed.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${bad}`);
  }
  if (env.AI_REQUIRE_DEIDENTIFICATION === 'false') throw new Error('Invalid configuration: AI_REQUIRE_DEIDENTIFICATION must stay true');
  const ai = AiEnv.safeParse(env);
  if (!ai.success) throw new Error(`Invalid configuration: ${ai.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const c = parsed.data;
  const databaseUrl = c.DATABASE_URL_RUNTIME === 'pooler' ? c.DATABASE_URL_POOLER : c.DATABASE_URL_DIRECT;
  if (!databaseUrl) throw new Error(`Invalid configuration: DATABASE_URL_${c.DATABASE_URL_RUNTIME.toUpperCase()} is empty`);
  return {
    ...c,
    databaseUrl,
    allowedOrigins: c.API_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    uploadMaxMb: c.UPLOAD_MAX_MB,
    requireMfa: c.MFA_REQUIRED === 'true',
    rateLimitPerMinute: c.RATE_LIMIT_PER_MINUTE,
    accessBudgetPerHour: c.ACCESS_BUDGET_PATIENTS_PER_HOUR,
    ocrPhotos: c.OCR_PHOTOS,
    sms: { provider: c.SMS_PROVIDER, accountSid: c.TWILIO_ACCOUNT_SID?.trim() || undefined, authToken: c.TWILIO_AUTH_TOKEN?.trim() || undefined, from: c.TWILIO_FROM?.trim() || undefined,
           messagingServiceSid: c.TWILIO_MESSAGING_SERVICE_SID?.trim() || undefined, defaultCountry: c.SMS_DEFAULT_COUNTRY_CODE, webhookUrl: c.SMS_WEBHOOK_URL?.trim() || undefined },
    ai: ai.data,
    ...(c.TRIAGE_RULESET_NAME && c.TRIAGE_RULESET_VERSION ? { triageRuleSet: { name: c.TRIAGE_RULESET_NAME, version: c.TRIAGE_RULESET_VERSION } } : {}),
  };
}
