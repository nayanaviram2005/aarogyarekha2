import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dry = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL_POOLER?.replace(':6543/', ':5432/') || process.env.DATABASE_URL_DIRECT;
const dir = 'supabase/migrations';
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
try {
  const hasTable = (await c.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as has`)).rows[0].has;
  if (!hasTable) {
    if (dry) console.log('would create supabase_migrations.schema_migrations');
    else await c.query(`create schema if not exists supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
  }
  const done = new Set(hasTable || !dry
    ? (await c.query('select version from supabase_migrations.schema_migrations')).rows.map(r => r.version)
    : []);
  for (const f of files) {
    const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
    if (done.has(version)) { console.log('skip        ', f); continue; }
    if (dry) { console.log('would apply ', f); continue; }
    const sql = readFileSync(join(dir, f), 'utf8');
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('insert into supabase_migrations.schema_migrations(version, statements, name) values ($1, $2, $3)',
        [version, [sql], rest.join('_')]);
      await c.query('commit');
      console.log('applied     ', f);
    } catch (e) {
      await c.query('rollback');
      console.error('FAILED      ', f, '-', e.message);
      process.exitCode = 1;
      break;
    }
  }
} finally { await c.end(); }
