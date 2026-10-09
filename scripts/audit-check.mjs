import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL_POOLER.replace(':6543/', ':5432/'), ssl: { rejectUnauthorized: false } });
await c.connect();
const rows = await c.query(`select id, action, entity_type, outcome, actor_user_id is null as no_actor, left(request_id,8) req, ip::text, left(user_agent,20) ua from public.audit_events order by id desc limit 5`);
console.table(rows.rows);
const broken = await c.query(`select broken_id from app.verify_audit_chain(0)`);
console.log('audit chain broken rows:', broken.rows.length);
await c.end();
