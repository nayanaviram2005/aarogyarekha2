export interface DueDocument { id: string; patient_id: string; facility_id: string; storage_path: string; mime_type: string; size_bytes: number; created_at: string; retention_until: string | null }

export interface RetentionStore {
  findDue(now: Date, defaultDays: number | null, limit: number): Promise<DueDocument[]>;
  scrub(id: string): Promise<void>;
  proof(d: DueDocument, at: Date, reason: string): Promise<void>;
}
export interface FileRemover { remove(paths: string[]): Promise<{ error: string | null }> }

export interface RetentionResult { dryRun: boolean; due: number; deleted: number; failed: number; skipped: string | null }

export async function runRetention(
  store: RetentionStore, files: FileRemover,
  opts: { now?: Date; defaultDays: number | null; limit?: number; dryRun?: boolean },
): Promise<RetentionResult> {
  const now = opts.now ?? new Date(); const limit = opts.limit ?? 200;
  const days = opts.defaultDays !== null && Number.isFinite(opts.defaultDays) && opts.defaultDays > 0 ? Math.floor(opts.defaultDays) : null;
  const due = await store.findDue(now, days, limit);
  if (opts.dryRun) return { dryRun: true, due: due.length, deleted: 0, failed: 0, skipped: days === null ? 'No default retention period is set; only documents with their own date are listed.' : null };

  let deleted = 0, failed = 0;
  for (const d of due) {
    const rm = await files.remove([d.storage_path]).catch((e: Error) => ({ error: e.message }));
    if (rm.error) { failed++; continue; }
    try {
      await store.scrub(d.id);
      await store.proof(d, now, d.retention_until ? `retention date ${d.retention_until} reached` : `older than ${days} days`);
      deleted++;
    } catch { failed++; }
  }
  return { dryRun: false, due: due.length, deleted, failed, skipped: days === null ? 'No default retention period is set; only documents with their own date were processed.' : null };
}
