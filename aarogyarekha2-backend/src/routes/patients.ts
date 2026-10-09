import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { possibleDuplicates } from '../intake/duplicates.js';

const place = z.string().trim().min(1).max(80);
const body = z.object({
  fullName: z.string().trim().min(1).max(120).regex(/^[\p{L}\p{M}\p{N} .\-']+$/u, 'Use letters, numbers, spaces, dots, hyphens or apostrophes.'),
  sex: z.enum(['female', 'male', 'other', 'unknown']),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !Number.isNaN(Date.parse(d)) && Date.parse(d) <= Date.now() && Date.parse(d) > Date.parse('1890-01-01'), 'Birth date must be a real date in the past.').optional(),
  ageYears: z.number().int().min(0).max(130).optional(),
  preferredLanguage: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/).default('en'),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 -]{7,14}$/, 'Phone number looks wrong.').transform(s => s.replace(/[ -]/g, '')).optional(),
  villageTown: place.optional(), district: place.optional(), state: place.optional(),
  pincode: z.string().regex(/^\d{6}$/, 'PIN code is 6 digits.').optional(),
  facilityId: z.string().uuid().optional(),
  confirmNotDuplicate: z.boolean().optional(),
}).strict().refine(b => b.birthDate !== undefined || b.ageYears !== undefined, { message: 'Give a birth date or an age.', path: ['ageYears'] });

export function registerPatientRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, authenticate, fail } = c;

  app.post('/patients', { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return h.invalid(reply, parsed.error);
    const b = parsed.data;

    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) return fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.');
    const facilities = [...new Set(me.memberships.filter(m => ['health_worker', 'nurse', 'doctor', 'medical_officer'].includes(m.role)).map(m => m.facilityId))];
    const facilityId = b.facilityId ?? (facilities.length === 1 ? facilities[0] : undefined);
    if (!facilityId) return fail(reply, 400, 'invalid', facilities.length === 0 ? 'Only clinical staff at a facility can register patients.' : 'Choose which facility the patient is registered at.');
    if (!facilities.includes(facilityId)) return fail(reply, 403, 'forbidden', 'You are not allowed to register patients at that facility.');

    if (!b.confirmNotDuplicate) {
      const found = await req.reader!.listPatients(b.fullName.split(' ')[0]!.replace(/[^\p{L}\p{M}\p{N}.-]/gu, '') || undefined, 50).catch(() => undefined);
      if (found === undefined) return fail(reply, 502, 'transient', 'Existing patients could not be checked. Try again.');
      const dup = possibleDuplicates(found, { fullName: b.fullName, sex: b.sex, birthDate: b.birthDate, ageYears: b.ageYears });
      if (dup.length > 0) {
        await h.note(req, { action: 'read', entityType: 'patient_duplicate_check', outcome: 'success', facilityId, details: { matches: dup.length } });
        return reply.code(409).type('application/fhir+json; charset=utf-8').send({
          resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'duplicate', details: { text: 'Someone with the same name and age is already registered. Check the list, or confirm this is a different person.' } }],
          possibleDuplicates: dup.map(p => ({ id: p.id, publicRef: p.public_ref, fullName: p.full_name, sex: p.sex, birthDate: p.birth_date, ageYears: p.age_years_reported })),
        });
      }
    }

    try {
      const r = await h.writerFor(req).registerPatient({ facilityId, fullName: b.fullName, sex: b.sex, birthDate: b.birthDate, ageYears: b.ageYears, preferredLanguage: b.preferredLanguage, phone: b.phone, villageTown: b.villageTown, district: b.district, state: b.state, pincode: b.pincode });
      await h.note(req, { action: 'create', entityType: 'patient', entityId: r.id, patientId: r.id, facilityId, outcome: 'success' });
      return reply.code(201).send({ id: r.id, publicRef: r.publicRef });
    } catch (err) { return h.dbFail(req, reply, err); }
  });
}
