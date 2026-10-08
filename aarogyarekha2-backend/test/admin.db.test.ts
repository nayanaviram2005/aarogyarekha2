// Emergency access and audit-chain checks against the REAL schema in an in-process Postgres.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeSystemAdmin } from '../src/admin/store.js';
import { BreakGlassError } from '../src/deps.js';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID(), PT = randomUUID();
const U = { nurse: randomUUID(), hw: randomUUID(), admin: randomUUID(), other: randomUUID() };
const sys = () => makeSystemAdmin({ query: async (sql, p) => ({ rows: (await db.query(sql, p as any[])).rows as any[] }) });
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as Error; } };

beforeAll(async () => {
  db = await makeDb();
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${k}@t.test`]);
  await db.query(`insert into public.facilities (id, name, type) values ($1,'PHC','phc'), ($2,'DH','district_hospital')`, [F1, F2]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name, public_ref) values ($1,$2,'Hidden Patient','AR-7777')`, [PT, F2]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$3,'nurse'), ($2,$3,'health_worker'), ($4,$3,'facility_admin'), ($5,$6,'nurse')`, [U.nurse, U.hw, F1, U.admin, U.other, F2]);
});

describe('grantBreakGlass', () => {
  it('grants one hour of access to a clinician, by record number in any letter case', async () => {
    const g = await sys().grantBreakGlass({ userId: U.nurse, facilityId: F1, publicRef: 'ar-7777', reason: 'Unconscious on arrival, no relatives' });
    expect(g).toMatchObject({ patientId: PT, publicRef: 'AR-7777' });
    const ms = Date.parse(g.expiresAt) - Date.now(); expect(ms).toBeGreaterThan(55 * 60_000); expect(ms).toBeLessThanOrEqual(61 * 60_000);
    expect((await rows('select user_id, facility_id, reason from public.break_glass_grants where id = $1', [g.id]))[0]).toMatchObject({ user_id: U.nurse, facility_id: F1, reason: 'Unconscious on arrival, no relatives' });
  });
  it('an unknown record number is "not found"', async () => {
    const e = await fails(sys().grantBreakGlass({ userId: U.nurse, facilityId: F1, publicRef: 'AR-0000', reason: 'Unconscious on arrival' }));
    expect(e).toBeInstanceOf(BreakGlassError); expect((e as BreakGlassError).kind).toBe('not_found');
  });
  it('someone who is not clinical staff at that facility is refused: an admin, a stranger, the wrong facility', async () => {
    for (const [u, f] of [[U.admin, F1], [randomUUID(), F1], [U.nurse, F2]] as const) {
      const e = await fails(sys().grantBreakGlass({ userId: u, facilityId: f, publicRef: 'AR-7777', reason: 'Unconscious on arrival' }));
      expect(e).toBeInstanceOf(BreakGlassError); expect((e as BreakGlassError).kind).toBe('forbidden');
    }
  });
  it('a deactivated membership is refused', async () => {
    await db.query(`update public.memberships set is_active = false where user_id = $1`, [U.hw]);
    expect((await fails(sys().grantBreakGlass({ userId: U.hw, facilityId: F1, publicRef: 'AR-7777', reason: 'Unconscious on arrival' })) as BreakGlassError).kind).toBe('forbidden');
  });
  it('the database itself refuses a reason shorter than 10 characters', async () => {
    expect(await fails(sys().grantBreakGlass({ userId: U.nurse, facilityId: F1, publicRef: 'AR-7777', reason: 'urgent' }))).not.toBeNull();
  });
  it('a grant writes an audit entry by itself (the database trigger), without the reason text in its details', async () => {
    const before = (await rows(`select count(*)::int n from public.audit_events where action = 'break_glass'`))[0].n;
    await sys().grantBreakGlass({ userId: U.nurse, facilityId: F1, publicRef: 'AR-7777', reason: 'Second emergency, chest pain' });
    expect((await rows(`select count(*)::int n from public.audit_events where action = 'break_glass'`))[0].n).toBe(before + 1);
  });
});

describe('listBreakGlass', () => {
  it('lists only grants at the given facilities, newest first, with the record number and never the name', async () => {
    const list = await sys().listBreakGlass([F1], 50);
    expect(list.length).toBeGreaterThanOrEqual(2); expect(list.every(g => g.facility_id === F1)).toBe(true); expect(list[0]!.patient_ref).toBe('AR-7777');
    expect(JSON.stringify(list)).not.toContain('Hidden Patient'); expect(Date.parse(list[0]!.created_at)).toBeGreaterThanOrEqual(Date.parse(list[1]!.created_at));
    expect(await sys().listBreakGlass([F2], 50)).toEqual([]); expect(await sys().listBreakGlass([], 50)).toEqual([]);
  });
  it('respects the limit', async () => { expect(await sys().listBreakGlass([F1], 1)).toHaveLength(1); });
});

describe('verifyChain', () => {
  it('an untouched log verifies', async () => {
    const r = await sys().verifyChain();
    expect(r.brokenIds).toEqual([]); expect(r.checked).toBeGreaterThan(0);
  });
  it('detects an edited row, and names it', async () => {
    const victim = (await rows(`select id from public.audit_events order by id limit 1 offset 1`))[0].id as string;
    await db.query(`alter table public.audit_events disable trigger trg_audit_immutable`);
    await db.query(`update public.audit_events set outcome = 'denied', entity_type = 'tampered' where id = $1`, [victim]);
    await db.query(`alter table public.audit_events enable trigger trg_audit_immutable`);
    const r = await sys().verifyChain();
    expect(r.brokenIds).toContain(Number(victim));
  });
});
