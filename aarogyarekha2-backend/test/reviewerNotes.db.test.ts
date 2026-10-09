import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), P = randomUUID(), E = randomUUID(), E2 = randomUUID(), A = randomUUID(), RS = randomUUID();
const U = { nurse: randomUUID(), hw: randomUUID(), other: randomUUID(), admin: randomUUID() };

async function as<T>(user: string, f: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false), set_config('request.jwt.claim.role', 'authenticated', false);`);
  try { return await f(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; message: string }; } };
const note = (u: string, kind: string, body: string | null, enc = E, ass: string | null = null) =>
  as(u, () => db.query(`insert into public.reviewer_notes (encounter_id, assessment_id, author_id, kind, body) values ($1,$2,$3,$4,$5) returning id`, [enc, ass, u, kind, body]));

beforeAll(async () => {
  db = await makeDb();
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`]);
  await db.query(`insert into public.facilities (id, name, type) values ($1,'PHC','phc'), ($2,'DH','district_hospital')`, [F1, F2]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$5,'nurse'), ($2,$5,'health_worker'), ($3,$6,'doctor'), ($4,$5,'facility_admin')`, [U.nurse, U.hw, U.other, U.admin, F1, F2]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1,$2,'Note Test')`, [P, F1]);
  await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1,$2,$3,'submitted'), ($4,$2,$3,'submitted')`, [E, P, F1, E2]);
  await db.query(`insert into public.triage_rule_sets (id, name, version, status, source_citation, definition, approved_at) values ($1,'t','1','approved','TEST','{}'::jsonb, now())`, [RS]);
  await db.query(`insert into public.triage_assessments (id, encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version) values ($1,$2,1,$3,'rules_engine','orange','{}'::jsonb,'fp','t')`, [A, E, RS]);
});

describe('who may write', () => {
  it('a nurse at the facility can add a comment, an escalation and feedback', async () => {
    expect((await note(U.nurse, 'comment', 'Please recheck pulse in 10 minutes')).rows).toHaveLength(1);
    expect((await note(U.nurse, 'escalation', 'Looks worse than the score shows; senior review')).rows).toHaveLength(1);
    expect((await note(U.nurse, 'feedback_up', null, E, A)).rows).toHaveLength(1);
    expect((await note(U.nurse, 'feedback_down', 'Missed that the patient is pregnant', E, A)).rows).toHaveLength(1);
  });
  it('a health worker, an administrator and a doctor at ANOTHER facility cannot', async () => {
    for (const u of [U.hw, U.admin, U.other]) expect((await fails(note(u, 'comment', 'nope')))?.code, u).toBe('42501');
  });
  it('nobody can write as someone else', async () => {
    const e = await fails(as(U.nurse, () => db.query(`insert into public.reviewer_notes (encounter_id, author_id, kind, body) values ($1,$2,'comment','x')`, [E, U.hw])));
    expect(e?.code).toBe('42501');
  });
  it('an assessment from a different encounter is refused', async () => {
    expect((await fails(note(U.nurse, 'feedback_up', null, E2, A)))?.code).toBe('42501');
  });
});

describe('what is accepted', () => {
  it('comments and escalations need text; feedback does not', async () => {
    expect(await fails(note(U.nurse, 'comment', null))).not.toBeNull(); expect(await fails(note(U.nurse, 'escalation', '   '))).not.toBeNull(); expect((await note(U.nurse, 'feedback_up', null)).rows).toHaveLength(1);
  });
  it('rejects an unknown kind and text over 1000 characters', async () => {
    expect(await fails(note(U.nurse, 'approval', 'x'))).not.toBeNull(); expect(await fails(note(U.nurse, 'comment', 'x'.repeat(1001)))).not.toBeNull(); expect((await note(U.nurse, 'comment', 'x'.repeat(1000))).rows).toHaveLength(1);
  });
});

describe('who may read, and append-only', () => {
  it('staff at the facility can read; a user at another facility sees none', async () => {
    expect((await as(U.hw, () => db.query(`select id from public.reviewer_notes where encounter_id = $1`, [E]))).rows.length).toBeGreaterThan(0);
    expect((await as(U.other, () => db.query(`select id from public.reviewer_notes where encounter_id = $1`, [E]))).rows).toHaveLength(0);
  });
  it('a note can never be changed or removed, even by the author', async () => {
    const id = (await note(U.nurse, 'comment', 'fixed in stone')).rows[0] as { id: string };
    expect(await fails(db.query(`update public.reviewer_notes set body = 'changed' where id = $1`, [id.id]))).not.toBeNull();
    expect(await fails(db.query(`delete from public.reviewer_notes where id = $1`, [id.id]))).not.toBeNull();
  });
  it('writing a note leaves an audit entry that holds the kind and no text', async () => {
    await note(U.nurse, 'escalation', 'secret clinical wording');
    const rows = (await db.query(`select details from public.audit_events where entity_type = 'reviewer_notes' order by id desc limit 1`)).rows as { details: unknown }[];
    expect(JSON.stringify(rows[0]?.details ?? {})).not.toContain('secret clinical wording');
  });
});
