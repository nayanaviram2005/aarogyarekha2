import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditRow } from '../src/admin/suspicious.js';
import { BreakGlassError, type AuditEvent, type AuditExportRow, type PatientSearchRow, type TriageVisitRow, type BreakGlassRow, type Deps, type UserReader, type UserWriter } from '../src/deps.js';
import type { PatientRow } from '../src/fhir/project.js';

const F1 = '22222222-2222-4222-8222-222222222222';
const F2 = '77777777-7777-4777-8777-777777777777';
const G = '99999999-9999-4999-8999-999999999999';
const P = '11111111-1111-4111-8111-111111111111';
const mem = (facilityId: string, role: string) => ({ facilityId, facilityName: 'F', facilityType: 'phc', role });

interface World {
  members: Record<string, ReturnType<typeof mem>[]>; audit: AuditRow[]; grants: BreakGlassRow[]; broken: number[]; checked: number; reviewResult: boolean; granted: unknown[]; grantError: unknown;
  auditLog: AuditEvent[]; listedFor: string[][]; auditFails: boolean; requireMfa: boolean; patientVisible: boolean; sinceSeen: string[]; analyticsAsked: { f: string[]; d: number }[]; exported: { f: string[]; since: string; limit: number }[]; exportRows: AuditExportRow[]; searchRows: PatientSearchRow[]; searched: { q: string; limit: number }[]; history: TriageVisitRow[];
}
let w: World;

const mkAudit = (n: number, over: Partial<AuditRow> = {}): AuditRow[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, occurred_at: new Date(Date.now() - (1 + i) * 30_000).toISOString(), actor_user_id: 'u-bad', actor_role: 'nurse', facility_id: F1, action: 'read', entity_type: 'encounter_summary', outcome: 'denied', patient_id: null, ip: '10.0.0.1', ...over }));
const grantRow = (over: Partial<BreakGlassRow> = {}): BreakGlassRow => ({ id: G, user_id: 'u-nurse', patient_ref: 'AR-0001', facility_id: F1, reason: 'Unconscious on arrival', created_at: '2026-10-07T08:00:00.000Z', expires_at: '2026-10-07T09:00:00.000Z', reviewed_by: null, reviewed_at: null, ...over });

const make = async () => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => (w.patientVisible ? ({ id: P, public_ref: 'AR-0001', registered_facility_id: F1, full_name: 'Test Patient' } as unknown as PatientRow) : null), getIdentifiers: async () => [], getEncounter: async () => null, getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
    getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: w.members[t] ?? [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => [],
    getNames: async ids => Object.fromEntries(ids.map(i => [i, i === 'u-bad' ? 'Bad Actor' : i === 'u-doc' ? 'Dr Rao' : null])), listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const deps: Deps = {
    verifyToken: async t => (t in w.members ? { userId: 'u-' + t, aal: t === 'nurse1' ? 'aal1' : 'aal2' } : null), userReader: reader, userWriter: () => ({ hasActiveConsent: async () => true }) as unknown as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    adminStore: () => ({
      recentAudit: async since => { w.sinceSeen.push(since); return w.audit; }, reviewBreakGlass: async () => w.reviewResult,
      patientEncounters: async () => [{ id: 'e1', status: 'closed', scenario: 'opd_queue', created_at: '2026-10-01T00:00:00Z' }],
      patientTriageHistory: async () => w.history,
    }),
    systemAdmin: {
      analytics: async (f, d) => { w.analyticsAsked.push({ f, d }); return { days: d, referralsSent: 2, perDay: [{ day: '2026-10-07', n: 4 }], encounters: 10, submitted: 9, assessed: 9, reviewed: 6, byScenario: [{ scenario: 'opd_queue', n: 10 }], byUrgency: [{ urgency: 'orange', n: 4 }], secondsToAssessment: { n: 9, median: 1.2, p90: 3.4 }, minutesToReview: { n: 6, median: 12.5, p90: 40 }, review: { approved: 5, changed: 1, loweredBelowRules: 0, agreementRate: 0.833 }, feedback: { helpful: 3, notHelpful: 1 } }; },
      searchPatients: async (q, limit) => { w.searched.push({ q, limit }); return w.searchRows; },
      auditExport: async (f, since, limit) => { w.exported.push({ f, since, limit }); return w.exportRows; },
      verifyChain: async () => ({ checked: w.checked, brokenIds: w.broken }), listBreakGlass: async f => { w.listedFor.push(f); return w.grants; },
      grantBreakGlass: async a => { w.granted.push(a); if (w.grantError) throw w.grantError; return { id: G, patientId: P, publicRef: 'AR-0001', expiresAt: '2026-10-07T09:00:00.000Z' }; },
    },
    audit: async e => { if (w.auditFails && (e.entityType.startsWith('admin_') || e.entityType === 'break_glass_patient_search' || e.entityType === 'patient_triage_history')) throw new Error('audit down'); w.auditLog.push(e); },
  };
  return buildApp({ allowedOrigins: [], requireMfa: w.requireMfa }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, token: string | null, body?: object) => app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  w = { members: { admin: [mem(F1, 'facility_admin')], nurse: [mem(F1, 'nurse')], nurse1: [mem(F1, 'nurse')], multi: [mem(F1, 'doctor'), mem(F2, 'nurse')], hw: [mem(F1, 'facility_admin'), mem(F2, 'health_worker')] },
    audit: mkAudit(5), grants: [grantRow()], broken: [], checked: 42, reviewResult: true, granted: [], grantError: null, auditLog: [], listedFor: [], auditFails: false, requireMfa: false, patientVisible: true, sinceSeen: [], analyticsAsked: [], exported: [], exportRows: [], searchRows: [], searched: [], history: [] };
});

describe('who may open the admin screens', () => {
  it.each(['/admin/audit/flags', '/admin/audit/chain', '/admin/break-glass'])('%s: a clinician gets 403, no login 401', async url => {
    const app = await make();
    expect((await call(app, 'GET', url, 'nurse')).statusCode).toBe(403); expect((await call(app, 'GET', url, null)).statusCode).toBe(401);
  });
});

describe('suspicious access', () => {
  it('returns flags with the person\'s name, the draft-rules marker, and how many events were examined', async () => {
    const r = await call(await make(), 'GET', '/admin/audit/flags', 'admin');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ examined: 5, rulesValidated: false, hours: 24 });
    expect(r.json().flags[0]).toMatchObject({ kind: 'repeated_refusals', who: { actorId: 'u-bad', name: 'Bad Actor' } });
  });
  it('only looks at the administrator\'s own facilities', async () => {
    w.audit = mkAudit(5, { facility_id: F2 });
    expect((await call(await make(), 'GET', '/admin/audit/flags', 'admin')).json().flags).toEqual([]);
  });
  it('asks for the hours requested and rejects silly values', async () => {
    const app = await make();
    await call(app, 'GET', '/admin/audit/flags?hours=48', 'admin'); expect(Date.now() - Date.parse(w.sinceSeen[0]!)).toBeGreaterThan(47.9 * 3_600_000);
    for (const q of ['hours=0', 'hours=500', 'hours=abc']) expect((await call(app, 'GET', `/admin/audit/flags?${q}`, 'admin')).statusCode).toBe(400);
  });
  it('the administrator\'s own read is logged first; if that fails nothing is released', async () => {
    w.auditFails = true;
    const r = await call(await make(), 'GET', '/admin/audit/flags', 'admin');
    expect(r.statusCode).toBe(503); expect(JSON.stringify(r.json())).not.toContain('Bad Actor');
  });
});

describe('audit chain badge', () => {
  it('intact', async () => {
    expect((await call(await make(), 'GET', '/admin/audit/chain', 'admin')).json()).toMatchObject({ intact: true, checked: 42, brokenIds: [] });
  });
  it('broken: says so and names the rows (at most 20)', async () => {
    w.broken = Array.from({ length: 30 }, (_, i) => i + 1);
    const j = (await call(await make(), 'GET', '/admin/audit/chain', 'admin')).json();
    expect(j.intact).toBe(false); expect(j.brokenIds).toHaveLength(20);
  });
});

describe('emergency access list and review', () => {
  it('lists grants for the administrator\'s facilities only, with the record number and no patient name', async () => {
    const r = await call(await make(), 'GET', '/admin/break-glass', 'hw');
    expect(w.listedFor).toEqual([[F1]]);
    expect(r.json().grants[0]).toMatchObject({ id: G, patientRef: 'AR-0001', reason: 'Unconscious on arrival', reviewed: false });
  });
  it('an administrator can mark one reviewed; a missing or already-reviewed one is 404; bad id is 400; clinician is 403', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/admin/break-glass/${G}/review`, 'admin')).json()).toEqual({ id: G, reviewed: true });
    w.reviewResult = false; expect((await call(app, 'POST', `/admin/break-glass/${G}/review`, 'admin')).statusCode).toBe(404);
    expect((await call(app, 'POST', '/admin/break-glass/nope/review', 'admin')).statusCode).toBe(400);
    expect((await call(app, 'POST', `/admin/break-glass/${G}/review`, 'nurse')).statusCode).toBe(403);
  });
});

describe('using emergency access', () => {
  const ok = { publicRef: 'AR-0001', reason: 'Unconscious on arrival, no relatives' };
  it('grants, and audits it as break_glass with the patient and facility', async () => {
    const r = await call(await make(), 'POST', '/break-glass', 'nurse', ok);
    expect(r.statusCode).toBe(201); expect(r.json()).toMatchObject({ id: G, patientRef: 'AR-0001', patientId: P });
    expect(w.granted).toEqual([{ userId: 'u-nurse', facilityId: F1, publicRef: 'AR-0001', reason: ok.reason }]);
    expect(w.auditLog.find(a => a.action === 'break_glass')).toMatchObject({ outcome: 'success', patientId: P, facilityId: F1 });
    expect(JSON.stringify(w.auditLog)).not.toContain('Unconscious');
  });
  it.each([['short reason', { publicRef: 'AR-0001', reason: 'urgent' }], ['no reason', { publicRef: 'AR-0001' }], ['bad record number', { publicRef: 'AR 0001; drop', reason: 'Unconscious on arrival' }], ['extra field', { ...ok, role: 'x' }]])('rejects %s', async (_n, body) => {
    expect((await call(await make(), 'POST', '/break-glass', 'nurse', body)).statusCode).toBe(400); expect(w.granted).toHaveLength(0);
  });
  it('needs a verified second factor when the deployment requires it', async () => {
    w.requireMfa = true;
    const r = await call(await make(), 'POST', '/break-glass', 'nurse1', ok);
    expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/Two-factor/); expect(w.granted).toHaveLength(0);
    expect((await call(await make(), 'POST', '/break-glass', 'nurse', ok)).statusCode).toBe(201);
  });
  it('an administrator-only account cannot use it', async () => {
    expect((await call(await make(), 'POST', '/break-glass', 'admin', ok)).statusCode).toBe(400); expect(w.granted).toHaveLength(0);
  });
  it('with several facilities the caller must choose one of their own clinical ones', async () => {
    const app = await make();
    expect((await call(app, 'POST', '/break-glass', 'multi', ok)).statusCode).toBe(400);
    expect((await call(app, 'POST', '/break-glass', 'multi', { ...ok, facilityId: F2 })).statusCode).toBe(201);
    expect((await call(app, 'POST', '/break-glass', 'multi', { ...ok, facilityId: '88888888-8888-4888-8888-888888888888' })).statusCode).toBe(403);
    expect(w.granted).toHaveLength(1);
  });
  it('an unknown record number is a 404 and the attempt is audited as denied', async () => {
    w.grantError = new BreakGlassError('not_found', 'x');
    const r = await call(await make(), 'POST', '/break-glass', 'nurse', ok);
    expect(r.statusCode).toBe(404); expect(w.auditLog.find(a => a.action === 'break_glass')).toMatchObject({ outcome: 'denied', details: { kind: 'not_found' } });
  });
  it('a refusal from the database layer is a 403; any other failure is a plain 502', async () => {
    const app = await make();
    w.grantError = new BreakGlassError('forbidden', 'Only clinical staff at that facility can use emergency access.'); expect((await call(app, 'POST', '/break-glass', 'nurse', ok)).statusCode).toBe(403);
    w.grantError = new Error('db down'); expect((await call(app, 'POST', '/break-glass', 'nurse', ok)).statusCode).toBe(502);
  });
});

describe('a patient\'s encounters (after emergency access)', () => {
  it('lists them and audits the read first', async () => {
    const r = await call(await make(), 'GET', `/patients/${P}/encounters`, 'nurse');
    expect(r.json()).toMatchObject({ patientRef: 'AR-0001', encounters: [{ id: 'e1' }] }); expect(w.auditLog.some(a => a.entityType === 'patient_encounters' && a.patientId === P)).toBe(true);
  });
  it('a patient the caller cannot see is 404', async () => {
    w.patientVisible = false; expect((await call(await make(), 'GET', `/patients/${P}/encounters`, 'nurse')).statusCode).toBe(404);
  });
});

describe('analytics', () => {
  it('works out figures for the administrator own facilities only, 30 days by default, and adds a plain note about what agreement means', async () => {
    const r = await call(await make(), 'GET', '/admin/analytics', 'hw');
    expect(r.statusCode).toBe(200); expect(w.analyticsAsked).toEqual([{ f: [F1], d: 30 }]);
    expect(r.json()).toMatchObject({ days: 30, encounters: 10, review: { agreementRate: 0.833 }, feedback: { helpful: 3 } }); expect(r.json().note).toMatch(/not a measure of clinical accuracy/);
  });
  it('takes 7, 30 or 90 days and rejects anything else', async () => {
    const app = await make(); for (const d of [7, 90]) expect((await call(app, 'GET', '/admin/analytics?days=' + d, 'admin')).statusCode).toBe(200);
    for (const q of ['days=5', 'days=abc', 'days=0']) expect((await call(app, 'GET', '/admin/analytics?' + q, 'admin')).statusCode).toBe(400);
  });
  it('is for administrators only, and carries no names or patient ids', async () => {
    const app = await make(); expect((await call(app, 'GET', '/admin/analytics', 'nurse')).statusCode).toBe(403); expect((await call(app, 'GET', '/admin/analytics', null)).statusCode).toBe(401);
    expect(JSON.stringify((await call(app, 'GET', '/admin/analytics', 'admin')).json())).not.toMatch(/patient|name/i);
  });
});

describe('audit export', () => {
  const row = (over: Partial<AuditExportRow> = {}): AuditExportRow => ({ id: 7, occurred_at: '2026-10-07T08:00:00.000Z', actor_user_id: 'u-1', actor_name: 'Asha Rao', actor_role: 'nurse', facility_id: F1, facility_name: 'Khordha PHC', action: 'read', entity_type: 'encounter_summary', outcome: 'success', patient_ref: 'AR-0001', ...over });
  it('gives the administrator a CSV for their own facilities, with the chain state and a logged export', async () => {
    w.exportRows = [row(), row({ id: 8, actor_name: '=HYPERLINK("x")', facility_name: 'A, B' })];
    const app = await make(); const r = await call(app, 'GET', '/admin/audit/export?days=7', 'admin');
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toMatch(/text\/csv/); expect(r.headers['content-disposition']).toMatch(/attachment; filename="audit-7d-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(r.headers['x-audit-chain']).toBe('intact'); expect(r.headers['x-audit-rows']).toBe('2'); expect(r.headers['x-audit-truncated']).toBe('false');
    const lines = r.body.trim().split('\r\n'); expect(lines[0]).toBe('entry,time,person,role,facility,action,record,patient_ref,outcome');
    expect(lines[1]).toBe('7,2026-10-07T08:00:00.000Z,Asha Rao,nurse,Khordha PHC,read,encounter_summary,AR-0001,success');
    expect(lines[2]).toContain('"\'=HYPERLINK(""x"")"'); expect(lines[2]).toContain('"A, B"');
    expect(w.exported[0]!.f).toEqual([F1]); expect(w.auditLog.some(a => a.entityType === 'admin_audit_export' && a.action === 'export')).toBe(true);
  });
  it('says so in a header when the chain does not match', async () => {
    w.broken = [3]; const app = await make();
    expect((await call(app, 'GET', '/admin/audit/export', 'admin')).headers['x-audit-chain']).toBe('broken');
  });
  it('a clinician gets 403, no login 401, and silly periods are 400', async () => {
    const app = await make();
    expect((await call(app, 'GET', '/admin/audit/export', 'nurse')).statusCode).toBe(403); expect((await call(app, 'GET', '/admin/audit/export', null)).statusCode).toBe(401);
    expect((await call(app, 'GET', '/admin/audit/export?days=5', 'admin')).statusCode).toBe(400);
  });
  it('releases nothing if the export cannot be logged', async () => {
    w.exportRows = [row()]; w.auditFails = true; const app = await make();
    const r = await call(app, 'GET', '/admin/audit/export', 'admin'); expect(r.statusCode).toBeGreaterThanOrEqual(500); expect(r.body).not.toContain('Asha Rao');
  });
});

describe('emergency access: finding the patient', () => {
  const OTHER = '88888888-8888-4888-8888-888888888888';
  const hit = (over: Partial<PatientSearchRow> = {}): PatientSearchRow => ({ publicRef: 'AR-0042', name: 'Sita Mohanty', sex: 'female', age: 34, facilityId: OTHER, facilityName: 'Cuttack CHC', ...over });
  it('a clinician gets a short list with name, age, record number and where the patient is registered, and the search is logged without the words typed', async () => {
    w.searchRows = [hit(), hit({ publicRef: 'AR-0043', name: 'Sita Das', facilityId: F1, facilityName: 'Khordha PHC' })];
    const app = await make(); const r = await call(app, 'GET', '/break-glass/patients?q=Sita', 'multi');
    expect(r.statusCode).toBe(200); expect(r.json().truncated).toBe(false);
    expect(r.json().patients).toEqual([
      { publicRef: 'AR-0042', name: 'Sita Mohanty', sex: 'female', age: 34, facility: 'Cuttack CHC', ownFacility: false },
      { publicRef: 'AR-0043', name: 'Sita Das', sex: 'female', age: 34, facility: 'Khordha PHC', ownFacility: true },
    ]);
    expect(w.searched).toEqual([{ q: 'Sita', limit: 16 }]);
    const a = w.auditLog.find(x => x.entityType === 'break_glass_patient_search')!; expect(a.action).toBe('read'); expect(a.details).toEqual({ length: 4, results: 2 }); expect(JSON.stringify(a)).not.toContain('Sita');
  });
  it('says when the list was cut', async () => {
    w.searchRows = Array.from({ length: 16 }, (_, i) => hit({ publicRef: `AR-${100 + i}` }));
    const r = await call(await make(), 'GET', '/break-glass/patients?q=Sita', 'multi');
    expect(r.json().truncated).toBe(true); expect(r.json().patients).toHaveLength(15);
  });
  it('needs at least two characters', async () => {
    const app = await make();
    expect((await call(app, 'GET', '/break-glass/patients?q=S', 'multi')).statusCode).toBe(400); expect((await call(app, 'GET', '/break-glass/patients', 'multi')).statusCode).toBe(400);
    expect(w.searched).toHaveLength(0);
  });
  it('is for clinical staff only; an administrator, no login and a missing second factor are refused', async () => {
    const app = await make();
    expect((await call(app, 'GET', '/break-glass/patients?q=Sita', 'admin')).statusCode).toBe(403);
    expect((await call(app, 'GET', '/break-glass/patients?q=Sita', null)).statusCode).toBe(401);
    w.requireMfa = true; const strict = await make();
    expect((await call(strict, 'GET', '/break-glass/patients?q=Sita', 'nurse1')).statusCode).toBe(403);
    expect(w.searched).toHaveLength(0);
  });
  it('releases nothing if the search cannot be logged', async () => {
    w.searchRows = [hit()]; w.auditFails = true; const r = await call(await make(), 'GET', '/break-glass/patients?q=Sita', 'multi');
    expect(r.statusCode).toBeGreaterThanOrEqual(500); expect(r.body).not.toContain('Sita Mohanty');
  });
});

describe('emergency access: the triage history', () => {
  const visit = (over: Partial<TriageVisitRow> = {}): TriageVisitRow => ({ id: 'e1', createdAt: '2026-10-05T08:00:00.000Z', facilityId: F2, facilityName: 'Cuttack CHC', scenario: 'opd_queue', status: 'closed', outcome: 'treated_here', complaint: 'Chest pain since morning', assessedUrgency: 'orange', finalUrgency: 'red', reviewedBy: 'u-doc', reviewedAt: '2026-10-05T08:20:00.000Z', notes: [{ id: 'n1', authorId: 'u-doc', body: 'ECG normal. Started aspirin; review in 2 days.', at: '2026-10-05T09:00:00.000Z' }], ...over });
  it('returns each visit with priority, complaint, outcome, who signed it off and the doctor’s notes, and logs the read with counts only', async () => {
    w.history = [visit()]; const r = await call(await make(), 'GET', `/patients/${P}/triage-history`, 'nurse');
    expect(r.statusCode).toBe(200); const j = r.json(); expect(j.patientRef).toBe('AR-0001'); expect(j.patientName).toBe('Test Patient');
    expect(j.visits[0]).toMatchObject({ id: 'e1', facility: 'Cuttack CHC', assessedUrgency: 'orange', finalUrgency: 'red', complaint: 'Chest pain since morning', outcome: 'treated_here', reviewedBy: 'Dr Rao', notes: [{ id: 'n1', author: 'Dr Rao', body: 'ECG normal. Started aspirin; review in 2 days.' }] });
    const a = w.auditLog.find(x => x.entityType === 'patient_triage_history')!; expect(a.details).toEqual({ visits: 1, notes: 1 }); expect(JSON.stringify(a)).not.toContain('aspirin');
  });
  it('is 404 when the patient is not visible to the caller, and nothing is read', async () => {
    w.patientVisible = false; w.history = [visit()];
    const r = await call(await make(), 'GET', `/patients/${P}/triage-history`, 'nurse'); expect(r.statusCode).toBe(404); expect(r.body).not.toContain('aspirin');
  });
  it('bad id is 400, no login 401, and it releases nothing if the read cannot be logged', async () => {
    const app = await make();
    expect((await call(app, 'GET', '/patients/not-an-id/triage-history', 'nurse')).statusCode).toBe(400); expect((await call(app, 'GET', `/patients/${P}/triage-history`, null)).statusCode).toBe(401);
    w.history = [visit()]; w.auditFails = true; const r = await call(await make(), 'GET', `/patients/${P}/triage-history`, 'nurse');
    expect(r.statusCode).toBeGreaterThanOrEqual(500); expect(r.body).not.toContain('aspirin');
  });
});
