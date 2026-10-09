// Reading a stored report: run the local reader, parse rows, let a person verify each row.
//  * The file is downloaded as the CALLER (only clean files are readable), read locally, and the rows are stored by the system
//    (users cannot write extraction tables). Raw OCR text is stored but never returned to the browser.
//  * Rows are TRANSCRIPTIONS. printed_flag is what the report printed. Nothing here says a value is abnormal or what it means.
//  * Verifying a row records who confirmed it and when. An unverified row is never used for anything downstream.
import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { OcrUnavailable } from '../ocr/engines.js';
import { parseLabText } from '../ocr/labParser.js';
import { crossCheck } from '../ocr/crossCheck.js';
import { secondRead } from './visionRead.js';
import type { ExtractionView } from '../deps.js';

const uuid = z.string().uuid();
/** What to tell the person when the AI image reader could not read a photo. */
const PHOTO_PROBLEM: Record<string, string> = {
  no_consent: 'Reading a photo uses an outside AI service and needs the patient’s separate consent. Record that consent, or upload the report as a PDF.',
  not_set_up: 'Reading photos is not set up on this server. Upload the report as a PDF instead.',
  unsupported_type: 'This kind of photo cannot be read. Use a JPEG or PNG, or upload a PDF.',
  too_large: 'The photo is too large to send for reading (over 8 MB). Retake it smaller, or upload a PDF.',
  unavailable: 'The outside reading service is busy. Try again in a moment.',
};
const runBody = z.object({ language: z.enum(['en', 'hi', 'or']).optional() }).strict();
const verifyBody = z.object({
  valueText: z.string().trim().min(1).max(200).nullable().optional(),
  valueNum: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
}).strict().refine(b => (b.valueText != null && b.valueText !== '') || b.valueNum != null, { message: 'Give the value as text or as a number.' });

export const fieldView = (f: ExtractionView['fields'][number]) => ({
  secondRead: f.second_read ?? null, agreement: f.agreement ?? null,
  id: f.id, name: f.field_name, printedLine: f.extracted_value_text, valueText: f.value_text, valueNum: f.value_num === null ? null : Number(f.value_num), unit: f.unit,
  referenceRange: f.reference_range_text, printedFlag: f.printed_flag, confidence: f.confidence === null ? null : Number(f.confidence),
  verified: !!f.verified_at, verifiedAt: f.verified_at,
});
const view = (e: ExtractionView) => ({
  id: e.id, documentId: e.document_id, engine: e.engine, status: e.status, language: e.language, averageConfidence: e.avg_confidence === null ? null : Number(e.avg_confidence),
  error: e.error, createdAt: e.created_at, fields: e.fields.map(fieldView),
});

export function registerExtractionRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  async function openDoc(req: Parameters<typeof authenticate>[0], reply: Parameters<typeof fail>[0], idParam = 'id') {
    const id = uuid.safeParse((req.params as Record<string, string>)[idParam]);
    if (!id.success) { fail(reply, 400, 'invalid', 'Document id must be a UUID.'); return null; }
    const d = await req.reader!.getDocument(id.data).catch(() => undefined);
    if (d === undefined) { fail(reply, 502, 'transient', 'The document could not be loaded. Try again.'); return null; }
    if (!d) { fail(reply, 404, 'not-found', 'No such document, or you do not have access.'); return null; }
    const consent = await h.writerFor(req).hasActiveConsent(d.patient_id, 'care_triage').catch(() => undefined);
    if (consent === undefined) { fail(reply, 502, 'transient', 'Consent could not be checked. Try again.'); return null; }
    if (!consent) { fail(reply, 403, 'forbidden', 'No active consent for triage is recorded for this patient. Record consent first.'); return null; }
    return d;
  }

  app.post('/documents/:id/extract', { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = runBody.safeParse(req.body ?? {});
    if (!body.success) return h.invalid(reply, body.error);
    const d = await openDoc(req, reply); if (!d) return;
    if (d.scan_status !== 'clean') return fail(reply, 409, 'conflict', 'This file was not accepted, so it cannot be read.');

    let bytes: Buffer;
    try { bytes = await h.writerFor(req).downloadObject(d.storage_path); }
    catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'document download for extraction failed'); return fail(reply, 502, 'transient', 'The file could not be opened. Try again.'); }

    const work = async (): Promise<{ failure: string | null; secondRead: { status: string; counts: Record<string, number> | null } }> => {
      type Read = Awaited<ReturnType<typeof deps.readText>>;
      const local = async (): Promise<{ result: Read | null; failure: string | null }> => {
        try { return { result: await deps.readText({ bytes, mime: d.mime_type, language: body.data.language }), failure: null }; }
        catch (err) {
          if (!(err instanceof OcrUnavailable)) req.log.error({ reqId: req.id, err: (err as Error).message }, 'ocr failed');
          return { result: null, failure: err instanceof OcrUnavailable ? err.message : 'The report could not be read.' };
        }
      };
      // Photos can be read by the outside AI image reader first (OCR_PHOTOS=ai), so a small server never runs the heavy local reader.
      const aiPrimary = d.mime_type !== 'application/pdf' && c.ocrPhotos !== 'local';
      let { result, failure } = aiPrimary ? { result: null as Read | null, failure: null as string | null } : await local();
      // The AI reader (needs the patient's separate consent). Both reads are kept when both ran; a person verifies every row either way.
      const sr = await secondRead(deps, req, d, bytes);
      const aiRead = sr.status === 'ok' && sr.rows.length > 0;
      if (aiPrimary && !aiRead && c.ocrPhotos === 'ai_then_local') ({ result, failure } = await local());
      const parsed = result ? parseLabText(result.text, result.confidence) : { fields: [], skipped: 0 };
      let fields = parsed.fields; let counts: Record<string, number> | null = null; let engine = result?.engine ?? 'none';
      if (aiRead) {
        const m = crossCheck(parsed.fields, sr.rows); fields = m.fields; counts = m.counts; engine = result ? `${engine}+${sr.provider}` : `${sr.provider}`;
        if (fields.length > 0) failure = null;                                   // the AI read rows the local reader could not
      }
      if (aiPrimary && !result && !aiRead && sr.status !== 'ok') failure = PHOTO_PROBLEM[sr.status] ?? 'The photo could not be read.';
      const avg = fields.length ? Math.round((fields.reduce((s, f) => s + (f.confidence ?? 0), 0) / fields.length) * 1000) / 1000 : null;
      if (fields.length === 0 && (result || failure === null)) failure = 'No test results were found in this document. If it is a photo, try a clearer, straighter picture.';
      await deps.saveExtraction({
        documentId: d.id, engine, engineVersion: result?.engineVersion ?? null, language: result?.language ?? body.data.language ?? null,
        avgConfidence: avg, status: failure ? 'failed' : 'completed', error: failure, rawText: result?.text ?? null, fields: failure ? [] : fields,
      });
      await h.note(req, { action: 'create', entityType: 'extraction', entityId: d.id, patientId: d.patient_id, facilityId: d.facility_id, outcome: failure ? 'error' : 'success', details: { engine, fields: failure ? 0 : fields.length, skippedLines: parsed.skipped, secondRead: sr.status, ...(counts ? { agreement: counts } : {}) } });
      return { failure, secondRead: { status: sr.status, counts } };
    };

    // ?async=1: answer at once and let the screen check back (GET /jobs/:id). The same checks have already run above.
    if ((req.query as { async?: string } | undefined)?.async === '1') {
      const jobId = c.jobs.submit(req.user!.userId, 'extract', async () => { const r = await work(); return { documentId: d.id, failure: r.failure }; });
      if (!jobId) return fail(reply, 429, 'throttled', 'Too many reports are waiting to be read. Wait a minute and try again.');
      return reply.code(202).send({ jobId, status: 'queued' });
    }

    let failure: string | null; let second: Awaited<ReturnType<typeof work>>['secondRead'];
    try { const r = await work(); failure = r.failure; second = r.secondRead; }
    catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'extraction could not be saved'); return fail(reply, 502, 'transient', 'The result could not be saved. Try again.'); }
    const saved = await req.reader!.getExtraction(d.id).catch(() => null);
    if (failure) return reply.code(422).send({ error: failure, extraction: saved ? view(saved) : null, secondRead: second });
    return reply.code(201).send({ extraction: saved ? view(saved) : null, secondRead: second });
  });

  app.get('/jobs/:id', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id); if (!id.success) return fail(reply, 400, 'invalid', 'Job id must be a UUID.');
    const j = c.jobs.get(id.data, req.user!.userId);
    if (!j) return fail(reply, 404, 'not-found', 'No such job. It may have finished long ago, or the server restarted. Start it again.');
    const r = j.result as { documentId?: string; failure?: string | null } | undefined;
    return reply.send({ jobId: j.id, kind: j.kind, status: j.status, documentId: r?.documentId ?? null, error: j.status === 'failed' ? j.error ?? null : r?.failure ?? null });
  });

  app.get('/documents/:id/extraction', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Document id must be a UUID.');
    const d = await req.reader!.getDocument(id.data).catch(() => undefined);
    if (d === undefined) return fail(reply, 502, 'transient', 'The document could not be loaded. Try again.');
    if (!d) return fail(reply, 404, 'not-found', 'No such document, or you do not have access.');
    const e = await req.reader!.getExtraction(d.id).catch(() => undefined);
    if (e === undefined) return fail(reply, 502, 'transient', 'The result could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'extraction', entityId: d.id, patientId: d.patient_id, facilityId: d.facility_id, outcome: 'success', details: { fields: e?.fields.length ?? 0 } }))) return;
    return reply.send({ extraction: e ? view(e) : null });
  });

  app.put('/documents/:id/fields/:fieldId', { preHandler: authenticate }, async (req, reply) => {
    const fid = uuid.safeParse((req.params as { fieldId: string }).fieldId);
    if (!fid.success) return fail(reply, 400, 'invalid', 'Field id must be a UUID.');
    const body = verifyBody.safeParse(req.body);
    if (!body.success) return h.invalid(reply, body.error);
    const d = await openDoc(req, reply); if (!d) return;
    const e = await req.reader!.getExtraction(d.id).catch(() => undefined);
    if (e === undefined) return fail(reply, 502, 'transient', 'The result could not be loaded. Try again.');
    if (!e || !e.fields.some(f => f.id === fid.data)) return fail(reply, 404, 'not-found', 'No such row in this document.');
    try {
      const n = body.data.valueNum ?? null;
      await h.writerFor(req).verifyField(fid.data, { valueText: body.data.valueText ?? (n !== null ? String(n) : null), valueNum: n, unit: body.data.unit ?? null });
      await h.note(req, { action: 'update', entityType: 'extracted_field', entityId: fid.data, patientId: d.patient_id, facilityId: d.facility_id, outcome: 'success', details: { verified: true } });
      return reply.send({ ok: true });
    } catch (err) {
      if ((err as { code?: string }).code === '42501') return fail(reply, 403, 'forbidden', 'You are not allowed to confirm results at this facility.');
      return h.dbFail(req, reply, err);
    }
  });
}
