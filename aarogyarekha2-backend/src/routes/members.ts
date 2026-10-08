// People and roles for a facility administrator: see who works here, add an existing account, change a role, remove someone.
//  * a facility administrator can give clinical roles only. Making or changing a facility administrator is for a platform
//    administrator, and nobody can change their own role (the database functions enforce all of it again),
//  * every change needs a verified second factor when the deployment requires it, and is audited with ids and the role name,
//  * adding is by email of an EXISTING account. This service cannot create sign-in accounts; the person signs up first.
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { MemberError } from '../deps.js';

const uuid = z.string().uuid();
export const ROLES = ['health_worker', 'nurse', 'doctor', 'medical_officer'] as const;
const addBody = z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(ROLES), facilityId: uuid.optional() }).strict();
const roleBody = z.object({ role: z.enum(ROLES), facilityId: uuid.optional() }).strict();
const facBody = z.object({ facilityId: uuid.optional() }).strict();

export function registerMemberRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  async function adminFacilities(req: FastifyRequest, reply: FastifyReply): Promise<string[] | null> {
    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) { fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.'); return null; }
    const ids = [...new Set(me.memberships.filter(m => m.role === 'facility_admin').map(m => m.facilityId))];
    if (ids.length === 0) { fail(reply, 403, 'forbidden', 'Administrator access is needed for this screen.'); return null; }
    return ids;
  }
  /** The facility this change is for: the one named, or the only one the caller administers. Null after sending the refusal. */
  function pick(reply: FastifyReply, fac: string[], named?: string): string | null {
    const id = named ?? (fac.length === 1 ? fac[0] : undefined);
    if (!id) { fail(reply, 400, 'invalid', 'Choose which facility this is for.'); return null; }
    if (!fac.includes(id)) { fail(reply, 403, 'forbidden', 'You are not an administrator of that facility.'); return null; }
    return id;
  }
  const refuse = (reply: FastifyReply, err: unknown) => {
    if (err instanceof MemberError) {
      if (err.kind === 'forbidden') return fail(reply, 403, 'forbidden', /administrator/i.test(err.message) ? 'Only a platform administrator can create, change or remove a facility administrator.' : /own role|yourself/i.test(err.message) ? 'You cannot change your own role or remove yourself.' : 'You are not allowed to do that.');
      if (err.kind === 'not_found') return fail(reply, 404, 'not-found', /no account/i.test(err.message) ? 'That person has no profile yet. Ask them to sign in once, then add them.' : 'No such person here, or they have no active role to remove.');
      return fail(reply, 400, 'invalid', err.message);
    }
    return null;
  };

  app.get('/admin/members', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.memberAdmin) return fail(reply, 503, 'not-supported', 'People and roles is not set up. It needs migration 0016.');
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const rows = await deps.memberAdmin.list(fac).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The list could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'admin_members', outcome: 'success', details: { count: rows.length } }))) return;
    return reply.send({ members: rows.map(m => ({ ...m, isSelf: m.userId === req.user!.userId, canChange: m.role !== 'facility_admin' && m.userId !== req.user!.userId })) });
  });

  app.get('/admin/members/changes', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.memberAdmin) return fail(reply, 503, 'not-supported', 'People and roles is not set up. It needs migration 0016.');
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const rows = await deps.memberAdmin.changes(fac, 50).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The list could not be loaded. Try again.');
    return reply.send({ changes: rows });
  });

  app.post('/admin/members', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!deps.memberAdmin) return fail(reply, 503, 'not-supported', 'People and roles is not set up. It needs migration 0016.');
    const b = addBody.safeParse(req.body); if (!b.success) return h.invalid(reply, b.error);
    if (!(await c.requireMfa(req, reply, 'manage_members'))) return;
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const facilityId = pick(reply, fac, b.data.facilityId); if (!facilityId) return;
    const found = await deps.memberAdmin.findByEmail(b.data.email).catch(() => undefined);
    if (found === undefined) return fail(reply, 502, 'transient', 'The account could not be looked up. Try again.');
    if (!found) { await h.note(req, { action: 'update', entityType: 'membership', facilityId, outcome: 'denied', details: { op: 'lookup', found: false } }); return fail(reply, 404, 'not-found', 'There is no account with that email, or the person has not signed in yet. Ask them to sign in once, then add them.'); }
    try {
      const r = await deps.memberAdmin.setRole({ actor: req.user!.userId, facilityId, userId: found.id, role: b.data.role });
      return reply.code(201).send({ userId: found.id, role: r.role, previous: r.previous });
    } catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });

  app.post('/admin/members/:userId/role', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.memberAdmin) return fail(reply, 503, 'not-supported', 'People and roles is not set up. It needs migration 0016.');
    const uid = uuid.safeParse((req.params as { userId: string }).userId); if (!uid.success) return fail(reply, 400, 'invalid', 'Id must be a UUID.');
    const b = roleBody.safeParse(req.body); if (!b.success) return h.invalid(reply, b.error);
    if (!(await c.requireMfa(req, reply, 'manage_members'))) return;
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const facilityId = pick(reply, fac, b.data.facilityId); if (!facilityId) return;
    try { const r = await deps.memberAdmin.setRole({ actor: req.user!.userId, facilityId, userId: uid.data, role: b.data.role }); return reply.send({ userId: uid.data, role: r.role, previous: r.previous }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });

  app.post('/admin/members/:userId/deactivate', { preHandler: authenticate }, async (req, reply) => {
    if (!deps.memberAdmin) return fail(reply, 503, 'not-supported', 'People and roles is not set up. It needs migration 0016.');
    const uid = uuid.safeParse((req.params as { userId: string }).userId); if (!uid.success) return fail(reply, 400, 'invalid', 'Id must be a UUID.');
    const b = facBody.safeParse(req.body ?? {}); if (!b.success) return h.invalid(reply, b.error);
    if (!(await c.requireMfa(req, reply, 'manage_members'))) return;
    const fac = await adminFacilities(req, reply); if (!fac) return;
    const facilityId = pick(reply, fac, b.data.facilityId); if (!facilityId) return;
    try { const r = await deps.memberAdmin.deactivate({ actor: req.user!.userId, facilityId, userId: uid.data }); return reply.send({ userId: uid.data, removed: true, previous: r.previous }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });
}
