// Database side of "People and roles". System path: the route has checked the caller; the database functions (migration 0016)
// check again, so a bug or a bypass here still cannot give anyone a role they should not have.
import { MemberError, type MemberAdmin } from '../deps.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
const map = (e: unknown): never => {
  const x = e as { code?: string; message?: string };
  if (x.code === '42501') throw new MemberError('forbidden', x.message ?? 'not allowed');
  if (x.code === 'P0002') throw new MemberError('not_found', x.message ?? 'not found');
  if (x.code === '22023' || x.code === '22P02') throw new MemberError('invalid', 'That role is not valid.');
  throw e;
};

export function makeMemberAdmin(db: Queryable): MemberAdmin {
  return {
    async list(facilityIds) {
      if (facilityIds.length === 0) return [];
      const r = await db.query(
        `select distinct on (m.facility_id, m.user_id) m.user_id, m.facility_id, m.role::text role, m.is_active, m.created_at, p.display_name, u.email
           from public.memberships m left join public.profiles p on p.user_id = m.user_id left join auth.users u on u.id = m.user_id
          where m.facility_id = any($1::uuid[])
          order by m.facility_id, m.user_id, m.is_active desc, m.created_at desc`, [facilityIds]);
      return r.rows.map(x => ({ userId: x.user_id, facilityId: x.facility_id, role: x.role, active: x.is_active === true, since: new Date(x.created_at).toISOString(), name: x.display_name ?? null, email: x.email ?? null }))
        .sort((a, b) => Number(b.active) - Number(a.active) || (a.name ?? '').localeCompare(b.name ?? ''));
    },
    async findByEmail(email) {
      const r = await db.query(`select u.id from auth.users u join public.profiles p on p.user_id = u.id where lower(u.email) = lower($1) limit 1`, [email.trim()]);
      return r.rows[0] ? { id: r.rows[0].id as string } : null;
    },
    async setRole(a) {
      try { const r = await db.query(`select app.set_member_role($1::uuid,$2::uuid,$3::uuid,$4::public.app_role) r`, [a.actor, a.facilityId, a.userId, a.role]); return { role: r.rows[0].r.role, previous: r.rows[0].r.previous }; }
      catch (e) { return map(e); }
    },
    async deactivate(a) {
      try { const r = await db.query(`select app.deactivate_member($1::uuid,$2::uuid,$3::uuid) r`, [a.actor, a.facilityId, a.userId]); return { previous: r.rows[0].r.previous }; }
      catch (e) { return map(e); }
    },
    async changes(facilityIds, limit) {
      if (facilityIds.length === 0) return [];
      const r = await db.query(
        `select e.occurred_at, e.facility_id, e.details, ap.display_name actor_name, tp.display_name target_name
           from public.audit_events e left join public.profiles ap on ap.user_id = e.actor_user_id left join public.profiles tp on tp.user_id = nullif(e.details ->> 'target', '')::uuid
          where e.entity_type = 'membership' and e.facility_id = any($1::uuid[]) and e.details ? 'op'
          order by e.id desc limit $2`, [facilityIds, limit]);
      return r.rows.map(x => ({ at: new Date(x.occurred_at).toISOString(), facilityId: x.facility_id, op: x.details.op as string, role: (x.details.role as string | undefined) ?? null, previous: (x.details.previous as string | undefined) ?? null, actor: x.actor_name ?? null, target: x.target_name ?? null }));
    },
  };
}
