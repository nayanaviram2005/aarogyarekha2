import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makePlatformAdmin } from '../src/admin/platform.js';
import { PlatformError } from '../src/deps.js';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const U = { plat: randomUUID(), fadmin: randomUUID(), nurse: randomUUID(), candidate: randomUUID() };
const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; kind?: string; message: string }; } };
let admin: ReturnType<typeof makePlatformAdmin>;

beforeAll(async () => {
  db = await makeDb();
  admin = makePlatformAdmin({ query: (sql, p) => db.query(sql, p as any[]) as never });
  for (const [k, id] of Object.entries(U)) { await db.query(`insert into auth.users (id, email) values ($1,$2)`, [id, `${k}@t.test`]); await db.query(`insert into public.profiles (user_id, display_name) values ($1,$2)`, [id, k]); }
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [U.plat]);
});

describe('creating and switching facilities', () => {
  it('a platform administrator creates a facility, and it is audited without anything but the type', async () => {
    const r = await admin.create({ actor: U.plat, name: '  Khordha PHC ', type: 'phc', state: 'Odisha', district: 'Khordha', pincode: '752055', code: 'HFR-1' });
    const f = (await q(`select name, type::text t, state, pincode, code, is_active from public.facilities where id = $1`, [r.id]))[0];
    expect(f).toMatchObject({ name: 'Khordha PHC', t: 'phc', state: 'Odisha', pincode: '752055', code: 'HFR-1', is_active: true });
    const a = (await q(`select details, actor_user_id, facility_id from public.audit_events where entity_type = 'facility' order by id desc limit 1`))[0];
    expect(a).toMatchObject({ actor_user_id: U.plat, facility_id: r.id }); expect(a.details).toEqual({ op: 'create_facility', type: 'phc' });
  });
  it('nobody else can create or switch a facility, not even a facility administrator', async () => {
    const e = await fails(admin.create({ actor: U.nurse, name: 'X', type: 'phc' })); expect(e).toBeInstanceOf(PlatformError); expect(e!.kind).toBe('forbidden');
    const [{ id }] = await q(`select id from public.facilities limit 1`);
    expect((await fails(admin.setActive({ actor: U.nurse, facilityId: id, active: false })))!.kind).toBe('forbidden');
    expect((await q(`select count(*)::int n from public.facilities where name = 'X'`))[0].n).toBe(0);
  });
  it('refuses a bad type, a bad pincode and a code already used, in plain terms', async () => {
    expect((await fails(admin.create({ actor: U.plat, name: 'Bad', type: 'hospital' })))!.kind).toBe('invalid');
    expect((await fails(admin.create({ actor: U.plat, name: 'Bad', type: 'phc', pincode: '12' })))!.kind).toBe('invalid');
    expect((await fails(admin.create({ actor: U.plat, name: 'Dup', type: 'phc', code: 'HFR-1' })))!.kind).toBe('invalid');
  });
  it('switches a facility off and on, and says so when it does not exist', async () => {
    const r = await admin.create({ actor: U.plat, name: 'Camp A', type: 'health_camp' });
    await admin.setActive({ actor: U.plat, facilityId: r.id, active: false });
    expect((await q(`select is_active from public.facilities where id = $1`, [r.id]))[0].is_active).toBe(false);
    await admin.setActive({ actor: U.plat, facilityId: r.id, active: true });
    expect((await q(`select is_active from public.facilities where id = $1`, [r.id]))[0].is_active).toBe(true);
    expect((await fails(admin.setActive({ actor: U.plat, facilityId: randomUUID(), active: false })))!.kind).toBe('not_found');
  });
});

describe('who is a platform administrator and what the list shows', () => {
  it('knows who is one', async () => { expect(await admin.isPlatform(U.plat)).toBe(true); expect(await admin.isPlatform(U.nurse)).toBe(false); });
  it('lists facilities with their active administrators and a staff count that leaves the administrators out', async () => {
    const r = await admin.create({ actor: U.plat, name: 'Listed DH', type: 'district_hospital' });
    await q(`select app.set_member_role($1::uuid,$2::uuid,$3::uuid,'facility_admin')`, [U.plat, r.id, U.fadmin]);
    await q(`select app.set_member_role($1::uuid,$2::uuid,$3::uuid,'nurse')`, [U.plat, r.id, U.nurse]);
    const f = (await admin.facilities()).find(x => x.id === r.id)!;
    expect(f).toMatchObject({ name: 'Listed DH', type: 'district_hospital', active: true, staff: 1 });
    expect(f.admins).toEqual([{ userId: U.fadmin, name: 'fadmin', email: 'fadmin@t.test' }]);
  });
  it('a removed administrator drops off the list', async () => {
    const f0 = (await admin.facilities()).find(x => x.name === 'Listed DH')!;
    await q(`select app.deactivate_member($1::uuid,$2::uuid,$3::uuid)`, [U.plat, f0.id, U.fadmin]);
    expect((await admin.facilities()).find(x => x.id === f0.id)!.admins).toEqual([]);
  });
});

describe('the functions are closed to everyone but the service role', () => {
  it.each(['platform_create_facility(uuid, text, text, text, text, text, text)', 'platform_set_facility_active(uuid, uuid, boolean)'])('%s', async sig => {
    const r = await q(`select has_function_privilege('authenticated', 'app.${sig}', 'execute') a, has_function_privilege('anon', 'app.${sig}', 'execute') b`);
    expect(r[0]).toEqual({ a: false, b: false });
  });
});
