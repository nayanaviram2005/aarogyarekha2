import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { renderNotePdf } from '../referral/pdf.js';
import { handoverContent, pickLang } from '../handover/summary.js';
import { ageSexText } from '../handover/age.js';
import { loadRecordContext } from './records.js';

const query = z.object({ lang: z.enum(['en', 'hi', 'or']).optional() }).strict();

export function registerHandoverRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, authenticate, fail } = c;

  app.get('/encounters/:id/handover.pdf', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = query.safeParse(req.query); if (!q.success) return fail(reply, 400, 'invalid', 'The language must be en, hi or or.');
    const ctx = await h.openEncounter(req, reply, false); if (!ctx) return;
    const { enc } = ctx;
    const s = await req.reader!.getEncounterSummary(enc.id).catch(() => undefined);
    if (s === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!s) return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
    const records = await loadRecordContext(req, enc.id).catch(() => []);
    const facility = await req.reader!.getFacility(enc.facility_id).catch(() => null);
    const lang = pickLang(q.data.lang, enc.language, s.patient.preferred_language);
    const now = new Date();
    const a = s.assessment;
    const rv = a ? s.reviews.filter(r => r.assessment_id === a.id && (r.action === 'approve' || r.action === 'override_urgency')).sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))[0] : undefined;
    const content = handoverContent({
      patient: { fullName: s.patient.full_name, publicRef: s.patient.public_ref, sex: s.patient.sex, ageText: ageSexText(s.patient, now) },
      facilityName: facility?.name ?? null,
      encounter: { language: enc.language, complaintOriginal: enc.chief_complaint_original, complaintTranslated: enc.chief_complaint_translated },
      assessment: a ? { urgencyCode: a.urgency_code, reasons: a.signals.map(x => x.display_text).filter((x): x is string => !!x), openQuestions: s.followUps.filter(f => f.status === 'open').length } : null,
      review: rv ? { reviewerName: rv.reviewer_name, at: rv.created_at, fromCode: rv.from_urgency_code, toCode: rv.to_urgency_code, reason: rv.reason } : null,
      vitals: s.vitals.map(v => ({ kind: v.kind, value: v.value, unit: v.unit, at: v.measured_at })),
      records, now,
    }, lang);
    if (!(await c.auditOrFail(req, reply, { action: 'export', entityType: 'handover_summary', entityId: enc.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { format: 'pdf', lang, signedOff: !!rv } }))) return;
    try {
      const pdf = await renderNotePdf(content, { docTitle: 'Handover summary', checksum: null });
      return reply.header('content-disposition', `attachment; filename="handover-${enc.id.slice(0, 8)}.pdf"`).header('content-security-policy', "sandbox; default-src 'none'").type('application/pdf').send(pdf);
    } catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'handover pdf failed'); return fail(reply, 500, 'exception', 'The summary could not be made. Try again.'); }
  });
}
