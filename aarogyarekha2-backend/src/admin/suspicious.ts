export interface AuditRow {
  id: number; occurred_at: string; actor_user_id: string | null; actor_role: string | null; facility_id: string | null;
  action: string; entity_type: string; outcome: string; patient_id: string | null; ip: string | null;
}

export const RULES = {
  validated: false,
  manyPatients: { windowMinutes: 10, distinctPatients: 25 },
  refusals: { windowMinutes: 10, count: 5 },
  failedLogins: { windowMinutes: 10, count: 5 },
  offHours: { startHour: 22, endHour: 6, count: 10 },
} as const;

export type FlagKind = 'many_patients' | 'repeated_refusals' | 'failed_logins' | 'off_hours_reads' | 'emergency_access';
export interface Flag { kind: FlagKind; severity: 'review' | 'info'; who: { actorId: string | null; ip: string | null }; count: number; firstAt: string; lastAt: string; text: string }

const t = (r: AuditRow) => Date.parse(r.occurred_at);
const istHour = (ms: number) => new Date(ms + 5.5 * 3_600_000).getUTCHours();
const inNight = (h: number) => (RULES.offHours.startHour > RULES.offHours.endHour ? h >= RULES.offHours.startHour || h < RULES.offHours.endHour : h >= RULES.offHours.startHour && h < RULES.offHours.endHour);
const groupBy = <T,>(xs: T[], key: (x: T) => string | null) => { const m = new Map<string, T[]>(); for (const x of xs) { const k = key(x); if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(x); } return m; };

function bestWindow(rows: AuditRow[], minutes: number, measure: (w: AuditRow[]) => number): AuditRow[] {
  const s = [...rows].sort((a, b) => t(a) - t(b) || a.id - b.id); let best: AuditRow[] = []; let bestN = 0; let lo = 0;
  for (let hi = 0; hi < s.length; hi++) {
    while (t(s[hi]!) - t(s[lo]!) > minutes * 60_000) lo++;
    const w = s.slice(lo, hi + 1); const n = measure(w);
    if (n > bestN) { best = w; bestN = n; }
  }
  return best;
}

export function flagSuspicious(events: AuditRow[], now: Date = new Date()): Flag[] {
  const flags: Flag[] = [];
  const valid = events.filter(e => !Number.isNaN(t(e)) && t(e) <= now.getTime() + 60_000);
  const span = (w: AuditRow[]) => ({ firstAt: w[0]!.occurred_at, lastAt: w[w.length - 1]!.occurred_at });

  for (const [actor, rows] of groupBy(valid.filter(e => e.action === 'read' && e.outcome === 'success' && e.patient_id), e => e.actor_user_id)) {
    const w = bestWindow(rows, RULES.manyPatients.windowMinutes, x => new Set(x.map(r => r.patient_id)).size);
    const n = new Set(w.map(r => r.patient_id)).size;
    if (n >= RULES.manyPatients.distinctPatients) flags.push({ kind: 'many_patients', severity: 'review', who: { actorId: actor, ip: null }, count: n, ...span(w), text: `Opened ${n} different patients' records within ${RULES.manyPatients.windowMinutes} minutes.` });
  }

  for (const [actor, rows] of groupBy(valid.filter(e => e.outcome === 'denied' && e.action !== 'login_failed'), e => e.actor_user_id)) {
    const w = bestWindow(rows, RULES.refusals.windowMinutes, x => x.length);
    if (w.length >= RULES.refusals.count) flags.push({ kind: 'repeated_refusals', severity: 'review', who: { actorId: actor, ip: null }, count: w.length, ...span(w), text: `${w.length} requests were refused within ${RULES.refusals.windowMinutes} minutes.` });
  }

  for (const [ip, rows] of groupBy(valid.filter(e => e.action === 'login_failed'), e => e.ip)) {
    const w = bestWindow(rows, RULES.failedLogins.windowMinutes, x => x.length);
    if (w.length >= RULES.failedLogins.count) flags.push({ kind: 'failed_logins', severity: 'review', who: { actorId: null, ip }, count: w.length, ...span(w), text: `${w.length} failed sign-ins from one address within ${RULES.failedLogins.windowMinutes} minutes.` });
  }

  for (const [actor, rows] of groupBy(valid.filter(e => e.action === 'read' && e.outcome === 'success' && e.patient_id && inNight(istHour(t(e)))), e => e.actor_user_id)) {
    if (rows.length >= RULES.offHours.count) { const s = [...rows].sort((a, b) => t(a) - t(b)); flags.push({ kind: 'off_hours_reads', severity: 'review', who: { actorId: actor, ip: null }, count: s.length, ...span(s), text: `${s.length} patient records opened between ${RULES.offHours.startHour}:00 and ${String(RULES.offHours.endHour).padStart(2, '0')}:00.` }); }
  }

  for (const [actor, rows] of groupBy(valid.filter(e => e.action === 'break_glass'), e => e.actor_user_id)) {
    const s = [...rows].sort((a, b) => t(a) - t(b));
    flags.push({ kind: 'emergency_access', severity: 'info', who: { actorId: actor, ip: null }, count: s.length, ...span(s), text: `Used emergency access ${s.length} time${s.length === 1 ? '' : 's'}. Check the reasons in the emergency access list.` });
  }

  const rank = { review: 0, info: 1 } as const;
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity] || Date.parse(b.lastAt) - Date.parse(a.lastAt));
}
