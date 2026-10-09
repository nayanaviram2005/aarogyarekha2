import { describe, expect, it } from 'vitest';
import { flagSuspicious, RULES, type AuditRow } from '../src/admin/suspicious.js';

const NOW = new Date('2026-10-07T12:00:00Z');
let id = 0;
const ev = (over: Partial<AuditRow> & { minsAgo?: number } = {}): AuditRow => {
  const { minsAgo = 5, ...rest } = over;
  return { id: ++id, occurred_at: new Date(NOW.getTime() - minsAgo * 60_000).toISOString(), actor_user_id: 'u1', actor_role: 'nurse', facility_id: 'f1', action: 'read', entity_type: 'encounter_summary', outcome: 'success', patient_id: 'p1', ip: '10.0.0.1', ...rest };
};
const reads = (n: number, spreadMins: number, actor = 'u1') => Array.from({ length: n }, (_, i) => ev({ actor_user_id: actor, patient_id: `p${i}`, minsAgo: 1 + (i * spreadMins) / Math.max(n - 1, 1) }));
const kinds = (rows: AuditRow[]) => flagSuspicious(rows, NOW).map(f => f.kind);

describe('many patients', () => {
  it('flags one person opening 25 different patients within 10 minutes', () => {
    const f = flagSuspicious(reads(RULES.manyPatients.distinctPatients, 9), NOW);
    expect(f).toHaveLength(1); expect(f[0]).toMatchObject({ kind: 'many_patients', severity: 'review', count: 25, who: { actorId: 'u1' } });
  });
  it('does not flag 24 patients, or 25 spread over an hour, or the same patient 40 times', () => {
    expect(kinds(reads(24, 9))).toEqual([]); expect(kinds(reads(25, 60))).toEqual([]);
    expect(kinds(Array.from({ length: 40 }, (_, i) => ev({ minsAgo: 1 + i * 0.1 })))).toEqual([]);
  });
  it('counts people separately: 15 + 15 by two users is not a flag', () => {
    expect(kinds([...reads(15, 5, 'u1'), ...reads(15, 5, 'u2')])).toEqual([]);
  });
  it('refused or non-patient reads do not count towards it', () => {
    expect(kinds(reads(25, 9).map(e => ({ ...e, outcome: 'denied' })))).not.toContain('many_patients');
    expect(kinds(reads(25, 9).map(e => ({ ...e, patient_id: null })))).toEqual([]);
  });
});

describe('refusals and failed sign-ins', () => {
  it('flags 5 refusals within 10 minutes by one person', () => {
    expect(kinds(Array.from({ length: 5 }, (_, i) => ev({ outcome: 'denied', minsAgo: 1 + i })))).toEqual(['repeated_refusals']);
    expect(kinds(Array.from({ length: 4 }, (_, i) => ev({ outcome: 'denied', minsAgo: 1 + i })))).toEqual([]);
  });
  it('flags 5 failed sign-ins from one address, whoever they claimed to be', () => {
    const f = flagSuspicious(Array.from({ length: 5 }, (_, i) => ev({ action: 'login_failed', outcome: 'denied', actor_user_id: null, ip: '203.0.113.9', minsAgo: 1 + i })), NOW);
    expect(f).toHaveLength(1); expect(f[0]).toMatchObject({ kind: 'failed_logins', who: { actorId: null, ip: '203.0.113.9' }, count: 5 });
  });
  it('failed sign-ins from different addresses are not combined', () => {
    expect(kinds(Array.from({ length: 6 }, (_, i) => ev({ action: 'login_failed', outcome: 'denied', actor_user_id: null, ip: `203.0.113.${i}` })))).toEqual([]);
  });
});

describe('night reads (India time)', () => {
  const at = (hourIst: number, i: number): AuditRow => { const d = new Date('2026-10-06T00:00:00Z'); d.setUTCHours(hourIst - 5, 30 - 60 + i); return ev({ occurred_at: d.toISOString(), patient_id: `n${i}` }); };
  it('flags 10 reads between 22:00 and 06:00 IST', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ev({ occurred_at: new Date(Date.UTC(2026, 9, 6, 18, 40 + i * 5)).toISOString(), patient_id: `n${i}` }));
    expect(kinds(rows)).toContain('off_hours_reads');
  });
  it('the same number during the day is not flagged', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ev({ occurred_at: new Date(Date.UTC(2026, 9, 6, 6, i * 20)).toISOString(), patient_id: `d${i}` }));
    expect(kinds(rows)).not.toContain('off_hours_reads'); void at;
  });
  it('9 night reads are not enough', () => {
    expect(kinds(Array.from({ length: 9 }, (_, i) => ev({ occurred_at: new Date(Date.UTC(2026, 9, 6, 20, i * 5)).toISOString(), patient_id: `n${i}` })))).not.toContain('off_hours_reads');
  });
});

describe('emergency access', () => {
  it('is always listed, as information, with a count', () => {
    const f = flagSuspicious([ev({ action: 'break_glass', minsAgo: 30 }), ev({ action: 'break_glass', minsAgo: 10 })], NOW);
    expect(f).toHaveLength(1); expect(f[0]).toMatchObject({ kind: 'emergency_access', severity: 'info', count: 2 }); expect(f[0]!.text).toMatch(/2 times/);
  });
  it('uses the singular for one', () => { expect(flagSuspicious([ev({ action: 'break_glass' })], NOW)[0]!.text).toMatch(/1 time\./); });
});

describe('ordering and safety', () => {
  it('review flags come before information flags, newest first', () => {
    const f = flagSuspicious([ev({ action: 'break_glass', actor_user_id: 'u9' }), ...Array.from({ length: 5 }, (_, i) => ev({ outcome: 'denied', minsAgo: 60 + i })), ...Array.from({ length: 5 }, (_, i) => ev({ outcome: 'denied', actor_user_id: 'u3', minsAgo: 1 + i }))], NOW);
    expect(f.map(x => [x.kind, x.who.actorId])).toEqual([['repeated_refusals', 'u3'], ['repeated_refusals', 'u1'], ['emergency_access', 'u9']]);
  });
  it('ignores rows with a broken or future time instead of crashing', () => {
    expect(kinds([ev({ occurred_at: 'junk', outcome: 'denied' }), ev({ occurred_at: '2999-01-01T00:00:00Z', outcome: 'denied' })])).toEqual([]);
  });
  it('flags carry ids and counts only: no names, no patient ids', () => {
    const f = flagSuspicious(reads(25, 9), NOW); expect(JSON.stringify(f)).not.toMatch(/"p\d+"/);
  });
  it('the shipped rules are marked not validated', () => { expect(RULES.validated).toBe(false); });
  it('no events, no flags', () => { expect(flagSuspicious([], NOW)).toEqual([]); });
});
