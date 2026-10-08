// A limit on how many DIFFERENT patients' records one person opens in an hour. Someone who needs a few dozen patients in a busy hour is
// normal; someone who opens hundreds is browsing, or their login is being used by someone else. Reaching the limit stops further
// opens (until the hour slides on) and writes an audit entry that an administrator can see. It protects records even from a valid login.
export interface AccessBudget { record(userId: string, patientId: string, now?: number): { count: number; exceeded: boolean; firstTime: boolean } }

export function makeAccessBudget(limit: number, windowMs = 3_600_000): AccessBudget {
  const seen = new Map<string, Map<string, number>>();   // user -> patient -> last time opened
  const alerted = new Map<string, number>();
  return {
    record(userId, patientId, now = Date.now()) {
      if (limit <= 0) return { count: 0, exceeded: false, firstTime: false };
      let m = seen.get(userId); if (!m) { m = new Map(); seen.set(userId, m); }
      for (const [p, t] of m) if (now - t > windowMs) m.delete(p);
      if (!m.has(patientId) && m.size >= limit) {
        const last = alerted.get(userId); const firstTime = last === undefined || now - last > windowMs; if (firstTime) alerted.set(userId, now);
        return { count: m.size, exceeded: true, firstTime };
      }
      m.set(patientId, now);
      if (seen.size > 5000) for (const [u, mm] of seen) if (![...mm.values()].some(t => now - t <= windowMs)) seen.delete(u);
      return { count: m.size, exceeded: false, firstTime: false };
    },
  };
}
