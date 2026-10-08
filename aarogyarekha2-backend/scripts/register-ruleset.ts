// Registers the DRAFT rule set in the hosted database. It never approves anything.
// Approval is a human act (see docs/03-triage-algorithm.md): until then the database refuses to store assessments against it.
//   npm run ruleset:register
import pg from 'pg';
import { RULESET_DRAFT } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED } from '../src/triage/ruleset.proposed.js';
import { hashRuleSet } from '../src/triage/engine.js';

// Default registers v0.1.1. Pass --proposed to register the PROPOSED v0.2.0 as another DRAFT row (still not approved, still not in use).
const RS = process.argv.includes('--proposed') ? RULESET_PROPOSED : RULESET_DRAFT;
const url = process.env.DATABASE_URL_POOLER?.replace(':6543/', ':5432/') || process.env.DATABASE_URL_DIRECT;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
try {
  const hash = hashRuleSet(RS);
  const definition = { ...RS, integrityHash: hash };
  const existing = await c.query('select id, status, definition from public.triage_rule_sets where name = $1 and version = $2', [RS.name, RS.version]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    console.log(`already registered: ${RS.name}@${RS.version} (status: ${row.status})`);
    if (row.definition?.integrityHash !== hash) {
      console.log('WARNING: the stored rules differ from the code. Bump `version` in ruleset.draft.ts to register the new rules; the stored row is left untouched.');
      process.exitCode = 1;
    }
  } else {
    await c.query(`insert into public.triage_rule_sets (name, version, status, definition) values ($1, $2, 'draft', $3::jsonb)`, [RS.name, RS.version, JSON.stringify(definition)]);
    console.log(`registered ${RS.name}@${RS.version} as DRAFT`);
  }
  console.log(`integrity hash: ${hash}`);
} finally { await c.end(); }
