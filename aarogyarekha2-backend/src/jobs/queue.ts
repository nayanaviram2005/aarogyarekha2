// A small in-memory job queue for slow work (reading a report photo). It lets the request return at once and the screen check back.
//
// What it is: a limit on how many slow jobs run at once, a cap on how many may wait, and a short memory of results.
// What it is NOT: durable. A restart loses waiting and running jobs, and the screen is told the job is unknown so the person can try again.
// Results hold ids and plain messages only, never report text. Each job belongs to the user who started it; nobody else can see it.
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export interface Job<T = unknown> { id: string; owner: string; kind: string; status: JobStatus; createdAt: number; startedAt?: number; finishedAt?: number; result?: T; error?: string }
export interface JobQueueOptions { concurrency?: number; maxQueued?: number; retainMs?: number; timeoutMs?: number; now?: () => number; newId?: () => string }

export class JobQueue {
  private jobs = new Map<string, Job>();
  private waiting: { job: Job; run: () => Promise<unknown> }[] = [];
  private running = 0;
  private readonly o: Required<JobQueueOptions>;

  constructor(opts: JobQueueOptions = {}) {
    this.o = { concurrency: 2, maxQueued: 20, retainMs: 10 * 60_000, timeoutMs: 120_000, now: Date.now, newId: () => crypto.randomUUID(), ...opts };
  }

  /** Adds a job. Returns its id, or null when too many are already waiting. */
  submit<T>(owner: string, kind: string, run: () => Promise<T>): string | null {
    this.purge();
    if (this.waiting.length >= this.o.maxQueued) return null;
    const job: Job = { id: this.o.newId(), owner, kind, status: 'queued', createdAt: this.o.now() };
    this.jobs.set(job.id, job); this.waiting.push({ job, run }); this.pump();
    return job.id;
  }

  /** The job, but only for the person who started it. Anyone else gets null, the same as for an unknown id. */
  get(id: string, owner: string): Job | null {
    this.purge(); const j = this.jobs.get(id);
    return j && j.owner === owner ? { ...j } : null;
  }

  stats() { return { queued: this.waiting.length, running: this.running, remembered: this.jobs.size }; }

  private pump() {
    while (this.running < this.o.concurrency && this.waiting.length > 0) {
      const { job, run } = this.waiting.shift()!;
      this.running++; job.status = 'running'; job.startedAt = this.o.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), this.o.timeoutMs); (timer as { unref?: () => void }).unref?.(); });
      Promise.race([Promise.resolve().then(run), timeout])
        .then(r => { job.status = 'done'; job.result = r; })
        .catch((e: Error) => { job.status = 'failed'; job.error = e.message === 'timeout' ? 'This took too long. Try again with a smaller, clearer picture.' : 'The job could not be completed. Try again.'; })
        .finally(() => { clearTimeout(timer); job.finishedAt = this.o.now(); this.running--; this.pump(); });
    }
  }

  private purge() {
    const now = this.o.now();
    for (const [id, j] of this.jobs) if (j.finishedAt !== undefined && now - j.finishedAt > this.o.retainMs) this.jobs.delete(id);
  }
}
