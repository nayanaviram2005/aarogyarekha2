// Patient report upload. The browser never talks to storage. The API does, so every step is checked and audited.
//
//   1. caller must see the encounter and consent must be active (same gate as everything else)
//   2. the bytes are checked and cleaned in memory (src/files/safe.ts, pdf.ts). Anything refused is never stored.
//   3. a `documents` row is created as 'pending' by the CALLER (row-level security decides who may), because storage policy
//      only accepts an upload whose row already exists
//   4. the file is uploaded to the private bucket as the caller
//   5. the system marks it 'clean' with the checksum of the CLEANED bytes. Until then it cannot be read by anyone.
// Reading a file is audited before any bytes leave (fail closed). PDFs are always sent as downloads, never shown inline.
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RouteCtx, RouteHelpers } from './intake.js';
import type { DocumentKind, DocumentRow } from '../deps.js';
import { displayName, EXT, makeSafe } from '../files/safe.js';
import { inspectPdf, stripLinks } from '../files/pdf.js';
import { analyse, WARNING_TEXT } from '../files/imageQuality.js';

const uuid = z.string().uuid();
export const KINDS = ['lab_report', 'prescription', 'discharge_summary', 'imaging_report', 'vaccination_record', 'referral_letter', 'photo', 'other'] as const;
const kindSchema = z.enum(KINDS);

export const meta = (d: DocumentRow) => ({
  id: d.id, encounterId: d.encounter_id, kind: d.kind, mimeType: d.mime_type, sizeBytes: Number(d.size_bytes), filename: d.original_filename,
  status: d.scan_status, createdAt: d.created_at,
});

export function registerDocumentRoutes(c: RouteCtx, h: RouteHelpers, maxBytes: number): void {
  const { app, authenticate, fail } = c;

  app.post('/encounters/:id/documents', { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const ctx = await h.openEncounter(req, reply, true); if (!ctx) return;
    const { enc, w } = ctx;
    if (!req.isMultipart()) return fail(reply, 415, 'not-supported', 'Send the file as multipart form data.');

    let kindRaw: string | undefined; let buf: Buffer | null = null; let claimed: string | undefined; let filename: string | undefined; let truncated = false;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') { if (part.fieldname === 'kind') kindRaw = String(part.value); }
        else if (!buf) { filename = part.filename; claimed = part.mimetype; buf = await part.toBuffer(); truncated = part.file.truncated; }
        else part.file.resume();
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') truncated = true;
      else return fail(reply, 400, 'invalid', 'The upload could not be read.');
    }
    if (truncated) return fail(reply, 413, 'too-costly', `The file is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    if (!buf) return fail(reply, 400, 'invalid', 'Choose a file to upload.');
    const kind = kindSchema.safeParse(kindRaw ?? 'other');
    if (!kind.success) return fail(reply, 400, 'invalid', 'Choose what kind of document this is.');

    const safe = makeSafe(buf, claimed);
    if (!safe.ok) return fail(reply, 400, 'invalid', safe.reason);
    if (safe.mime === 'application/pdf') {
      const c = await stripLinks(safe.bytes).catch(() => null);
      if (c && c.removed > 0) { safe.bytes = c.bytes; safe.sha256 = createHash('sha256').update(c.bytes).digest('hex'); }
      const p = await inspectPdf(safe.bytes).catch(() => ({ ok: false as const, reason: 'The PDF could not be checked.' }));
      if (!p.ok) return fail(reply, 400, 'invalid', p.reason);
    }

    // Picture checks never block an upload: they tell the person to retake a poor photo.
    let quality: { warnings: { code: string; text: string }[] } | undefined;
    if (safe.mime !== 'application/pdf') { try { quality = { warnings: analyse(safe.bytes, safe.mime).warnings.map(code => ({ code, text: WARNING_TEXT[code] })) }; } catch { /* unreadable pictures are handled when read */ } }

    const id = randomUUID();
    const path = `${enc.facility_id}/${enc.patient_id}/${id}.${EXT[safe.mime]}`;
    try {
      await w.createDocument({ id, patientId: enc.patient_id, encounterId: enc.id, facilityId: enc.facility_id, kind: kind.data as DocumentKind, storagePath: path, mimeType: safe.mime, sizeBytes: safe.bytes.length, originalFilename: displayName(filename) });
    } catch (err) { return h.dbFail(req, reply, err); }

    try { await w.uploadObject(path, safe.bytes, safe.mime); }
    catch (err) {
      req.log.error({ reqId: req.id, err: (err as Error).message }, 'document upload to storage failed');
      await c.deps.failUpload(id).catch(() => {});
      return fail(reply, 502, 'transient', 'The file could not be stored. Nothing was saved. Try again.');
    }
    try { await c.deps.finishUpload({ documentId: id, sha256: safe.sha256, sizeBytes: safe.bytes.length }); }
    catch (err) {
      req.log.error({ reqId: req.id, err: (err as Error).message }, 'document could not be released');
      await c.deps.failUpload(id).catch(() => {});
      return fail(reply, 502, 'transient', 'The file was stored but could not be released. Try again.');
    }
    await h.note(req, { action: 'create', entityType: 'document', entityId: id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { kind: kind.data, mime: safe.mime, bytes: safe.bytes.length, metadataBytesRemoved: safe.strippedBytes } });
    return reply.code(201).send({ id, kind: kind.data, mimeType: safe.mime, sizeBytes: safe.bytes.length, status: 'clean', metadataBytesRemoved: safe.strippedBytes, ...(quality ? { quality } : {}) });
  });

  app.get('/encounters/:id/documents', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Encounter id must be a UUID.');
    const enc = await req.reader!.getEncounter(id.data).catch(() => undefined);
    if (enc === undefined) return fail(reply, 502, 'transient', 'The record could not be loaded. Try again.');
    if (!enc) return fail(reply, 404, 'not-found', 'No such encounter, or you do not have access.');
    const rows = await req.reader!.listDocuments(enc.id).catch(() => undefined);
    if (rows === undefined) return fail(reply, 502, 'transient', 'The documents could not be loaded. Try again.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'document_list', entityId: enc.id, patientId: enc.patient_id, facilityId: enc.facility_id, outcome: 'success', details: { count: rows.length } }))) return;
    return reply.send({ documents: rows.map(meta) });
  });

  app.get('/documents/:id/file', { preHandler: authenticate }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 400, 'invalid', 'Document id must be a UUID.');
    const d = await req.reader!.getDocument(id.data).catch(() => undefined);
    if (d === undefined) return fail(reply, 502, 'transient', 'The document could not be loaded. Try again.');
    if (!d) return fail(reply, 404, 'not-found', 'No such document, or you do not have access.');
    if (d.scan_status !== 'clean') return fail(reply, 409, 'conflict', 'This file was not accepted, so it cannot be opened.');
    if (!(await c.auditOrFail(req, reply, { action: 'read', entityType: 'document', entityId: d.id, patientId: d.patient_id, facilityId: d.facility_id, outcome: 'success', details: { kind: d.kind } }))) return;
    let bytes: Buffer;
    try { bytes = await h.writerFor(req).downloadObject(d.storage_path); }
    catch (err) { req.log.error({ reqId: req.id, err: (err as Error).message }, 'document download failed'); return fail(reply, 502, 'transient', 'The file could not be opened. Try again.'); }
    const pdf = d.mime_type === 'application/pdf';
    return reply
      .header('content-disposition', `${pdf ? 'attachment' : 'inline'}; filename="document-${d.id.slice(0, 8)}.${EXT[d.mime_type as keyof typeof EXT]}"`)
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('x-content-type-options', 'nosniff')
      .type(d.mime_type).send(bytes);
  });
}
