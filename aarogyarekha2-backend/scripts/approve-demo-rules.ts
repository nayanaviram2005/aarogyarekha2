import pg from 'pg';
import { RULESET_DRAFT } from '../src/triage/ruleset.draft.js';
import { RULESET_PROPOSED } from '../src/triage/ruleset.proposed.js';
import { hashRuleSet } from '../src/triage/engine.js';

export const DEMO_CITATION =
  'HACKATHON DEMO ONLY. Rules transcribed from memory of WHO ETAT, WHO/UNICEF IMNCI (India adaptation), India NHM maternal ' +
  'danger signs and RCP NEWS2 (2017). NOT verified against the primary documents. NOT clinically validated. ' +
  'Synthetic data only. Not for use with real patients.';

const RS = process.argv.includes('--proposed') ? RULESET_PROPOSED : RULESET_DRAFT;
const confirm = process.argv.includes('--confirm');
const retire = process.argv.includes('--retire');

const url = process.env.DATABASE_URL_POOLER?.replace(':6543/', ':5432/') || process.env.DATABASE_URL_DIRECT;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
try {
  const hash = hashRuleSet(RS);
  const found = await c.query('select id, status, definition, source_citation from public.triage_rule_sets where name = $1 and version = $2', [RS.name, RS.version]);
  if (!found.rowCount) { console.error(`Rule set ${RS.name}@${RS.version} is not registered. Run: npm --prefix aarogyarekha2-backend run ruleset:register`); process.exitCode = 1; }
  else {
    const row = found.rows[0];
    console.log(`Rule set: ${RS.name}@${RS.version}   current status: ${row.status}`);
    if (row.definition?.integrityHash !== hash) {
      console.error('The stored rules do not match the rules in the code (integrity hash differs). Register the current version first. Nothing changed.');
      process.exitCode = 1;
    } else if (retire) {
      console.log(confirm ? 'Retiring the rule set.' : 'Would set status to retired. Add --confirm to do it.');
      if (confirm) { await c.query(`update public.triage_rule_sets set status = 'retired' where id = $1`, [row.id]); console.log('Done. Assessments will no longer be stored.'); }
    } else {
      console.log('\nThis will record:\n  status:   approved\n  approved: now (no approving user is recorded)\n  citation: ' + DEMO_CITATION + '\n');
      if (!confirm) console.log('Nothing changed. To record it, run again with --confirm.');
      else {
        await c.query(`update public.triage_rule_sets set status = 'approved', approved_at = now(), source_citation = $2 where id = $1`, [row.id, DEMO_CITATION]);
        console.log('Done. Assessments on synthetic patients will now be stored. The screens will keep saying the rules are not clinically validated.');
      }
    }
  }
} finally { await c.end(); }
