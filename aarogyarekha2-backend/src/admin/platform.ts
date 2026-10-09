import { PlatformError, type PlatformAdmin } from '../deps.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
const map = (e: unknown): never => {
  const x = e as { code?: string; message?: string };
  if (x.code === '42501') throw new PlatformError('forbidden', x.message ?? 'not allowed');
  if (x.code === 'P0002') throw new PlatformError('not_found', x.message ?? 'not found');
  if (x.code === '23505') throw new PlatformError('invalid', 'That facility code is already used by another facility.');
  if (x.code === '22023' || x.code === '22P02' || x.code === '23514') throw new PlatformError('invalid', 'Check the facility type and the pincode (six digits).');
  throw e;
};

export function makePlatformAdmin(db: Queryable): PlatformAdmin {
  return {
    async isPlatform(userId) {
      const r = await db.query(`select 1 from public.platform_admins where user_id = $1::uuid`, [userId]);
      return r.rows.length > 0;
    },
    async facilities() {
      const r = await db.query(
        `select f.id, f.name, f.type::text type, f.state, f.district, f.code, f.is_active,
                (select count(*)::int from public.memberships m where m.facility_id = f.id and m.is_active and m.role <> 'facility_admin') staff,
                coalesce((select json_agg(json_build_object('userId', m.user_id, 'name', p.display_name, 'email', u.email) order by p.display_name)
                           from public.memberships m left join public.profiles p on p.user_id = m.user_id left join auth.users u on u.id = m.user_id
                          where m.facility_id = f.id and m.is_active and m.role = 'facility_admin'), '[]'::json) admins
           from public.facilities f order by f.is_active desc, f.name`);
      return r.rows.map(x => ({ id: x.id, name: x.name, type: x.type, state: x.state ?? null, district: x.district ?? null, code: x.code ?? null, active: x.is_active === true, staff: x.staff, admins: x.admins }));
    },
    async create(a) {
      try { const r = await db.query(`select app.platform_create_facility($1::uuid,$2,$3,$4,$5,$6,$7) r`, [a.actor, a.name, a.type, a.state ?? null, a.district ?? null, a.pincode ?? null, a.code ?? null]); return { id: r.rows[0].r.id as string }; }
      catch (e) { return map(e); }
    },
    async setActive(a) {
      try { await db.query(`select app.platform_set_facility_active($1::uuid,$2::uuid,$3::boolean)`, [a.actor, a.facilityId, a.active]); }
      catch (e) { return map(e); }
    },
  };
}
