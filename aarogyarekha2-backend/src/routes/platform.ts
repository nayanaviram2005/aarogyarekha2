import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { MemberError, PlatformError } from '../deps.js';

const uuid = z.string().uuid();
export const FACILITY_TYPES = ['sub_centre', 'phc', 'chc', 'district_hospital', 'medical_college', 'company_clinic', 'industrial_unit', 'campus_health_centre', 'health_camp', 'other'] as const;
const text = (max: number) => z.string().trim().max(max).optional().transform(v => (v ? v : undefined));
const createBody = z.object({
  name: z.string().trim().min(2).max(120), type: z.enum(FACILITY_TYPES), state: text(80), district: text(80),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'The pincode is six digits.').optional().or(z.literal('').transform(() => undefined)), code: text(40),
}).strict();
const activeBody = z.object({ active: z.boolean() }).strict();
const appointBody = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict();

export function registerPlatformRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;
  const off = 'Facility management is not set up. It needs migration 0020.';

  async function platformOnly(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    if (!deps.platformAdmin) { fail(reply, 503, 'not-supported', off); return false; }
    const ok = await deps.platformAdmin.isPlatform(req.user!.userId).catch(() => undefined);
    if (ok === undefined) { fail(reply, 502, 'transient', 'Your access could not be checked. Try again.'); return false; }
    if (!ok) { fail(reply, 403, 'forbidden', 'Platform administrator access is needed for this screen.'); return false; }
    return true;
  }
  const refuse = (reply: FastifyReply, err: unknown) => {
    if (err instanceof PlatformError) {
      if (err.kind === 'forbidden') return fail(reply, 403, 'forbidden', 'Only a platform administrator can do that.');
      if (err.kind === 'not_found') return fail(reply, 404, 'not-found', 'No such facility.');
      return fail(reply, 400, 'invalid', err.message);
    }
    if (err instanceof MemberError) {
      if (err.kind === 'forbidden') return fail(reply, 403, 'forbidden', 'Only a platform administrator can do that.');
      if (err.kind === 'not_found') return fail(reply, 404, 'not-found', /no account/i.test(err.message) ? 'That person has no profile yet. Ask them to sign in once, then appoint them.' : /facility/i.test(err.message) ? 'No such facility.' : 'That person is not an administrator of this facility.');
      return fail(reply, 400, 'invalid', err.message);
    }
    return null;
  };

  app.get('/platform/facilities', { preHandler: authenticate }, async (req, reply) => {
    if (!(await platformOnly(req, reply))) return;
    const rows = await deps.platformAdmin!.facilities().catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The list could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'platform_facilities', outcome: 'success', details: { count: rows.length } }))) return;
    return reply.send({ facilities: rows });
  });

  app.post('/platform/facilities', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!(await platformOnly(req, reply))) return;
    const b = createBody.safeParse(req.body); if (!b.success) return h.invalid(reply, b.error);
    if (!(await c.requireMfa(req, reply, 'manage_facilities'))) return;
    try { const r = await deps.platformAdmin!.create({ actor: req.user!.userId, ...b.data }); return reply.code(201).send({ id: r.id }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });

  app.post('/platform/facilities/:id/active', { preHandler: authenticate }, async (req, reply) => {
    if (!(await platformOnly(req, reply))) return;
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Id must be a UUID.');
    const b = activeBody.safeParse(req.body); if (!b.success) return h.invalid(reply, b.error);
    if (!(await c.requireMfa(req, reply, 'manage_facilities'))) return;
    try { await deps.platformAdmin!.setActive({ actor: req.user!.userId, facilityId: id.data, active: b.data.active }); return reply.send({ id: id.data, active: b.data.active }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });

  app.post('/platform/facilities/:id/admins', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!(await platformOnly(req, reply))) return;
    if (!deps.memberAdmin) return fail(reply, 503, 'not-supported', 'People and roles is not set up. It needs migration 0016.');
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Id must be a UUID.');
    const b = appointBody.safeParse(req.body); if (!b.success) return h.invalid(reply, b.error);
    if (!(await c.requireMfa(req, reply, 'manage_facilities'))) return;
    const found = await deps.memberAdmin.findByEmail(b.data.email).catch(() => undefined);
    if (found === undefined) return fail(reply, 502, 'transient', 'The account could not be looked up. Try again.');
    if (!found) return fail(reply, 404, 'not-found', 'There is no account with that email, or the person has not signed in yet. Ask them to sign in once, then appoint them.');
    try { const r = await deps.memberAdmin.setRole({ actor: req.user!.userId, facilityId: id.data, userId: found.id, role: 'facility_admin' }); return reply.code(201).send({ userId: found.id, role: r.role }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });

  app.post('/platform/facilities/:id/admins/:userId/remove', { preHandler: authenticate }, async (req, reply) => {
    if (!(await platformOnly(req, reply))) return;
    if (!deps.memberAdmin) return fail(reply, 503, 'not-supported', 'People and roles is not set up. It needs migration 0016.');
    const p = req.params as { id: string; userId: string };
    const id = uuid.safeParse(p.id), uid = uuid.safeParse(p.userId); if (!id.success || !uid.success) return fail(reply, 400, 'invalid', 'Id must be a UUID.');
    if (!(await c.requireMfa(req, reply, 'manage_facilities'))) return;
    try { await deps.memberAdmin.deactivate({ actor: req.user!.userId, facilityId: id.data, userId: uid.data }); return reply.send({ userId: uid.data, removed: true }); }
    catch (err) { return refuse(reply, err) ?? h.dbFail(req, reply, err); }
  });
}
