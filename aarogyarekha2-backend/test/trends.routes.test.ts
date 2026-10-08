import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, Deps, UserReader, UserWriter, VitalPoint } from '../src/deps.js';
import type { PatientRow } from '../src/fhir/project.js';

const P = '11111111-1111-4111-8111-111111111111';
const patient = { id: P, public_ref: 'AR-1', registered_facility_id: '22222222-2222-4222-8222-222222222222' } as unknown as PatientRow;
interface World { pts: VitalPoint[]; consent: boolean; visible: boolean; asked: { kinds: string[]; limit: number }[]; audits: AuditEvent[]; noStore: boolean; fail: boolean }
let w: World;
const make = async () => {
  const reader = (): UserReader => ({ getPatient: async () => (w.visible ? patient : null), getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [], listPatients: async () => [], getQueue: async () => [], getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [], getNames: async () => ({}), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null });
  const deps: Deps = {
    verifyToken: async t => (t === 'u' ? { userId: 'u1' } : null), userReader: reader, userWriter: () => ({ hasActiveConsent: async () => w.consent }) as unknown as UserWriter,
    assess: async () => { throw new Error('x'); }, review: async () => { throw new Error('x'); }, sendReferral: async () => { throw new Error('x'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    ...(w.noStore ? {} : { vitalHistory: () => ({ forPatient: async (_p: string, kinds: string[], limit: number) => { if (w.fail) throw new Error('x'); w.asked.push({ kinds, limit }); return w.pts; } }) }),
    audit: async e => { w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
const get = async (q = '', token: string | null = 'u') => (await make()).inject({ method: 'GET', url: `/patients/${P}/trends${q}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
beforeEach(() => { w = { pts: [{ kind: 'bp_systolic_mmhg', value: 150, unit: 'mm[Hg]', measured_at: '2026-09-01T00:00:00Z', encounter_id: 'e1' }], consent: true, visible: true, asked: [], audits: [], noStore: false, fail: false }; });

describe('trends', () => {
  it('returns raw readings with their time and visit, asks for BP and sugar by default, audits a count only', async () => {
    const r = await get(); expect(r.statusCode).toBe(200); expect(r.json().points).toEqual([{ kind: 'bp_systolic_mmhg', value: 150, unit: 'mm[Hg]', at: '2026-09-01T00:00:00Z', encounterId: 'e1' }]);
    expect(w.asked[0]).toEqual({ kinds: ['bp_systolic_mmhg', 'bp_diastolic_mmhg', 'blood_glucose_mgdl'], limit: 60 });
    expect(w.audits.find(a => a.entityType === 'vital_trends')).toMatchObject({ patientId: P, details: { count: 1 } }); expect(JSON.stringify(w.audits)).not.toContain('150');
  });
  it('takes a list of kinds and a limit', async () => { await get('?kinds=weight_kg,pulse_bpm&limit=5'); expect(w.asked[0]).toEqual({ kinds: ['weight_kg', 'pulse_bpm'], limit: 5 }); });
  it.each(['?kinds=drop_table', '?kinds=', '?limit=0', '?limit=999', '?x=1'])('rejects %s', async q => { expect((await get(q)).statusCode).toBe(400); expect(w.asked).toHaveLength(0); });
  it('needs consent and access; 401, 404, 403, not set up 503, load failure 502', async () => {
    w.consent = false; expect((await get()).statusCode).toBe(403); w.consent = true;
    w.visible = false; expect((await get()).statusCode).toBe(404); w.visible = true;
    expect((await get('', null)).statusCode).toBe(401);
    w.fail = true; expect((await get()).statusCode).toBe(502); w.fail = false;
    w.noStore = true; expect((await get()).statusCode).toBe(503);
  });
});
