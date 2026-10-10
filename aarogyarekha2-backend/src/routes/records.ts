import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import { makeSafe } from '../files/safe.js';
import { inspectPdf, stripLinks } from '../files/pdf.js';
import { OcrUnavailable } from '../ocr/engines.js';
import { AiError } from '../ai/provider.js';
import { MAX_VISION_BYTES, type VisionMime } from '../ai/vision.js';
import { parseIdentity } from '../ocr/identity.js';
import { parseLabText } from '../ocr/labParser.js';
import { summariseRecords, type ContextDoc } from '../ocr/recordContext.js';

const CLINICAL = ['health_worker', 'nurse', 'doctor', 'medical_officer'];
const lang = z.enum(['en', 'hi', 'or']);

export async function loadRecordContext(req: FastifyRequest, encounterId: string): Promise<ContextDoc[]> {
  const docs = await req.reader!.listDocuments(encounterId);
  const out: ContextDoc[] = [];
  for (const d of docs.filter(x => x.scan_status === 'clean')) {
    const e = await req.reader!.getExtraction(d.id).catch(() => null);
    out.push({
      id: d.id, kind: d.kind, filename: d.original_filename ?? null, createdAt: d.created_at, status: e ? e.status : 'none',
      fields: (e?.fields ?? []).map(f => ({ name: f.field_name, valueText: f.value_text ?? (f.value_num === null || f.value_num === undefined ? f.extracted_value_text : null), valueNum: f.value_num === null ? null : Number(f.value_num), unit: f.unit, printedFlag: f.printed_flag, verified: !!f.verified_at, agreement: f.agreement ?? null, confidence: f.confidence === null || f.confidence === undefined ? null : Number(f.confidence) })),
    });
  }
  return out;
}

export function registerRecordRoutes(c: RouteCtx, h: RouteHelpers): void {
  const { app, deps, authenticate, fail } = c;

  app.post('/intake/records/read', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const me = await req.reader!.getMe().catch(() => undefined);
    if (me === undefined) return fail(reply, 502, 'transient', 'Your profile could not be loaded. Try again.');
    if (!me.memberships.some(m => CLINICAL.includes(m.role))) return fail(reply, 403, 'forbidden', 'Only clinical staff at a facility can register patients from records.');
    if (!req.isMultipart()) return fail(reply, 415, 'not-supported', 'Send the file as multipart form data.');

    let buf: Buffer | null = null; let claimed: string | undefined; let language: 'en' | 'hi' | 'or' | undefined; let truncated = false; let aiConsent = false;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') { if (part.fieldname === 'language') { const l = lang.safeParse(String(part.value)); if (l.success) language = l.data; } else if (part.fieldname === 'aiConsent') aiConsent = String(part.value) === 'yes'; }
        else if (!buf) { claimed = part.mimetype; buf = await part.toBuffer(); truncated = part.file.truncated; }
        else part.file.resume();
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') truncated = true;
      else return fail(reply, 400, 'invalid', 'The upload could not be read.');
    }
    if (truncated) return fail(reply, 413, 'too-costly', 'The file is too large.');
    if (!buf) return fail(reply, 400, 'invalid', 'Choose a file to read.');
    const safe = makeSafe(buf, claimed);
    if (!safe.ok) return fail(reply, 400, 'invalid', safe.reason);
    if (safe.mime === 'application/pdf') {
      const c = await stripLinks(safe.bytes).catch(() => null); if (c) safe.bytes = c.bytes;
      const p = await inspectPdf(safe.bytes).catch(() => ({ ok: false as const, reason: 'The PDF could not be checked.' }));
      if (!p.ok) return fail(reply, 400, 'invalid', p.reason);
    }

    const v = deps.vision;
    const aiAvailable = !!v && v.supported && v.name !== 'mock' && v.accepts(safe.mime) && safe.mime !== 'application/pdf' && c.ocrPhotos !== 'local';
    if (safe.mime !== 'application/pdf' && c.ocrPhotos === 'ai' && !aiAvailable) {
      return reply.send({ identity: {}, rows: 0, readable: false, note: 'Photos are read by the outside AI reader, and it is not set up on this server. Use a PDF, or ask an administrator to set it up.', averageConfidence: null });
    }
    if (aiAvailable && !aiConsent && c.ocrPhotos === 'ai') {
      return reply.send({ identity: {}, rows: 0, readable: false, needsAiConsent: true, note: 'Reading a photo uses an outside AI service, and names and numbers on a photo cannot be removed first. Confirm the patient agrees, then read it.', averageConfidence: null });
    }
    if (aiAvailable && aiConsent && v) {
      if (safe.bytes.length > MAX_VISION_BYTES) return reply.send({ identity: {}, rows: 0, readable: false, note: 'The photo is too large to send for reading (over 8 MB). Retake it smaller, or use a PDF.', averageConfidence: null });
      try {
        const read = await v.read({ bytes: safe.bytes, mime: safe.mime as VisionMime, identity: true });
        await h.note(req, { action: 'read', entityType: 'record_preview_ai', outcome: 'success', details: { provider: read.provider, model: read.model, bytes: safe.bytes.length, foundName: !!read.identity?.fullName, rows: read.rows.length } });
        return reply.send({ identity: read.identity ?? {}, rows: read.rows.length, readable: true, note: null, averageConfidence: null, readBy: 'ai' });
      } catch (err) {
        await h.note(req, { action: 'read', entityType: 'record_preview_ai', outcome: 'error', details: { kind: err instanceof AiError ? err.kind : 'unknown', bytes: safe.bytes.length } });
        if (c.ocrPhotos === 'ai') return reply.send({ identity: {}, rows: 0, readable: false, note: err instanceof AiError && err.kind === 'busy' ? 'The outside reading service is busy. Try again in a moment.' : 'The outside reading service could not read this photo. Try again, or use a PDF.', averageConfidence: null });
      }
    }

    let text = ''; let confidence: number | null = null; let note: string | null = null;
    try { const r = await deps.readText({ bytes: safe.bytes, mime: safe.mime, language }); text = r.text; confidence = r.confidence; }
    catch (err) { note = err instanceof OcrUnavailable ? err.message : 'The record could not be read.'; if (!(err instanceof OcrUnavailable)) req.log.error({ reqId: req.id, err: (err as Error).message }, 'record read failed'); }

    const identity = parseIdentity(text);
    const rows = text ? parseLabText(text, confidence).fields.length : 0;
    await h.note(req, { action: 'read', entityType: 'record_preview', outcome: note ? 'error' : 'success', details: { mime: safe.mime, bytes: safe.bytes.length, foundName: !!identity.fullName, foundAge: identity.ageYears !== undefined || !!identity.birthDate, rows } });
    return reply.send({ identity, rows, readable: !note, note, averageConfidence: confidence });
  });

  app.get('/encounters/:id/record-context', { preHandler: authenticate }, async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Encounter id must be a UUID.');
    const enc = await req.reader!.getEncounter(id.data).catch(() => undefined);
    if (enc === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!enc) return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
    let docs: ContextDoc[];
    try { docs = await loadRecordContext(req, enc.id); } catch { return fail(reply, 502, 'transient', 'The records could not be loaded. Try again.'); }
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'record_context', entityId: enc.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { documents: docs.length } }))) return;
    return reply.send({ summary: summariseRecords(docs), documents: docs.map(d => ({ id: d.id, kind: d.kind, filename: d.filename, createdAt: d.createdAt, status: d.status, rows: d.fields })) });
  });
}
