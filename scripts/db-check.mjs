// Read-only connectivity + state check. Never prints credentials.
import pg from 'pg';
const which = process.env.DATABASE_URL_RUNTIME === 'pooler' ? 'DATABASE_URL_POOLER' : 'DATABASE_URL_DIRECT';
const url = process.env.DATABASE_URL_POOLER?.replace(":6543/", ":5432/") || process.env.DATABASE_URL_DIRECT; // session mode for admin checks
if (!url) { console.error('No database URL set'); process.exit(1); }
const host = new URL(url).host.replace(/^[^@]*@/, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  await c.connect();
  console.log('connected to', host);
  const v = await c.query('select version()');
  console.log(v.rows[0].version.split(',')[0]);
  const t = await c.query(`select count(*)::int n from information_schema.tables where table_schema='public'`);
  console.log('public tables:', t.rows[0].n);
  const e = await c.query(`select evtname from pg_event_trigger order by 1`);
  console.log('event triggers:', e.rows.map(r => r.evtname).join(', ') || '(none)');
  const m = await c.query(`select to_regclass('supabase_migrations.schema_migrations') is not null as has`);
  console.log('migration table present:', m.rows[0].has);
} catch (err) {
  console.error('FAILED:', err.code || '', err.message.replace(/postgresql:\/\/[^\s]+/g, '<url>'));
  process.exitCode = 1;
} finally { await c.end().catch(() => {}); }
