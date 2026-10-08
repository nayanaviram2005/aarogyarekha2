// Migration 0016 (who works where, in what role) against the REAL schema in an in-process Postgres.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F1 = randomUUID(), F2 = randomUUID();
const U = { admin: randomUUID(), admin2: randomUUID(), otherAdmin: randomUUID(), plat: randomUUID(), nurse: randomUUID(), hw: randomUUID(), newbie: randomUUID(), noProfile: randomUUID() };
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const setRole = (actor: string, fac: string, user: string, role: string) => rows(`select app.set_member_role($1::uuid,$2::uuid,$3::uuid,$4::public.app_role) r`, [actor, fac, user, role]).then(r => r[0].r);
const deact = (actor: string, fac: string, user: string) => rows(`select app.deactivate_member($1::uuid,$2::uuid,$3::uuid) r`, [actor, fac, user]).then(r => r[0].r);
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; message: string }; } };
const active = async (user: string, fac = F1) => (await rows(`select role::text r from public.memberships where user_id = $1 and facility_id = $2 and is_active order by 1`, [user, fac])).map(x => x.r);

beforeAll(async () => {
  db = await makeDb();
  for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`]);
  for (const [k, id] of Object.entries(U)) if (k !== 'noProfile') await db.query(`insert into public.profiles (user_id, display_name) values ($1,$2)`, [id, k]);
  await db.query(`insert into public.facilities (id, name, type) values ($1,'PHC','phc'), ($2,'DH','district_hospital')`, [F1, F2]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$5,'facility_admin'), ($2,$5,'facility_admin'), ($3,$6,'facility_admin'), ($4,$5,'nurse'), ($7,$5,'health_worker')`, [U.admin, U.admin2, U.otherAdmin, U.nurse, F1, F2, U.hw]);
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [U.plat]);
});

describe('adding and changing a role', () => {
  it('a facility administrator adds an existing person as a clinician, and it is audited without names', async () => {
    const r = await setRole(U.admin, F1, U.newbie, 'doctor');
    expect(r).toMatchObject({ role: 'doctor', previous: 'none' }); expect(await active(U.newbie)).toEqual(['doctor']);
    const a = (await rows(`select details, actor_user_id, facility_id from public.audit_events where entity_type = 'membership' order by id desc limit 1`))[0];
    expect(a).toMatchObject({ actor_user_id: U.admin, facility_id: F1 }); expect(a.details).toMatchObject({ op: 'set_role', role: 'doctor', previous: 'none' }); expect(JSON.stringify(a)).not.toMatch(/newbie@|display/);
  });
  it('changing the role turns the old one off: one active role at a facility', async () => {
    await setRole(U.admin, F1, U.hw, 'nurse'); expect(await active(U.hw)).toEqual(['nurse']);
    await setRole(U.admin, F1, U.hw, 'health_worker'); expect(await active(U.hw)).toEqual(['health_worker']);
    expect((await rows(`select count(*)::int n from public.memberships where user_id = $1 and facility_id = $2`, [U.hw, F1]))[0].n).toBe(2);       // history kept, one active
  });
  it('setting the same role again is harmless', async () => { await setRole(U.admin, F1, U.hw, 'health_worker'); expect(await active(U.hw)).toEqual(['health_worker']); });
  it('the same person can hold a role at another facility at the same time', async () => { await setRole(U.otherAdmin, F2, U.hw, 'nurse'); expect(await active(U.hw, F2)).toEqual(['nurse']); expect(await active(U.hw, F1)).toEqual(['health_worker']); });
});

describe('who may not', () => {
  it('a clinician, a stranger and an administrator of ANOTHER facility cannot', async () => {
    for (const a of [U.nurse, U.hw, randomUUID(), U.otherAdmin]) expect((await fails(setRole(a, F1, U.newbie, 'nurse')))?.code, a).toBe('42501');
    expect(await active(U.newbie)).toEqual(['doctor']);
  });
  it('a deactivated administrator can no longer manage anyone', async () => {
    const tmp = randomUUID(); await db.query(`insert into auth.users (id, email) values ($1,'tmp@t.test')`, [tmp]); await db.query(`insert into public.profiles (user_id, display_name) values ($1,'tmp')`, [tmp]);
    await db.query(`insert into public.memberships (user_id, facility_id, role, is_active) values ($1,$2,'facility_admin', false)`, [tmp, F1]);
    expect((await fails(setRole(tmp, F1, U.newbie, 'nurse')))?.code).toBe('42501');
  });
  it('a facility administrator cannot make anyone a facility administrator, or touch one', async () => {
    expect((await fails(setRole(U.admin, F1, U.newbie, 'facility_admin')))?.code).toBe('42501');
    expect((await fails(setRole(U.admin, F1, U.admin2, 'nurse')))?.code).toBe('42501'); expect((await fails(deact(U.admin, F1, U.admin2)))?.code).toBe('42501'); expect(await active(U.admin2)).toEqual(['facility_admin']);
  });
  it('nobody can change their own role or remove themselves', async () => {
    expect((await fails(setRole(U.admin, F1, U.admin, 'nurse')))?.code).toBe('42501'); expect((await fails(deact(U.admin, F1, U.admin)))?.code).toBe('42501'); expect(await active(U.admin)).toEqual(['facility_admin']);
  });
  it('someone with no account or profile yet, and a facility that does not exist, are plain "not found"', async () => {
    expect((await fails(setRole(U.admin, F1, U.noProfile, 'nurse')))?.code).toBe('P0002'); expect((await fails(setRole(U.plat, randomUUID(), U.newbie, 'nurse')))?.code).toBe('P0002');
  });
  it('an unknown role name is refused by the database', async () => { expect(await fails(setRole(U.admin, F1, U.newbie, 'superuser'))).not.toBeNull(); });
});

describe('removing someone', () => {
  it('turns off every active role there, keeps the history, and is audited', async () => {
    const r = await deact(U.admin, F1, U.newbie); expect(r).toMatchObject({ deactivated: 1, previous: 'doctor' }); expect(await active(U.newbie)).toEqual([]);
    expect((await rows(`select count(*)::int n from public.memberships where user_id = $1`, [U.newbie]))[0].n).toBe(1);
    expect((await rows(`select details from public.audit_events where entity_type = 'membership' order by id desc limit 1`))[0].details).toMatchObject({ op: 'deactivate' });
  });
  it('removing someone with no active role is "not found"; adding them back works', async () => {
    expect((await fails(deact(U.admin, F1, U.newbie)))?.code).toBe('P0002'); await setRole(U.admin, F1, U.newbie, 'nurse'); expect(await active(U.newbie)).toEqual(['nurse']);
  });
});

describe('platform administrator', () => {
  it('can make a facility administrator, change one, and remove one, so a facility is never stuck', async () => {
    await setRole(U.plat, F1, U.newbie, 'facility_admin'); expect(await active(U.newbie)).toContain('facility_admin');
    await deact(U.plat, F1, U.newbie); expect(await active(U.newbie)).toEqual([]);
  });
});

describe('the functions are not callable by ordinary users', () => {
  it('execute is revoked from anon and authenticated', async () => {
    for (const fn of ['app.set_member_role(uuid, uuid, uuid, public.app_role)', 'app.deactivate_member(uuid, uuid, uuid)']) {
      const r = await rows(`select has_function_privilege('authenticated', '${fn}', 'execute') a, has_function_privilege('anon', '${fn}', 'execute') b, has_function_privilege('service_role', '${fn}', 'execute') c`);
      expect(r[0]).toEqual({ a: false, b: false, c: true });
    }
  });
});
