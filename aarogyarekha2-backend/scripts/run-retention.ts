import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { makePool } from '../src/liveDeps.js';
import { makeRetentionStore } from '../src/retention/store.js';
import { runRetention, type FileRemover } from '../src/retention/run.js';

const apply = process.argv.includes('--apply');
const config = loadConfig();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const raw = process.env.RETENTION_DOCUMENT_DAYS?.trim();
const days = raw ? Number(raw) : null;
if (raw && !(Number.isFinite(days) && (days as number) > 0)) { console.log('RETENTION_DOCUMENT_DAYS must be a positive number of days.'); process.exit(1); }
if (apply && !key) { console.log('SUPABASE_SERVICE_ROLE_KEY is needed to delete files. Nothing was deleted.'); process.exit(1); }

const sb = key ? createClient(config.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const files: FileRemover = { remove: async paths => { const r = await sb!.storage.from('patient-documents').remove(paths); return { error: r.error ? 'storage refused the delete' : null }; } };

const pool = makePool(config);
try {
  const r = await runRetention(makeRetentionStore({ query: (sql, p) => pool.query(sql, p as unknown[]), connect: async () => { const c = await pool.connect(); return { query: (sql: string, p?: unknown[]) => c.query(sql, p), release: () => c.release() }; } }), files, { defaultDays: days, dryRun: !apply });
  console.log(`${r.dryRun ? 'DRY RUN (nothing changed)' : 'APPLIED'}: ${r.due} due, ${r.deleted} deleted, ${r.failed} failed`);
  if (r.skipped) console.log(r.skipped);
  if (r.failed) process.exitCode = 1;
} catch (e) { console.log('FAILED:', (e as Error).name); process.exitCode = 1; }
finally { await pool.end(); }
