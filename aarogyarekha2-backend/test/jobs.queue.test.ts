import { describe, expect, it } from 'vitest';
import { JobQueue } from '../src/jobs/queue.js';

const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r; }); return { p, open }; };
const tick = () => new Promise(r => setTimeout(r, 5));
let n = 0; const ids = () => `j${++n}`;

describe('JobQueue', () => {
  it('runs a job and keeps its result for the owner only', async () => {
    const q = new JobQueue({ newId: ids }); const id = q.submit('u1', 'ocr', async () => ({ ok: 1 }))!; await tick();
    expect(q.get(id, 'u1')).toMatchObject({ status: 'done', result: { ok: 1 } }); expect(q.get(id, 'u2')).toBeNull(); expect(q.get('unknown', 'u1')).toBeNull();
  });
  it('runs at most `concurrency` at once, the rest wait in order, and all finish', async () => {
    const q = new JobQueue({ concurrency: 2, newId: ids }); const gs = [gate(), gate(), gate()]; const order: number[] = [];
    const j = gs.map((g, i) => q.submit('u', 'ocr', async () => { order.push(i); await g.p; return i; })!); await tick();
    expect(q.stats()).toMatchObject({ running: 2, queued: 1 }); expect(q.get(j[2]!, 'u')!.status).toBe('queued');
    gs[0]!.open(); await tick(); expect(q.get(j[2]!, 'u')!.status).toBe('running'); gs[1]!.open(); gs[2]!.open(); await tick();
    expect(order).toEqual([0, 1, 2]); expect(j.map(x => q.get(x, 'u')!.status)).toEqual(['done', 'done', 'done']);
  });
  it('refuses new work when too many are waiting', async () => {
    const q = new JobQueue({ concurrency: 1, maxQueued: 2, newId: ids }); const g = gate();
    q.submit('u', 'k', () => g.p); await tick(); const a = q.submit('u', 'k', () => g.p), b = q.submit('u', 'k', () => g.p), c = q.submit('u', 'k', () => g.p);
    expect([a !== null, b !== null, c]).toEqual([true, true, null]); g.open();
  });
  it('a failing job is marked failed with a plain message and never leaks the error text; the queue carries on', async () => {
    const q = new JobQueue({ concurrency: 1, newId: ids }); const bad = q.submit('u', 'k', async () => { throw new Error('secret path C:\\files\\patient.pdf'); })!; const good = q.submit('u', 'k', async () => 'fine')!; await tick();
    const b = q.get(bad, 'u')!; expect(b.status).toBe('failed'); expect(b.error).toBe('The job could not be completed. Try again.'); expect(JSON.stringify(b)).not.toContain('patient.pdf'); expect(q.get(good, 'u')!.status).toBe('done');
  });
  it('a job that runs too long is stopped with a plain message', async () => {
    const q = new JobQueue({ timeoutMs: 20, newId: ids }); const id = q.submit('u', 'k', () => new Promise(() => {}))!; await new Promise(r => setTimeout(r, 60));
    expect(q.get(id, 'u')).toMatchObject({ status: 'failed', error: expect.stringContaining('took too long') }); expect(q.stats().running).toBe(0);
  });
  it('a job that throws synchronously is a failure, not a crash', async () => {
    const q = new JobQueue({ newId: ids }); const id = q.submit('u', 'k', (() => { throw new Error('x'); }) as () => Promise<never>)!; await tick(); expect(q.get(id, 'u')!.status).toBe('failed');
  });
  it('finished jobs are forgotten after the retention time, running ones never', async () => {
    let t = 1000; const q = new JobQueue({ retainMs: 100, now: () => t, newId: ids }); const done = q.submit('u', 'k', async () => 1)!; const g = gate(); const live = q.submit('u', 'k', () => g.p)!; await tick();
    t += 500; expect(q.get(done, 'u')).toBeNull(); expect(q.get(live, 'u')!.status).toBe('running'); g.open(); await tick(); expect(q.get(live, 'u')!.status).toBe('done');
  });
  it('get returns a copy, so callers cannot change the real job', async () => {
    const q = new JobQueue({ newId: ids }); const id = q.submit('u', 'k', async () => 1)!; await tick(); const j = q.get(id, 'u')!; j.status = 'queued'; expect(q.get(id, 'u')!.status).toBe('done');
  });
});
