// The retention SQL against the REAL schema: selection, legal hold, scrubbing under the append-only rules, and the proof entry.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { runRetention, type FileRemover } from '../src/retention/run.js';
import { makeRetentionStore } from '../src/retention/store.js';
import { makeSystemAdmin } from '../src/admin/store.js';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F = randomUUID(), U = randomUUID();
const NOW = new Date('2026-10-07T00:00:00Z');
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const store = () => makeRetentionStore({ query: async (sql, p) => ({ rows: (await db.query(sql, p as any[])).rows as any[] }) });
const removed: string[] = [];
const files: FileRemover = { remove: async p => { removed.push(...p); return { error: null }; } };

async function make(o: { createdDaysAgo: number; retentionUntil?: string | null; hold?: boolean; withText?: boolean } ) {
  const pt = randomUUID(), doc = randomUUID();
  await db.query(`insert into public.patients (id, registered_facility_id, full_name) values ($1,$2,'Retention Test')`, [pt, F]);
  await db.query(`insert into public.documents (id, patient_id, facility_id, kind, storage_path, mime_type, size_bytes, original_filename, scan_status, created_at, retention_until)
                  values ($1,$2,$3,'lab_report',$4,'application/pdf',1234,'secret-name.pdf','clean', $5::timestamptz, $6)`,
    [doc, pt, F, `${F}/${pt}/${doc}.pdf`, new Date(NOW.getTime() - o.createdDaysAgo * 86_400_000).toISOString(), o.retentionUntil ?? null]);
  if (o.withText) {
    const x = randomUUID();
    await db.query(`insert into public.extractions (id, document_id, engine, engine_version, status, raw_text) values ($1,$2,'mock','1','completed','Haemoglobin 10.2 Name: Retention Test')`, [x, doc]);
  }
  if (o.hold) await db.query(`insert into public.erasure_requests (patient_id, status) values ($1,'legal_hold')`, [pt]);
  return { pt, doc };
}
const state = async (id: string) => (await rows('select deleted_at, original_filename from public.documents where id = $1', [id]))[0];

beforeAll(async () => {
  db = await makeDb();
  await db.query(`insert into auth.users (id, email) values ($1,'a@t.test')`, [U]);
  await db.query(`insert into public.facilities (id, name, type) values ($1,'PHC','phc')`, [F]);
});

describe('selection', () => {
  it('picks documents older than the default period and ones whose own date has passed; skips newer, undated-and-young, and legal holds', async () => {
    const old = await make({ createdDaysAgo: 400 }), young = await make({ createdDaysAgo: 10 }), dated = await make({ createdDaysAgo: 10, retentionUntil: '2026-10-01' }), future = await make({ createdDaysAgo: 400, retentionUntil: '2027-01-01' }), held = await make({ createdDaysAgo: 400, hold: true });
    const ids = (await store().findDue(NOW, 365, 100)).map(d => d.id);
    expect(ids).toContain(old.doc); expect(ids).toContain(dated.doc);
    expect(ids).not.toContain(young.doc); expect(ids).not.toContain(future.doc); expect(ids).not.toContain(held.doc);
  });
  it('with no default period only documents with their own date are due', async () => {
    const old = await make({ createdDaysAgo: 900 }), dated = await make({ createdDaysAgo: 1, retentionUntil: '2026-10-07' });
    const ids = (await store().findDue(NOW, null, 100)).map(d => d.id);
    expect(ids).toContain(dated.doc); expect(ids).not.toContain(old.doc);
  });
  it('already-deleted documents are not picked again', async () => {
    const a = await make({ createdDaysAgo: 400 }); await db.query(`update public.documents set deleted_at = now() where id = $1`, [a.doc]);
    expect((await store().findDue(NOW, 365, 100)).map(d => d.id)).not.toContain(a.doc);
  });
});

describe('a real run', () => {
  it('removes the file, scrubs the text and file name, marks the document deleted, and leaves a proof entry with no name or contents', async () => {
    const a = await make({ createdDaysAgo: 500, withText: true }); removed.length = 0;
    const before = (await rows(`select count(*)::int n from public.audit_events where entity_type = 'document_retention'`))[0].n;
    const r = await runRetention(store(), files, { now: NOW, defaultDays: 365, limit: 500 });
    expect(r.deleted).toBeGreaterThanOrEqual(1); expect(r.failed).toBe(0); expect(removed).toContain(`${F}/${a.pt}/${a.doc}.pdf`);
    expect(await state(a.doc)).toMatchObject({ original_filename: null }); expect((await state(a.doc)).deleted_at).not.toBeNull();
    expect((await rows('select raw_text from public.extractions where document_id = $1', [a.doc]))[0].raw_text).toBeNull();
    const proof = (await rows(`select actor_user_id, action, patient_id, facility_id, reason, details from public.audit_events where entity_type = 'document_retention' and entity_id = $1`, [a.doc]))[0];
    expect(proof).toMatchObject({ action: 'delete', patient_id: a.pt, facility_id: F, reason: 'older than 365 days' });
    expect(proof.details).toMatchObject({ mime: 'application/pdf', sizeBytes: 1234 }); expect(JSON.stringify(proof)).not.toMatch(/Retention Test|secret-name|Haemoglobin/);
    expect((await rows(`select count(*)::int n from public.audit_events where entity_type = 'document_retention'`))[0].n).toBeGreaterThan(before);
  });
  it('a second run finds nothing more to do', async () => {
    const r = await runRetention(store(), files, { now: NOW, defaultDays: 365, limit: 500 });
    expect(r).toMatchObject({ due: 0, deleted: 0 });
  });
  it('a legal-hold patient\'s file is never removed', async () => {
    const h = await make({ createdDaysAgo: 900, hold: true }); removed.length = 0;
    await runRetention(store(), files, { now: NOW, defaultDays: 30, limit: 500 });
    expect(removed).not.toContain(`${F}/${h.pt}/${h.doc}.pdf`); expect((await state(h.doc)).deleted_at).toBeNull();
  });
  it('if the file cannot be removed the database row is untouched and no proof is written', async () => {
    const a = await make({ createdDaysAgo: 900 });
    const failing: FileRemover = { remove: async () => ({ error: 'storage down' }) };
    const before = (await rows(`select count(*)::int n from public.audit_events where entity_type = 'document_retention' and entity_id = $1`, [a.doc]))[0].n;
    await runRetention(store(), failing, { now: NOW, defaultDays: 30, limit: 500 });
    expect((await state(a.doc)).deleted_at).toBeNull(); expect((await rows(`select count(*)::int n from public.audit_events where entity_type = 'document_retention' and entity_id = $1`, [a.doc]))[0].n).toBe(before);
  });
  it('the audit chain still verifies after all the proof entries', async () => {
    const sys = makeSystemAdmin({ query: async (sql, p) => ({ rows: (await db.query(sql, p as any[])).rows as any[] }) });
    expect((await sys.verifyChain()).brokenIds).toEqual([]);
  });
});
