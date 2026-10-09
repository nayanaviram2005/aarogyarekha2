import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { assessEncounter, DISCLAIMER, RuleSetUnavailable, type PoolLike } from '../src/triage/persist.js';
import { hashRuleSet } from '../src/triage/engine.js';
import { RULESET_DRAFT } from '../src/triage/ruleset.draft.js';
import { NonDiagnosticViolation } from '../src/guard/nonDiagnostic.js';
import type { RuleSet, TriageInput } from '../src/triage/types.js';

const db = new PGlite();
const pool: PoolLike = {
  connect: async () => ({ query: async (sql, params) => ({ rows: (await db.query(sql, params as any[])).rows as any[] }), release() {} }),
};
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];

const F = randomUUID(), P = randomUUID(), E = randomUUID(), E2 = randomUUID();

const fixture = (rs: RuleSet, status: 'approved' | 'draft', tamper = false) => ({
  def: { ...rs, integrityHash: tamper ? 'f'.repeat(64) : hashRuleSet(rs) },
  status,
});
async function addRuleSet(name: string, version: string, rs: RuleSet, status: 'approved' | 'draft', tamper = false) {
  const { def } = fixture({ ...rs, name, version }, status, tamper);
  await db.query(
    `insert into public.triage_rule_sets (name, version, status, source_citation, definition, approved_at)
     values ($1, $2, $3, $4, $5::jsonb, ${status === 'approved' ? 'now()' : 'null'})`,
    [name, version, status, status === 'approved' ? 'TEST FIXTURE ONLY - not a real approval' : null, JSON.stringify(def)]);
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, service_role;
    grant select, insert on storage.objects to authenticated;
    grant all on storage.objects, storage.buckets to service_role;
  `);
  const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));

  await db.query(`insert into public.facilities (id, name, type) values ($1, 'Test PHC', 'phc')`, [F]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1, $2, 'Test Patient')`, [P, F]);
  await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1, $2, $3, 'submitted'), ($4, $2, $3, 'submitted')`, [E, P, F, E2]);

  await addRuleSet('t-approved', '1.0.0', RULESET_DRAFT, 'approved');
  await addRuleSet('t-draft', '1.0.0', RULESET_DRAFT, 'draft');
  await addRuleSet('t-tampered', '1.0.0', RULESET_DRAFT, 'approved', true);
  const poisoned: RuleSet = { ...RULESET_DRAFT, floors: [{ ...RULESET_DRAFT.floors[0]!, label: 'Diagnosis: dengue fever' }, ...RULESET_DRAFT.floors.slice(1)] };
  await addRuleSet('t-poisoned', '1.0.0', poisoned, 'approved');
});

const adult = (over: Partial<TriageInput> = {}): TriageInput => ({
  ageYears: 40, pregnant: false, consciousness: 'alert', onSupplementalOxygen: false, signs: { central_cyanosis: false },
  vitals: { resp_rate_pm: 16, spo2_pct: 98, bp_systolic_mmhg: 120, pulse_bpm: 72, temperature_c: 37 }, ...over,
});
const args = (ruleSetName: string, input: TriageInput, encounterId = E) => ({ encounterId, facilityId: F, ruleSetName, ruleSetVersion: '1.0.0', input });
const count = async (t: string, enc = E) => (await rows(`select count(*)::int n from public.${t} where encounter_id = $1`, [enc]))[0].n as number;

describe('rule set gate', () => {
  it('refuses a DRAFT rule set and writes nothing', async () => {
    await expect(assessEncounter(pool, args('t-draft', adult()))).rejects.toMatchObject({ reason: 'not_approved' });
    expect(await count('triage_assessments')).toBe(0);
    expect(await count('queue_items')).toBe(0);
  });

  it('refuses an unknown rule set', async () => {
    await expect(assessEncounter(pool, args('nope', adult()))).rejects.toBeInstanceOf(RuleSetUnavailable);
    await expect(assessEncounter(pool, args('nope', adult()))).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('refuses an approved set whose stored rules no longer match their recorded hash', async () => {
    await expect(assessEncounter(pool, args('t-tampered', adult()))).rejects.toMatchObject({ reason: 'integrity' });
    expect(await count('triage_assessments')).toBe(0);
  });

  it('the database itself refuses to attach a draft rule set, even if the app were bypassed', async () => {
    const rs = (await rows(`select id from public.triage_rule_sets where name = 't-draft'`))[0].id;
    await expect(db.query(
      `insert into public.triage_assessments (encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version)
       values ($1, 99, $2, 'rules_engine', 'green', '{}'::jsonb, 'x', 'x')`, [E, rs])).rejects.toThrow(/not approved/);
  });
});

describe('persisting an assessment', () => {
  it('stores the assessment, its signals and a queue entry, stamped with the rule set', async () => {
    const r = await assessEncounter(pool, args('t-approved', adult({ signs: { central_cyanosis: true } })));
    expect(r).toMatchObject({ version: 1, queueUrgency: 'red', downgradeSuggested: false });
    const a = (await rows(`select * from public.triage_assessments where id = $1`, [r.assessmentId]))[0];
    expect(a).toMatchObject({ urgency_code: 'red', basis: 'rules_engine', encounter_id: E });
    expect(a.note.disclaimer).toBe(DISCLAIMER);
    expect(a.note.ruleSet).toMatchObject({ name: 't-approved', status: 'approved' });
    expect(a.input_fingerprint).toBe(r.decision.inputFingerprint);
    const sig = await rows(`select signal_code, kind from public.triage_signals where assessment_id = $1`, [r.assessmentId]);
    expect(sig.map(s => s.signal_code)).toContain('red_flag.etat_e3');
    expect((await rows(`select urgency_code from public.queue_items where encounter_id = $1`, [E]))[0].urgency_code).toBe('red');
  });

  it('stores no diagnosis anywhere in the note', async () => {
    const a = (await rows(`select note from public.triage_assessments where encounter_id = $1`, [E]))[0];
    const { disclaimer, ...derived } = a.note;
    expect(disclaimer).toBe(DISCLAIMER);
    expect(JSON.stringify(derived).toLowerCase()).not.toContain('diagnos');
  });

  it('a re-run gets the next version', async () => {
    const r = await assessEncounter(pool, args('t-approved', adult({ signs: { central_cyanosis: true }, consciousness: 'voice' })));
    expect(r.version).toBe(2);
  });

  it('the queue is escalate-only: a better re-run is suggested as a downgrade but does not lower the queue', async () => {
    const r = await assessEncounter(pool, args('t-approved', adult()));
    expect(r.decision.urgencyCode).toBe('green');
    expect(r.queueUrgency).toBe('red');
    expect(r.downgradeSuggested).toBe(true);
    expect((await rows(`select urgency_code from public.queue_items where encounter_id = $1`, [E]))[0].urgency_code).toBe('red');
  });

  it('a fresh encounter starts at its own urgency and a worse re-run raises it', async () => {
    const first = await assessEncounter(pool, args('t-approved', adult(), E2));
    expect(first.queueUrgency).toBe('green');
    const worse = await assessEncounter(pool, args('t-approved', adult({ consciousness: 'voice' }), E2));
    expect(worse.queueUrgency).toBe('orange');
    expect(worse.downgradeSuggested).toBe(false);
  });

  it('assessments cannot be edited or deleted afterwards', async () => {
    await expect(db.query(`update public.triage_assessments set urgency_code = 'green' where encounter_id = $1`, [E])).rejects.toThrow();
    await expect(db.query(`delete from public.triage_assessments where encounter_id = $1`, [E])).rejects.toThrow();
  });
});

describe('guard and atomicity', () => {
  it('a rule set whose label would be stored as a diagnosis is rejected and nothing is written', async () => {
    const before = await count('triage_assessments', E2);
    const input = adult({ signs: { airway_obstructed_or_not_breathing: true } });
    await expect(assessEncounter(pool, args('t-poisoned', input, E2))).rejects.toBeInstanceOf(NonDiagnosticViolation);
    expect(await count('triage_assessments', E2)).toBe(before);
  });
});
