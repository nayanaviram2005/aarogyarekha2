import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, UserReader, UserWriter } from '../src/deps.js';
import { shapeLabTrends, type LabPoint } from '../src/ocr/labTrends.js';

const pt = (name: string, valueNum: number | null, at: string, over: Partial<LabPoint> = {}): LabPoint =>
  ({ name, valueNum, valueText: valueNum === null ? null : String(valueNum), unit: 'g/dL', printedFlag: null, verified: true, at, documentId: 'd-' + at, encounterId: 'e-' + at, ...over });

describe('results over time: shaping', () => {
  it('groups by test, orders by time, and describes the change between the last two numbers without judging it', () => {
    const r = shapeLabTrends([pt('haemoglobin', 10.4, '2026-10-01T00:00:00Z'), pt('haemoglobin', 9.1, '2026-08-01T00:00:00Z'), pt('esr', 30, '2026-10-01T00:00:00Z', { unit: 'mm/hr' })]);
    const hb = r.tests.find(t => t.name === 'haemoglobin')!;
    expect(hb.label).toBe('Haemoglobin'); expect(hb.points.map(p => p.value)).toEqual([9.1, 10.4]);
    expect(hb.change).toEqual({ from: 9.1, to: 10.4, direction: 'up', unit: 'g/dL' });
    expect(r.tests.find(t => t.name === 'esr')!.change).toBeNull();
    expect(r.tests[0]!.name).toBe('haemoglobin');
  });
  it('shows no change when the units differ between visits, and says so', () => {
    const r = shapeLabTrends([pt('glucose', 5.5, '2026-08-01T00:00:00Z', { unit: 'mmol/L' }), pt('glucose', 99, '2026-10-01T00:00:00Z', { unit: 'mg/dL' })]);
    expect(r.tests[0]!.unitsDiffer).toBe(true); expect(r.tests[0]!.change).toBeNull();
  });
  it('detects down and same, ignores text-only rows in the change, and counts unverified rows and visits', () => {
    const r = shapeLabTrends([pt('wbc', 9000, '2026-08-01T00:00:00Z', { unit: '/cumm' }), pt('wbc', 8000, '2026-09-01T00:00:00Z', { unit: '/cumm', verified: false }), pt('wbc', null, '2026-10-01T00:00:00Z', { unit: '/cumm', valueText: 'present' })]);
    expect(r.tests[0]!.change).toMatchObject({ direction: 'down', from: 9000, to: 8000 });
    expect(r).toMatchObject({ rows: 3, unverified: 1, visits: 3 });
    expect(shapeLabTrends([pt('x', 5, '2026-08-01T00:00:00Z'), pt('x', 5, '2026-09-01T00:00:00Z')]).tests[0]!.change!.direction).toBe('same');
  });
  it('is empty when there is nothing', () => { expect(shapeLabTrends([])).toEqual({ tests: [], rows: 0, unverified: 0, visits: 0 }); });
});

const P = '11111111-1111-4111-8111-111111111111';
const patient = { id: P, public_ref: 'AR-1', registered_facility_id: '22222222-2222-4222-8222-222222222222' };
interface World { pts: LabPoint[]; consent: boolean; visible: boolean; audits: AuditEvent[]; noStore: boolean; fail: boolean }
let w: World;
const make = async () => {
  const deps = {
    verifyToken: async (t: string) => (t === 'u' ? { userId: 'u1' } : null),
    userReader: () => ({ getPatient: async () => (w.visible ? patient : null) }) as unknown as UserReader,
    userWriter: () => ({ hasActiveConsent: async () => w.consent }) as unknown as UserWriter,
    ...(w.noStore ? {} : { labHistory: () => ({ forPatient: async () => { if (w.fail) throw new Error('x'); return w.pts; } }) }),
    audit: async (e: AuditEvent) => { w.audits.push(e); },
  } as unknown as Deps;
  return buildApp({ allowedOrigins: [] }, deps);
};
const get = async (token: string | null = 'u') => (await make()).inject({ method: 'GET', url: `/patients/${P}/lab-trends`, headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => { w = { pts: [pt('haemoglobin', 9.1, '2026-08-01T00:00:00Z'), pt('haemoglobin', 10.4, '2026-10-01T00:00:00Z')], consent: true, visible: true, audits: [], noStore: false, fail: false }; });

describe('GET /patients/:id/lab-trends', () => {
  it('returns the shaped series and audits a count, never a value', async () => {
    const r = await get(); expect(r.statusCode).toBe(200);
    expect(r.json().tests[0]).toMatchObject({ name: 'haemoglobin', change: { direction: 'up' } });
    expect(w.audits.find(a => a.entityType === 'lab_trends')).toMatchObject({ patientId: P, details: { rows: 2 } });
    expect(JSON.stringify(w.audits)).not.toMatch(/10\.4|9\.1/);
  });
  it('needs consent and access: 401, 404, 403; not set up 503; load failure 502', async () => {
    expect((await get(null)).statusCode).toBe(401);
    w.visible = false; expect((await get()).statusCode).toBe(404); w.visible = true;
    w.consent = false; expect((await get()).statusCode).toBe(403); w.consent = true;
    w.fail = true; expect((await get()).statusCode).toBe(502); w.fail = false;
    w.noStore = true; expect((await get()).statusCode).toBe(503);
  });
});
