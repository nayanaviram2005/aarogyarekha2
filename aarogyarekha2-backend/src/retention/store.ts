import type { DueDocument, RetentionStore } from './run.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
interface TxSource extends Queryable { connect?: () => Promise<Queryable & { release(): void }> }

export function makeRetentionStore(db: TxSource): RetentionStore {
  return {
    async findDue(now, defaultDays, limit) {
      const r = await db.query(
        `select d.id, d.patient_id, d.facility_id, d.storage_path, d.mime_type, d.size_bytes, d.created_at, d.retention_until
           from public.documents d
          where d.deleted_at is null
            and (d.retention_until <= $1::timestamptz::date
                 or (d.retention_until is null and $2::int is not null and d.created_at < $1::timestamptz - make_interval(days => $2::int)))
            and not exists (select 1 from public.erasure_requests e where e.patient_id = d.patient_id and e.status = 'legal_hold')
          order by d.created_at limit $3`, [now.toISOString(), defaultDays, limit]);
      return r.rows.map((x): DueDocument => ({ id: x.id, patient_id: x.patient_id, facility_id: x.facility_id, storage_path: x.storage_path, mime_type: x.mime_type, size_bytes: Number(x.size_bytes), created_at: new Date(x.created_at).toISOString(), retention_until: x.retention_until ? (x.retention_until instanceof Date ? x.retention_until.toISOString().slice(0, 10) : String(x.retention_until)) : null }));
    },

    async scrub(id) {
      const c = db.connect ? await db.connect() : null; const q: Queryable = c ?? db;
      try {
        await q.query('begin');
        await q.query(`select set_config('app.erasure_mode', 'on', true)`);
        await q.query('delete from public.extracted_fields where extraction_id in (select id from public.extractions where document_id = $1)', [id]);
        await q.query('update public.extractions set raw_text = null where document_id = $1', [id]);
        await q.query('update public.documents set original_filename = null, deleted_at = now() where id = $1 and deleted_at is null', [id]);
        await q.query('commit');
      } catch (e) { await q.query('rollback').catch(() => {}); throw e; } finally { c?.release(); }
    },

    async proof(d, at, reason) {
      await db.query(
        `select app.write_audit('delete'::public.audit_action, 'document_retention', $1::uuid, $2::uuid, $3::uuid, null, 'success'::public.audit_outcome, null, null, 'retention-worker', $4, $5::jsonb)`,
        [d.id, d.patient_id, d.facility_id, reason, JSON.stringify({ mime: d.mime_type, sizeBytes: d.size_bytes, uploadedAt: d.created_at, deletedAt: at.toISOString() })]);
    },
  };
}
