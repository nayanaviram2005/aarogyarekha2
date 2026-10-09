import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), P = randomUUID();
const E = { submitted: randomUUID(), reviewed: randomUUID(), referred: randomUUID(), closed: randomUUID() };
const U = { doctor: randomUUID(), mo: randomUUID(), nurse: randomUUID(), away: randomUUID() };

async function as<T>(user: string, f: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false), set_config('request.jwt.claim.role', 'authenticated', false);`);
  try { return await f(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; message: string }; } };
const add = (u: string, enc: string, body: string | null, kind = 'doctor_note') =>
  as(u, () => db.query(`insert into public.reviewer_notes (encounter_id, author_id, kind, body) values ($1,$2,$3,$4) returning id`, [enc, u, kind, body]));

beforeAll(async () => {
  db = await makeDb();
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`]);
  await db.query(`insert into public.facilities (id, name, type) values ($1,'PHC','phc'), ($2,'District hospital','district_hospital')`, [F1, F2]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$5,'doctor'), ($2,$5,'medical_officer'), ($3,$5,'nurse'), ($4,$6,'doctor')`, [U.doctor, U.mo, U.nurse, U.away, F1, F2]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1,$2,'Notes Patient')`, [P, F1]);
  for (const [status, id] of Object.entries(E)) await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1,$2,$3,$4)`, [id, P, F1, status]);
});

describe('who may write a doctor\'s note, and when', () => {
  it('a doctor and a medical officer can, once the priority is signed off, whether the visit is open, referred or closed', async () => {
    for (const enc of [E.reviewed, E.referred, E.closed]) expect((await add(U.doctor, enc, 'Started oral antibiotics; review in 3 days')).rows).toHaveLength(1);
    expect((await add(U.mo, E.reviewed, 'Advised rest and fluids')).rows).toHaveLength(1);
  });
  it('not before sign-off', async () => {
    const e = await fails(add(U.doctor, E.submitted, 'Too early')); expect(e?.code).toBe('23514'); expect(e?.message).toMatch(/signed off/);
  });
  it('a nurse and a doctor at another facility cannot', async () => {
    for (const u of [U.nurse, U.away]) expect((await fails(add(u, E.reviewed, 'Not mine')))?.code, u).toBe('42501');
  });
  it('a nurse can still write an ordinary note', async () => {
    expect((await add(U.nurse, E.submitted, 'Recheck pulse', 'comment')).rows).toHaveLength(1);
  });
});

describe('what is accepted', () => {
  it('needs text, and allows up to 2000 characters, while other notes stay at 1000', async () => {
    expect(await fails(add(U.doctor, E.reviewed, null))).not.toBeNull(); expect(await fails(add(U.doctor, E.reviewed, '   '))).not.toBeNull();
    expect((await add(U.doctor, E.reviewed, 'x'.repeat(2000))).rows).toHaveLength(1); expect(await fails(add(U.doctor, E.reviewed, 'x'.repeat(2001)))).not.toBeNull();
    expect(await fails(add(U.nurse, E.reviewed, 'x'.repeat(1001), 'comment'))).not.toBeNull();
  });
  it('the earlier kinds are still accepted', async () => {
    for (const kind of ['comment', 'escalation']) expect((await add(U.nurse, E.reviewed, 'Still works', kind)).rows).toHaveLength(1);
    expect((await add(U.nurse, E.reviewed, null, 'feedback_up')).rows).toHaveLength(1);
  });
});

describe('what reads it, and append-only', () => {
  it('staff at the facility read it; a doctor elsewhere sees nothing until emergency access is granted, and nothing after it expires', async () => {
    const read = (u: string) => as(u, () => db.query(`select body from public.reviewer_notes where encounter_id = $1 and kind = 'doctor_note'`, [E.closed]));
    expect((await read(U.nurse)).rows.length).toBeGreaterThan(0);
    expect((await read(U.away)).rows).toHaveLength(0);
    const g = (await db.query(`insert into public.break_glass_grants (user_id, patient_id, facility_id, reason) values ($1,$2,$3,'Unconscious on arrival, relatives not found') returning id`, [U.away, P, F2])).rows[0] as { id: string };
    const seen = (await read(U.away)).rows as { body: string }[];
    expect(seen.map(r => r.body)).toContain('Started oral antibiotics; review in 3 days');
    await db.query(`alter table public.break_glass_grants disable trigger user`);
    await db.query(`update public.break_glass_grants set expires_at = now() - interval '1 minute', created_at = now() - interval '2 hours' where id = $1`, [g.id]);
    await db.query(`alter table public.break_glass_grants enable trigger user`);
    expect((await read(U.away)).rows).toHaveLength(0);
  });
  it('a doctor\'s note can never be changed or removed', async () => {
    const id = (await add(U.doctor, E.reviewed, 'Fixed in stone')).rows[0] as { id: string };
    expect(await fails(db.query(`update public.reviewer_notes set body = 'changed' where id = $1`, [id.id]))).not.toBeNull();
    expect(await fails(db.query(`delete from public.reviewer_notes where id = $1`, [id.id]))).not.toBeNull();
  });
  it('the audit entry holds the kind and no text', async () => {
    await add(U.doctor, E.reviewed, 'secret treatment wording');
    const rows = (await db.query(`select details from public.audit_events where entity_type = 'reviewer_notes' order by id desc limit 1`)).rows as { details: unknown }[];
    expect(JSON.stringify(rows[0]?.details ?? {})).not.toContain('secret treatment wording');
  });
});
