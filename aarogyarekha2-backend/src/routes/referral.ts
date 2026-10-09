import { renderReferralPdf } from '../referral/pdf.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import type { ConsentBrief, ReferralRow } from '../deps.js';
import { buildReferralBundle, PRIORITY_FOR_URGENCY, unresolvedReferences, type ReferralBuildInput, type UrgencyCode } from '../fhir/referral.js';
import { canonicalJson, ENGINE_VERSION } from '../triage/engine.js';
import { isConsentActive } from '../intake/consent.js';
import { SendError, SEND_TEXT, type SendFailure } from '../referral/send.js';

const uuid = z.string().uuid();
const PRIORITIES = ['routine', 'urgent', 'asap', 'stat'] as const;
const OPEN = new Set(['draft', 'requested', 'accepted', 'in_progress']);
const FHIR = 'application/fhir+json; charset=utf-8';

const createBody = z.object({ toFacilityId: uuid, priority: z.enum(PRIORITIES).optional(), reasonText: z.string().trim().min(10, 'Write the reason for referral in at least 10 characters.').max(2000) }).strict();
const updateBody = z.object({ toFacilityId: uuid.optional(), priority: z.enum(PRIORITIES).optional(), reasonText: z.string().trim().min(10).max(2000).optional() }).strict()
  .refine(b => Object.keys(b).length > 0, { message: 'Nothing to change.' });
const cancelBody = z.object({ reason: z.string().trim().max(300).optional() }).strict();

const STATUS: Record<SendFailure, number> = { not_found: 404, forbidden: 403, needs_consent: 409, needs_review: 409, wrong_state: 409, stale: 409, invalid: 400 };
const CODE = { not_found: 'not-found', forbidden: 'forbidden', needs_consent: 'conflict', needs_review: 'conflict', wrong_state: 'conflict', stale: 'conflict', invalid: 'invalid' } as const;

const meta = (r: Omit<ReferralRow, 'bundle'>, toName?: string | null) => ({
  id: r.id, encounterId: r.encounter_id, patientId: r.patient_id, status: r.status, priority: r.priority, reasonText: r.reason_text,
  toFacility: r.to_facility_id ? { id: r.to_facility_id, name: toName ?? null } : null, sentAt: r.sent_at, createdAt: r.created_at, bundleSha256: r.bundle_sha256,
});

export function registerReferralRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  const activeConsents = (rows: ConsentBrief[], purposes: string[]) =>
    purposes.flatMap(p => {
      const live = rows.filter(r => r.purpose === p && isConsentActive([r]));
      const latest = live.sort((a, b) => Date.parse(b.granted_at) - Date.parse(a.granted_at))[0];
      return latest ? [{ purpose: p, granted_at: latest.granted_at }] : [];
    });

  async function assemble(req: Parameters<typeof authenticate>[0], ref: Omit<ReferralRow, 'bundle'>, final: boolean) {
    const r = req.reader!;
    const [summary, patient, identifiers, from, to, consents] = await Promise.all([
      r.getEncounterSummary(ref.encounter_id), r.getPatient(ref.patient_id), r.getIdentifiers(ref.patient_id),
      r.getFacility(ref.from_facility_id), ref.to_facility_id ? r.getFacility(ref.to_facility_id) : Promise.resolve(null), r.getConsents(ref.patient_id),
    ]);
    if (!summary || !patient || !from) return null;
    const a = summary.assessment;
    const reviewsOfCurrent = a ? summary.reviews.filter(x => x.assessment_id === a.id && (x.action === 'approve' || x.action === 'override_urgency')) : [];
    const rv = reviewsOfCurrent[reviewsOfCurrent.length - 1] ?? null;
    const names = await r.getNames([ref.requested_by, ...(rv ? [rv.reviewer_id] : [])]);
    const active = activeConsents(consents, ['care_triage', 'referral_sharing']);
    const input: ReferralBuildInput = {
      referralId: ref.id, now: new Date(), final,
      patient, identifiers, encounter: summary.encounter,
      from: { id: from.id, name: from.name, type: from.type, state: from.state, district: from.district },
      to: to ? { id: to.id, name: to.name, type: to.type, state: to.state, district: to.district } : { id: ref.to_facility_id ?? ref.from_facility_id, name: 'Receiving facility not chosen', type: null, state: null, district: null },
      requester: { id: ref.requested_by, name: names[ref.requested_by] ?? null },
      priority: ref.priority, reasonText: ref.reason_text ?? '',
      symptoms: summary.symptoms, vitals: summary.vitals, signs: summary.triageContext.signs ?? {},
      assessment: a ? { id: a.id, version: a.version, urgency_code: a.urgency_code as UrgencyCode, note: a.note as never } : null,
      effectiveUrgency: ((summary.queue?.urgency_code ?? a?.urgency_code ?? 'green') as UrgencyCode),
      review: rv ? { reviewer: { id: rv.reviewer_id, name: names[rv.reviewer_id] ?? rv.reviewer_name }, at: rv.created_at, action: rv.action as 'approve' | 'override_urgency', reason: rv.reason } : null,
      consents: active, engineVersion: ENGINE_VERSION,
    };
    return {
      summary, patient, input, toName: to?.name ?? null, bundle: buildReferralBundle(input),
      signedOff: !!rv, sharingConsent: active.some(x => x.purpose === 'referral_sharing'), assessmentId: a?.id ?? null,
    };
  }

  async function openReferral(req: Parameters<typeof authenticate>[0], reply: Parameters<typeof fail>[0]) {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) { fail(reply, 400, 'invalid', 'Referral id must be a UUID.'); return null; }
    const ref = await req.reader!.getReferral(id.data).catch(() => undefined);
    if (ref === undefined) { fail(reply, 502, 'transient', 'The record could not be loaded. Try again.'); return null; }
    if (!ref) { fail(reply, 404, 'not-found', 'No such referral, or you do not have access.'); return null; }
    return ref;
  }

  async function consentOk(req: Parameters<typeof authenticate>[0], reply: Parameters<typeof fail>[0], patientId: string) {
    const ok = await h.writerFor(req).hasActiveConsent(patientId, 'care_triage').catch(() => undefined);
    if (ok === undefined) { fail(reply, 502, 'transient', 'Consent could not be checked. Try again.'); return false; }
    if (!ok) { fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record consent first.'); return false; }
    return true;
  }

  app.get('/facilities', { preHandler: authenticate }, async (req, reply) => {
    const rows = await req.reader!.listFacilities().catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The facility list could not be loaded. Try again.');
    return reply.send({ facilities: rows });
  });

  app.post('/encounters/:id/referrals', { preHandler: authenticate }, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return h.invalid(reply, body.error);
    const ctx = await h.openEncounter(req, reply, true); if (!ctx) return;
    const { enc } = ctx;
    if (body.data.toFacilityId === enc.facility_id) return fail(reply, 400, 'invalid', 'Choose a different facility from your own.');

    const summary = await req.reader!.getEncounterSummary(enc.id).catch(() => undefined);
    if (!summary) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    const a = summary.assessment;
    const signedOff = !!a && summary.reviews.some(x => x.assessment_id === a.id && (x.action === 'approve' || x.action === 'override_urgency'));
    if (!signedOff) return fail(reply, 409, 'conflict', SEND_TEXT.needs_review);

    const existing = await req.reader!.listReferrals(enc.id).catch(() => undefined);
    if (existing === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (existing.some(r => OPEN.has(r.status))) return fail(reply, 409, 'conflict', 'A referral is already open for this encounter.');

    const to = await req.reader!.getFacility(body.data.toFacilityId).catch(() => undefined);
    if (to === undefined) return fail(reply, 502, 'transient', 'The facility could not be checked. Try again.');
    if (!to) return fail(reply, 404, 'not-found', 'No such facility.');

    const urgency = (summary.queue?.urgency_code ?? a!.urgency_code) as UrgencyCode;
    try {
      const r = await ctx.w.createReferral({ encounterId: enc.id, patientId: enc.patient_id, fromFacilityId: enc.facility_id, toFacilityId: to.id, priority: body.data.priority ?? PRIORITY_FOR_URGENCY[urgency], reasonText: body.data.reasonText });
      await h.note(req, { action: 'create', entityType: 'referral', entityId: r.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { toFacilityId: to.id, priority: r.priority } });
      return reply.code(201).send(meta(r, to.name));
    } catch (err) {
      if ((err as { code?: string }).code === '42501') return fail(reply, 403, 'forbidden', 'Only a nurse, doctor or medical officer can prepare a referral.');
      return h.dbFail(req, reply, err);
    }
  });

  app.get('/encounters/:id/referrals', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Encounter id must be a UUID.');
    const enc = await req.reader!.getEncounter(id.data).catch(() => undefined);
    if (enc === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!enc) return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
    const rows = await req.reader!.listReferrals(enc.id).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'referral_list', entityId: enc.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { count: rows.length } }))) return;
    const names = new Map<string, string | null>();
    await Promise.all([...new Set(rows.map(r => r.to_facility_id).filter((x): x is string => !!x))].map(async fid => { names.set(fid, (await req.reader!.getFacility(fid).catch(() => null))?.name ?? null); }));
    return reply.send({ referrals: rows.map(r => meta(r, r.to_facility_id ? names.get(r.to_facility_id) : null)) });
  });

  app.get('/referrals/:id', { preHandler: authenticate }, async (req, reply) => {
    const ref = await openReferral(req, reply); if (!ref) return;
    const sent = ref.status !== 'draft' && ref.status !== 'cancelled' && !!ref.bundle;
    const built = await assemble(req, ref, false).catch(() => undefined);
    if (built === undefined) return fail(reply, 502, 'transient', 'The referral could not be loaded. Try again.');
    if (!built) return fail(reply, 404, 'not-found', 'No such referral, or you do not have access.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'success' }))) return;
    return reply.send({
      referral: meta(ref, built.toName), preview: !sent,
      bundle: sent ? ref.bundle : built.bundle,
      readiness: { signedOff: built.signedOff, sharingConsent: built.sharingConsent, hasReceiver: !!ref.to_facility_id, hasReason: (ref.reason_text ?? '').trim().length >= 10 },
    });
  });

  app.put('/referrals/:id', { preHandler: authenticate }, async (req, reply) => {
    const body = updateBody.safeParse(req.body);
    if (!body.success) return h.invalid(reply, body.error);
    const ref = await openReferral(req, reply); if (!ref) return;
    if (ref.status !== 'draft') return fail(reply, 409, 'conflict', 'This referral has been sent and can no longer be edited.');
    if (!(await consentOk(req, reply, ref.patient_id))) return;
    if (body.data.toFacilityId && body.data.toFacilityId === ref.from_facility_id) return fail(reply, 400, 'invalid', 'Choose a different facility from your own.');
    try {
      await h.writerFor(req).updateReferralDraft(ref.id, body.data);
      await h.note(req, { action: 'update', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'success', details: { fields: Object.keys(body.data) } });
      return reply.send({ ok: true });
    } catch (err) { return h.dbFail(req, reply, err); }
  });

  app.post('/referrals/:id/cancel', { preHandler: authenticate }, async (req, reply) => {
    const body = cancelBody.safeParse(req.body ?? {});
    if (!body.success) return h.invalid(reply, body.error);
    const ref = await openReferral(req, reply); if (!ref) return;
    if (ref.status !== 'draft') return fail(reply, 409, 'conflict', 'Only a draft referral can be cancelled here.');
    try {
      await h.writerFor(req).cancelReferral(ref.id, body.data.reason ?? null);
      await h.note(req, { action: 'update', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'success', details: { status: 'cancelled' } });
      return reply.send({ ok: true });
    } catch (err) { return h.dbFail(req, reply, err); }
  });

  app.post('/referrals/:id/send', { preHandler: authenticate }, async (req, reply) => {
    if (!(await c.requireMfa(req, reply, 'send_referral'))) return;
    const ref = await openReferral(req, reply); if (!ref) return;
    if (ref.status !== 'draft') return fail(reply, 409, 'conflict', 'This referral has already been sent or closed.');
    if (!(await consentOk(req, reply, ref.patient_id))) return;
    const built = await assemble(req, ref, true).catch(() => undefined);
    if (built === undefined) return fail(reply, 502, 'transient', 'The referral could not be prepared. Try again.');
    if (!built || !built.assessmentId) return fail(reply, 409, 'conflict', SEND_TEXT.needs_review);

    const dangling = unresolvedReferences(built.bundle);
    if (dangling.length) {
      req.log.error({ reqId: req.id, count: dangling.length }, 'referral document has unresolved references; not sent');
      return fail(reply, 500, 'exception', 'The referral document could not be built correctly, so nothing was sent. The incident was logged.');
    }
    const sha256 = createHash('sha256').update(canonicalJson(built.bundle)).digest('hex');

    if (!(await c.auditOrFail(req, reply, { action: 'share', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'success', details: { phase: 'attempt', toFacilityId: ref.to_facility_id, bundleSha256: sha256 } }))) return;

    try {
      const r = await deps.sendReferral({ senderId: req.user!.userId, referralId: ref.id, assessmentId: built.assessmentId, bundle: built.bundle, sha256 });
      await h.note(req, { action: 'share', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'success', details: { phase: 'sent', toFacilityId: r.toFacilityId, bundleSha256: r.sha256 } });
      return reply.send({ id: r.referralId, status: r.status, sentAt: r.sentAt, bundleSha256: r.sha256 });
    } catch (err) {
      if (err instanceof SendError) {
        await h.note(req, { action: 'share', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'denied', details: { phase: 'refused', kind: err.kind } });
        return fail(reply, STATUS[err.kind], CODE[err.kind], err.message);
      }
      req.log.error({ reqId: req.id, err: (err as Error).message }, 'referral send failed');
      await h.note(req, { action: 'share', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'error', details: { phase: 'failed' } });
      return fail(reply, 502, 'transient', 'The referral could not be sent. Nothing was shared. Try again.');
    }
  });

  app.get('/referrals/:id/bundle', { preHandler: authenticate }, async (req, reply) => {
    const ref = await openReferral(req, reply); if (!ref) return;
    if (!ref.bundle || ref.status === 'draft' || ref.status === 'cancelled') return fail(reply, 409, 'conflict', 'This referral has not been sent yet. Preview it instead.');
    if (!(await c.auditOrFail(req, reply, { action: 'export', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'success', details: { bundleSha256: ref.bundle_sha256 } }))) return;
    return reply.header('content-disposition', `attachment; filename="referral-${ref.id.slice(0, 8)}.json"`).type(FHIR).send(ref.bundle);
  });

  app.get('/referrals/:id/pdf', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ref = await openReferral(req, reply); if (!ref) return;
    if (!ref.bundle || ref.status === 'draft' || ref.status === 'cancelled') return fail(reply, 409, 'conflict', 'This referral has not been sent yet. Preview it instead.');
    if (!(await c.auditOrFail(req, reply, { action: 'export', entityType: 'referral', entityId: ref.id, patientId: ref.patient_id, facilityId: ref.from_facility_id, outcome: 'success', details: { bundleSha256: ref.bundle_sha256, format: 'pdf' } }))) return;
    const facs = await req.reader!.listFacilities().catch(() => []);
    const nameOf = (id: string | null) => (id ? facs.find(f => f.id === id)?.name ?? null : null);
    try {
      const pdf = await renderReferralPdf(ref.bundle, { sha256: ref.bundle_sha256, fromFacility: nameOf(ref.from_facility_id), toFacility: nameOf(ref.to_facility_id), priority: ref.priority, sentAt: ref.sent_at });
      return reply.header('content-disposition', `attachment; filename="referral-${ref.id.slice(0, 8)}.pdf"`).header('content-security-policy', "sandbox; default-src 'none'").type('application/pdf').send(pdf);
    } catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'referral pdf failed'); return fail(reply, 500, 'exception', 'The PDF could not be made. Download the FHIR file instead.'); }
  });
}
