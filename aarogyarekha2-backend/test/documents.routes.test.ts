import { PNG } from 'pngjs';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DbError, type AuditEvent, type Deps, type DocumentRow, type NewDocument, type UserReader, type UserWriter } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const patient = { id: P, registered_facility_id: F, full_name: 'Test Patient' } as unknown as PatientRow;
const enc: EncounterRow = { id: E, patient_id: P, facility_id: F, status: 'in_review', scenario: 'opd_queue', language: 'en', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z' };

const seg = (marker: number, payload: Buffer) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([h, payload]); };
const jpegWithGps = () => Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xe1, Buffer.from('Exif\0\0GPS-SECRET-LAT')),
  seg(0xc0, Buffer.from([8, 0, 80, 0, 100, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])), seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])), Buffer.from('SCAN'), Buffer.from([0xff, 0xd9])]);
const goodPdf = async () => { const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); d.addPage().drawText('Haemoglobin 9.1 g/dL', { font: f, size: 12 }); return Buffer.from(await d.save()); };
const jsPdf = async () => { const d = await PDFDocument.create(); d.addPage(); d.catalog.set(PDFName.of('OpenAction'), d.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') })); return Buffer.from(await d.save({ useObjectStreams: true })); };

function form(fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) {
  const B = '----testboundary7MA4YWxkTrZu0gW';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) parts.push(Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from('\r\n')]));
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${B}` } };
}

interface World {
  consent: boolean; created: NewDocument[]; uploaded: { path: string; bytes: Buffer; mime: string }[]; finished: { documentId: string; sha256: string; sizeBytes: number }[]; failed: string[];
  audits: AuditEvent[]; auditFails: boolean; uploadFails: boolean; finishFails: boolean; createFail?: DbError; docs: DocumentRow[]; stored: Map<string, Buffer>; downloadFails: boolean;
}
let w: World;
const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', patient_id: P, encounter_id: E, facility_id: F, kind: 'lab_report', storage_path: 'p/a/b.png', mime_type: 'image/png', size_bytes: 10, original_filename: 'x.png', scan_status: 'clean', uploaded_by: 'u', created_at: '2026-10-06T10:00:00Z', ...over });

const make = async (maxMb = 1) => {
  const reader = (t: string): UserReader => {
    const sees = t === 'clinician';
    return {
      getPatient: async () => (sees ? patient : null), getIdentifiers: async () => [], getEncounter: async id => (sees && id === E ? enc : null), getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
      getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [],
      getConsents: async () => [], getNames: async () => ({}),
      listDocuments: async () => (sees ? w.docs : []), getDocument: async id => (sees ? w.docs.find(d => d.id === id) ?? null : null), getExtraction: async () => null,
    };
  };
  const impl: Partial<UserWriter> = {
    hasActiveConsent: async () => w.consent,
    createDocument: async d => { if (w.createFail) throw w.createFail; w.created.push(d); return doc({ id: d.id, storage_path: d.storagePath, scan_status: 'pending' }); },
    uploadObject: async (path, bytes, mime) => { if (w.uploadFails) throw new Error('storage down at secret-host'); w.uploaded.push({ path, bytes, mime }); },
    downloadObject: async path => { if (w.downloadFails) throw new Error('boom'); return w.stored.get(path) ?? Buffer.from('FILEBYTES'); },
  };
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null), userReader: reader, userWriter: () => impl as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async a => { if (w.finishFails) throw new Error('db down'); w.finished.push(a); }, failUpload: async id => { w.failed.push(id); }, saveExtraction: async () => ({ extractionId: 'x' }),
    audit: async e => { if (w.auditFails) throw new Error('audit down'); w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [], uploadMaxMb: maxMb }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const upload = (app: App, f: ReturnType<typeof form>, token: string | null = 'clinician', id = E) =>
  app.inject({ method: 'POST', url: `/encounters/${id}/documents`, payload: f.payload, headers: { ...f.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
const get = (app: App, url: string, token: string | null = 'clinician') => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => { w = { consent: true, created: [], uploaded: [], finished: [], failed: [], audits: [], auditFails: false, uploadFails: false, finishFails: false, docs: [], stored: new Map(), downloadFails: false }; });

describe('a good upload', () => {
  it('cleans the file, stores it, and only then releases it', async () => {
    const r = await upload(await make(), form({ kind: 'photo' }, { name: 'IMG_0001.jpg', type: 'image/jpeg', data: jpegWithGps() }));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: 'photo', mimeType: 'image/jpeg', status: 'clean' });
    expect(r.json().metadataBytesRemoved).toBeGreaterThan(0);
    const up = w.uploaded[0]!;
    expect(up.bytes.toString('latin1')).not.toContain('GPS-SECRET');
    expect(up.mime).toBe('image/jpeg');
    expect(up.path).toMatch(new RegExp(`^${F}/${P}/[0-9a-f-]{36}\\.jpg$`));
    expect(w.created[0]).toMatchObject({ patientId: P, encounterId: E, facilityId: F, kind: 'photo', mimeType: 'image/jpeg', sizeBytes: up.bytes.length, originalFilename: 'IMG_0001.jpg' });
    expect(w.finished[0]).toMatchObject({ sizeBytes: up.bytes.length, sha256: createHash('sha256').update(up.bytes).digest('hex') });
    expect(w.created[0]!.id).toBe(w.finished[0]!.documentId);
  });
  it('accepts a clean PDF', async () => {
    const r = await upload(await make(), form({ kind: 'lab_report' }, { name: 'cbc.pdf', type: 'application/pdf', data: await goodPdf() }));
    expect(r.statusCode).toBe(201);
    expect(w.uploaded[0]!.mime).toBe('application/pdf');
  });
  it('audits the upload with ids and sizes only', async () => {
    await upload(await make(), form({ kind: 'photo' }, { name: 'Test Patient report.jpg', type: 'image/jpeg', data: jpegWithGps() }));
    expect(w.audits[0]).toMatchObject({ action: 'create', entityType: 'document', patientId: P, facilityId: F, outcome: 'success' });
    expect(JSON.stringify(w.audits)).not.toMatch(/Test Patient|GPS/);
  });
  it('never trusts the file name for the storage path', async () => {
    await upload(await make(), form({ kind: 'other' }, { name: '../../../etc/passwd.jpg', type: 'image/jpeg', data: jpegWithGps() }));
    expect(w.uploaded[0]!.path).not.toContain('passwd');
    expect(w.created[0]!.originalFilename).toBe('passwd.jpg');
  });
  it('defaults the kind to "other" when none is given', async () => {
    await upload(await make(), form({}, { name: 'a.jpg', type: 'image/jpeg', data: jpegWithGps() }));
    expect(w.created[0]!.kind).toBe('other');
  });
});

describe('files that are refused, and nothing is stored', () => {
  const refused = (r: { statusCode: number }, code = 400) => { expect(r.statusCode).toBe(code); expect(w.created).toHaveLength(0); expect(w.uploaded).toHaveLength(0); expect(w.finished).toHaveLength(0); };
  it('a text file renamed to .pdf', async () => refused(await upload(await make(), form({}, { name: 'x.pdf', type: 'application/pdf', data: Buffer.from('just text') }))));
  it('an executable', async () => refused(await upload(await make(), form({}, { name: 'x.jpg', type: 'image/jpeg', data: Buffer.from('MZ\x90\x00 program') }))));
  it('a file whose declared type disagrees with its contents', async () => refused(await upload(await make(), form({}, { name: 'x.pdf', type: 'application/pdf', data: jpegWithGps() }))));
  it('a PDF with a script, even one hidden in compressed streams', async () => {
    const r = await upload(await make(), form({}, { name: 'x.pdf', type: 'application/pdf', data: await jsPdf() }));
    refused(r); expect(r.json().issue[0].details.text).toMatch(/active content/);
  });
  it('an empty file', async () => refused(await upload(await make(), form({}, { name: 'x.pdf', type: 'application/pdf', data: Buffer.alloc(0) }))));
  it('no file at all', async () => refused(await upload(await make(), form({ kind: 'photo' }))));
  it('an unknown document kind', async () => refused(await upload(await make(), form({ kind: 'secrets' }, { name: 'a.jpg', type: 'image/jpeg', data: jpegWithGps() }))));
  it('a file over the size limit (413)', async () => refused(await upload(await make(1), form({}, { name: 'big.pdf', type: 'application/pdf', data: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024 + 10)]) })), 413));
  it('a request that is not multipart (415)', async () => {
    const r = await (await make()).inject({ method: 'POST', url: `/encounters/${E}/documents`, payload: { a: 1 }, headers: { authorization: 'Bearer clinician' } });
    refused(r, 415);
  });
  it('does not echo anything from the file in the error', async () => {
    const r = await upload(await make(), form({}, { name: 'SECRET-NAME.pdf', type: 'application/pdf', data: Buffer.from('SECRET-CONTENT') }));
    expect(r.body).not.toMatch(/SECRET/);
  });
});

describe('access', () => {
  it('401 without a login, 404 for an encounter the caller cannot see, 403 without consent', async () => {
    const app = await make(); const f = () => form({}, { name: 'a.jpg', type: 'image/jpeg', data: jpegWithGps() });
    expect((await upload(app, f(), null)).statusCode).toBe(401);
    expect((await upload(app, f(), 'outsider')).statusCode).toBe(404);
    w.consent = false;
    expect((await upload(app, f())).statusCode).toBe(403);
    expect(w.created).toHaveLength(0);
  });
  it('a row-level-security refusal on the document row is a plain 403 and nothing is uploaded', async () => {
    w.createFail = new DbError('42501', 'new row violates row-level security policy for table "documents"');
    const r = await upload(await make(), form({}, { name: 'a.jpg', type: 'image/jpeg', data: jpegWithGps() }));
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain('documents"');
    expect(w.uploaded).toHaveLength(0);
  });
});

describe('failures after the file is accepted', () => {
  it('a storage failure marks the row failed, releases nothing, and leaks no internals', async () => {
    w.uploadFails = true;
    const r = await upload(await make(), form({}, { name: 'a.jpg', type: 'image/jpeg', data: jpegWithGps() }));
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('secret-host');
    expect(w.failed).toEqual([w.created[0]!.id]);
    expect(w.finished).toHaveLength(0);
  });
  it('failing to release marks the row failed too, so a half-stored file is never readable', async () => {
    w.finishFails = true;
    const r = await upload(await make(), form({}, { name: 'a.jpg', type: 'image/jpeg', data: jpegWithGps() }));
    expect(r.statusCode).toBe(502);
    expect(w.failed).toEqual([w.created[0]!.id]);
  });
});

describe('listing and reading', () => {
  it('lists documents with status, audited, and hides them from outsiders', async () => {
    w.docs = [doc()];
    const app = await make();
    const r = await get(app, `/encounters/${E}/documents`);
    expect(r.json().documents).toMatchObject([{ kind: 'lab_report', status: 'clean', mimeType: 'image/png' }]);
    expect(w.audits[0]).toMatchObject({ action: 'read', entityType: 'document_list', details: { count: 1 } });
    expect((await get(app, `/encounters/${E}/documents`, 'outsider')).statusCode).toBe(404);
  });
  it('returns an image inline with locked-down headers, audited before the bytes leave', async () => {
    w.docs = [doc()]; w.stored.set('p/a/b.png', Buffer.from('PNGBYTES'));
    const r = await get(await make(), `/documents/${doc().id}/file`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('PNGBYTES');
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['content-disposition']).toMatch(/^inline;/);
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(w.audits[0]).toMatchObject({ action: 'read', entityType: 'document', entityId: doc().id, patientId: P, outcome: 'success' });
  });
  it('a PDF is always a download, never shown inline', async () => {
    w.docs = [doc({ mime_type: 'application/pdf', storage_path: 'p/a/b.pdf' })];
    const r = await get(await make(), `/documents/${doc().id}/file`);
    expect(r.headers['content-disposition']).toMatch(/^attachment;/);
  });
  it('a file that was not accepted cannot be opened', async () => {
    w.docs = [doc({ scan_status: 'pending' })];
    const r = await get(await make(), `/documents/${doc().id}/file`);
    expect(r.statusCode).toBe(409);
    expect(w.audits).toHaveLength(0);
  });
  it('404 for outsiders, nothing returned when the read cannot be audited, plain 502 if storage fails', async () => {
    w.docs = [doc()];
    const app = await make();
    expect((await get(app, `/documents/${doc().id}/file`, 'outsider')).statusCode).toBe(404);
    w.auditFails = true;
    const blocked = await get(app, `/documents/${doc().id}/file`);
    expect(blocked.statusCode).toBe(503); expect(blocked.body).not.toContain('FILEBYTES');
    w.auditFails = false; w.downloadFails = true;
    const down = await get(app, `/documents/${doc().id}/file`);
    expect(down.statusCode).toBe(502); expect(down.body).not.toContain('boom');
  });
  it('400 for a bad document id', async () => { expect((await get(await make(), '/documents/nope/file')).statusCode).toBe(400); });
});

describe('picture quality warnings (never block an upload)', () => {
  const png = (w: number, h: number, fill: (x: number, y: number) => number) => { const p = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fill(x, y); const k = (y * w + x) * 4; p.data[k] = p.data[k + 1] = p.data[k + 2] = v; p.data[k + 3] = 255; } return PNG.sync.write(p); };
  it('a dark, small photo is accepted and the reply says what to fix, in plain words', async () => {
    const r = await upload(await make(), form({ kind: 'lab_report' }, { name: 'x.png', type: 'image/png', data: png(300, 300, () => 30) }));
    expect(r.statusCode).toBe(201);
    const codes = r.json().quality.warnings.map((x: { code: string }) => x.code); expect(codes).toEqual(expect.arrayContaining(['small', 'too_dark']));
    expect(r.json().quality.warnings[0].text).toMatch(/Retake/); expect(w.uploaded).toHaveLength(1);
  });
  it('a clear page has an empty warnings list; a PDF has no quality block', async () => {
    const r = await upload(await make(), form({ kind: 'lab_report' }, { name: 'x.png', type: 'image/png', data: png(900, 900, (x, y) => ((Math.floor(y / 14) % 2 === 0 && x % 40 < 25 && x > 60 && x < 840) ? 20 : 235)) }));
    expect(r.json().quality.warnings).toEqual([]);
  });
});
