import { describe, expect, it } from 'vitest';
import { runRetention, type DueDocument, type FileRemover, type RetentionStore } from '../src/retention/run.js';

const doc = (id: string, over: Partial<DueDocument> = {}): DueDocument => ({ id, patient_id: 'p', facility_id: 'f', storage_path: `f/p/${id}.pdf`, mime_type: 'application/pdf', size_bytes: 100, created_at: '2025-01-01T00:00:00.000Z', retention_until: null, ...over });
const setup = (docs: DueDocument[], opts: { removeError?: (p: string) => string | null; scrubFails?: Set<string>; proofFails?: boolean } = {}) => {
  const log: string[] = []; const asked: { days: number | null; limit: number }[] = [];
  const store: RetentionStore = {
    findDue: async (_n, days, limit) => { asked.push({ days, limit }); return docs; },
    scrub: async id => { log.push(`scrub:${id}`); if (opts.scrubFails?.has(id)) throw new Error('db'); },
    proof: async (d, _at, reason) => { log.push(`proof:${d.id}:${reason}`); if (opts.proofFails) throw new Error('audit'); },
  };
  const files: FileRemover = { remove: async paths => { log.push(`remove:${paths[0]}`); const e = opts.removeError?.(paths[0]!) ?? null; return { error: e }; } };
  return { store, files, log, asked };
};

describe('runRetention', () => {
  it('removes the file FIRST, then scrubs the database, then writes the proof', async () => {
    const { store, files, log } = setup([doc('a')]);
    const r = await runRetention(store, files, { defaultDays: 365 });
    expect(log).toEqual(['remove:f/p/a.pdf', 'scrub:a', 'proof:a:older than 365 days']); expect(r).toMatchObject({ due: 1, deleted: 1, failed: 0 });
  });
  it('a document with its own retention date says so in the proof', async () => {
    const { store, files, log } = setup([doc('a', { retention_until: '2026-09-30' })]);
    await runRetention(store, files, { defaultDays: null }); expect(log[2]).toBe('proof:a:retention date 2026-09-30 reached');
  });
  it('when the file cannot be removed the database is left alone and nothing is claimed as deleted', async () => {
    const { store, files, log } = setup([doc('a')], { removeError: () => 'storage down' });
    const r = await runRetention(store, files, { defaultDays: 30 });
    expect(log).toEqual(['remove:f/p/a.pdf']); expect(r).toMatchObject({ deleted: 0, failed: 1 });
  });
  it('a remover that throws counts as a failure and the run carries on with the rest', async () => {
    const { store, log } = setup([doc('a'), doc('b')]);
    const files: FileRemover = { remove: async p => { if (p[0]!.includes('/a.')) throw new Error('network'); log.push('remove:b'); return { error: null }; } };
    const r = await runRetention(store, files, { defaultDays: 30 });
    expect(r).toMatchObject({ deleted: 1, failed: 1 }); expect(log).toContain('scrub:b'); expect(log).not.toContain('scrub:a');
  });
  it('if the scrub fails after the file went, there is no proof entry and it counts as failed (next run repeats it)', async () => {
    const { store, files, log } = setup([doc('a')], { scrubFails: new Set(['a']) });
    const r = await runRetention(store, files, { defaultDays: 30 });
    expect(log.some(l => l.startsWith('proof'))).toBe(false); expect(r).toMatchObject({ deleted: 0, failed: 1 });
  });
  it('if the proof cannot be written it is NOT counted as deleted', async () => {
    expect(await runRetention(...(() => { const s = setup([doc('a')], { proofFails: true }); return [s.store, s.files, { defaultDays: 30 }] as const; })())).toMatchObject({ deleted: 0, failed: 1 });
  });
  it('one failing document does not stop the others', async () => {
    const { store, files } = setup([doc('a'), doc('b'), doc('c')], { removeError: p => (p.includes('/b.') ? 'x' : null) });
    expect(await runRetention(store, files, { defaultDays: 30 })).toMatchObject({ due: 3, deleted: 2, failed: 1 });
  });
  it('a dry run changes nothing and removes nothing', async () => {
    const { store, files, log } = setup([doc('a'), doc('b')]);
    expect(await runRetention(store, files, { defaultDays: 30, dryRun: true })).toEqual({ dryRun: true, due: 2, deleted: 0, failed: 0, skipped: null }); expect(log).toEqual([]);
  });
  it.each([[null], [0], [-5], [NaN]])('with no usable default period (%s) it says so and passes null on', async d => {
    const { store, files, asked } = setup([]);
    const r = await runRetention(store, files, { defaultDays: d as number | null });
    expect(asked[0]!.days).toBeNull(); expect(r.skipped).toMatch(/No default retention period/);
  });
  it('passes a whole number of days and the batch limit', async () => {
    const { store, files, asked } = setup([]); await runRetention(store, files, { defaultDays: 90.9, limit: 7 });
    expect(asked).toEqual([{ days: 90, limit: 7 }]);
  });
});
