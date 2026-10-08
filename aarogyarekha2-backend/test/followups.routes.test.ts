import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuditEvent, ConsentBrief, Deps, FollowupStore, FollowupView, UserReader, UserWriter } from '../src/deps.js';
import { DbError } from '../src/deps.js';
import type { EncounterRow, PatientRow } from '../src/fhir/project.js';

const P = '11111111-1111-4111-8111-111111111111';
const F = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const S = '66666666-6666-4666-8666-666666666666';
const patient = { id: P, registered_facility_id: F, full_name: 'Anita Rao' } as unknown as PatientRow;
const enc: EncounterRow = { id: E, patient_id: P, facility_id: F, status: 'closed', scenario: 'maternal_followup', language: 'hi', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z' };
const consent = (purpose: string, over: Partial<ConsentBrief> = {}): ConsentBrief => ({ id: 'c-' + purpose, purpose, granted_at: '2026-10-01T08:00:00Z', revoked_at: null, expires_at: null, ...over });
const sched = (over: Partial<FollowupView> = {}): FollowupView => ({ id: S, patient_id: P, facility_id: F, kind: 'anc_visit', cadence_days: 28, next_due_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), active: true, created_at: '2026-10-06T09:00:00Z', reminders: [], ...over });

interface World { consents: ConsentBrief[]; triage: boolean; sched: FollowupView | null; created: unknown[]; stopped: string[]; scheduled: unknown[]; audits: AuditEvent[]; createFails: unknown; listFails: boolean; auditFails: boolean; noStore: boolean }
let w: World;

const make = async () => {
  const reader = (t: string): UserReader => ({
    getPatient: async () => (t === 'clinician' ? patient : null), getIdentifiers: async () => [], getEncounter: async id => (t === 'clinician' && id === E ? enc : null), getVitals: async () => [], listPatients: async () => [], getQueue: async () => [],
    getEncounterSummary: async () => null, getMe: async () => ({ displayName: null, memberships: [] }), listFacilities: async () => [], getFacility: async () => null, getReferral: async () => null, listReferrals: async () => [], getConsents: async () => w.consents, getNames: async () => ({}),
    listDocuments: async () => [], getDocument: async () => null, getExtraction: async () => null,
  });
  const store = (_t: string, userId: string): FollowupStore => ({
    list: async () => { if (w.listFails) throw new Error('x'); return userId === 'u-clinician' && w.sched ? [w.sched] : []; },
    get: async id => (userId === 'u-clinician' && w.sched && w.sched.id === id ? w.sched : null),
    create: async a => { if (w.createFails) throw w.createFails; w.created.push(a); return { id: S }; },
    stop: async id => { w.stopped.push(id); },
  });
  const deps: Deps = {
    verifyToken: async t => (t === 'clinician' || t === 'outsider' ? { userId: 'u-' + t } : null), userReader: reader, userWriter: () => ({ hasActiveConsent: async () => w.triage }) as unknown as UserWriter,
    assess: async () => { throw new Error('unused'); }, review: async () => { throw new Error('unused'); }, sendReferral: async () => { throw new Error('unused'); },
    translator: { name: 'mock', model: 'mock', generate: async () => ({ text: '{}', provider: 'mock', model: 'mock' }) }, saveSymptomTranslations: async () => {}, logExternalRun: async () => {}, readText: async () => ({ engine: 'mock', engineVersion: null, text: '', confidence: 1, language: null }), finishUpload: async () => {}, failUpload: async () => {}, saveExtraction: async () => ({ extractionId: 'x' }),
    ...(w.noStore ? {} : { followups: store, scheduleReminder: async (a: unknown) => { w.scheduled.push(a); return { id: 'rem-1' }; } }),
    audit: async e => { if (w.auditFails && e.entityType === 'followups') throw new Error('audit down'); w.audits.push(e); },
  };
  return buildApp({ allowedOrigins: [] }, deps);
};
type App = Awaited<ReturnType<typeof make>>;
const call = (app: App, method: 'GET' | 'POST', url: string, body?: object, token: string | null = 'clinician') =>
  app.inject({ method, url, ...(body ? { payload: body } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => { w = { consents: [consent('care_triage'), consent('reminders')], triage: true, sched: sched(), created: [], stopped: [], scheduled: [], audits: [], createFails: null, listFails: false, auditFails: false, noStore: false }; });

describe('plan and list', () => {
  it('plans a follow-up, due in the number of days asked, and logs it without clinical detail', async () => {
    const r = await call(await make(), 'POST', `/encounters/${E}/followups`, { kind: 'anc_visit', firstDueInDays: 30, cadenceDays: 28 });
    expect(r.statusCode).toBe(201);
    const c = w.created[0] as { nextDueAt: string; cadenceDays: number; facilityId: string };
    expect(Math.round((Date.parse(c.nextDueAt) - Date.now()) / 86_400_000)).toBe(30); expect(c.cadenceDays).toBe(28); expect(c.facilityId).toBe(F);
    expect(w.audits.find(a => a.entityType === 'followup_schedule')).toMatchObject({ outcome: 'success', details: { kind: 'anc_visit' } });
  });
  it.each([[{ kind: 'nope', firstDueInDays: 1 }], [{ kind: 'custom', firstDueInDays: -1 }], [{ kind: 'custom', firstDueInDays: 400 }], [{ kind: 'custom', firstDueInDays: 1, cadenceDays: 0 }], [{ kind: 'custom', firstDueInDays: 1, extra: 1 }], [{ kind: 'custom', firstDueInDays: 1.5 }]])('rejects bad input %j', async body => {
    expect((await call(await make(), 'POST', `/encounters/${E}/followups`, body)).statusCode).toBe(400); expect(w.created).toHaveLength(0);
  });
  it('lists the follow-ups with their reminders, and the read is audited first', async () => {
    w.sched = sched({ reminders: [{ id: 'r', due_at: '2026-10-20T00:00:00Z', channel: 'sms', status: 'sent', sent_at: '2026-10-20T00:01:00Z' }] });
    const r = await call(await make(), 'GET', `/encounters/${E}/followups`);
    expect(r.statusCode).toBe(200); expect(r.json().followups[0]).toMatchObject({ id: S, kind: 'anc_visit', cadenceDays: 28, active: true, reminders: [{ status: 'sent' }] });
    expect(w.audits.some(a => a.entityType === 'followups' && a.action === 'read')).toBe(true);
  });
  it('if the read cannot be audited nothing is released', async () => {
    w.auditFails = true;
    const r = await call(await make(), 'GET', `/encounters/${E}/followups`);
    expect(r.statusCode).toBe(503); expect(JSON.stringify(r.json())).not.toContain(S);
  });
  it('access: no login 401, stranger 404, no triage consent 403', async () => {
    const app = await make();
    expect((await call(app, 'GET', `/encounters/${E}/followups`, undefined, null)).statusCode).toBe(401);
    expect((await call(app, 'GET', `/encounters/${E}/followups`, undefined, 'outsider')).statusCode).toBe(404);
    w.triage = false; expect((await call(app, 'GET', `/encounters/${E}/followups`)).statusCode).toBe(403);
  });
  it('a database refusal is a plain 403, and a load failure a plain 502', async () => {
    const app = await make();
    w.createFails = new DbError('42501', 'rls'); expect((await call(app, 'POST', `/encounters/${E}/followups`, { kind: 'custom', firstDueInDays: 1 })).statusCode).toBe(403);
    w.listFails = true; expect((await call(app, 'GET', `/encounters/${E}/followups`)).statusCode).toBe(502);
  });
  it('says plainly when follow-ups are not set up', async () => {
    w.noStore = true;
    const r = await call(await make(), 'GET', `/encounters/${E}/followups`);
    expect(r.statusCode).toBe(503); expect(r.json().issue[0].details.text).toMatch(/not set up/);
  });
});

describe('reminders', () => {
  it('schedules one, using the patient\'s reminders consent, on the schedule\'s due date by default', async () => {
    const s = sched(); w.sched = s;
    const r = await call(await make(), 'POST', `/followups/${S}/reminders`, { channel: 'sms' });
    expect(r.statusCode).toBe(201); expect(r.json()).toMatchObject({ status: 'scheduled', channel: 'sms' });
    expect(w.scheduled).toEqual([{ scheduleId: S, consentId: 'c-reminders', dueAt: new Date(s.next_due_at!).toISOString(), channel: 'sms' }]);
  });
  it('without the patient\'s consent to reminders nothing is scheduled', async () => {
    w.consents = [consent('care_triage')];
    const r = await call(await make(), 'POST', `/followups/${S}/reminders`, { channel: 'sms' });
    expect(r.statusCode).toBe(403); expect(r.json().issue[0].details.text).toMatch(/agreed to reminders/); expect(w.scheduled).toHaveLength(0);
  });
  it.each([['revoked', { revoked_at: '2026-10-05T00:00:00Z' }], ['expired', { expires_at: '2026-10-02T00:00:00Z' }]])('a %s consent does not count', async (_n, over) => {
    w.consents = [consent('reminders', over)];
    expect((await call(await make(), 'POST', `/followups/${S}/reminders`, { channel: 'sms' })).statusCode).toBe(403); expect(w.scheduled).toHaveLength(0);
  });
  it('a stopped follow-up takes no new reminders; a stranger gets 404', async () => {
    w.sched = sched({ active: false });
    expect((await call(await make(), 'POST', `/followups/${S}/reminders`, { channel: 'sms' })).statusCode).toBe(409);
    w.sched = sched();
    expect((await call(await make(), 'POST', `/followups/${S}/reminders`, { channel: 'sms' }, 'outsider')).statusCode).toBe(404);
    expect(w.scheduled).toHaveLength(0);
  });
  it('checks the date range and the channel', async () => {
    const app = await make(); const day = 86_400_000;
    expect((await call(app, 'POST', `/followups/${S}/reminders`, { channel: 'sms', dueAt: new Date(Date.now() - 2 * day).toISOString() })).statusCode).toBe(400);
    expect((await call(app, 'POST', `/followups/${S}/reminders`, { channel: 'sms', dueAt: new Date(Date.now() + 500 * day).toISOString() })).statusCode).toBe(400);
    expect((await call(app, 'POST', `/followups/${S}/reminders`, { channel: 'pigeon' })).statusCode).toBe(400);
    expect((await call(app, 'POST', `/followups/${S}/reminders`, { channel: 'in_app', dueAt: new Date(Date.now() + 3 * day).toISOString() })).statusCode).toBe(201);
    expect(w.scheduled).toHaveLength(1);
  });
  it('needs a date when the schedule has none', async () => {
    w.sched = sched({ next_due_at: null });
    expect((await call(await make(), 'POST', `/followups/${S}/reminders`, { channel: 'sms' })).statusCode).toBe(400);
  });
  it('stopping works for the clinician, 404 for a stranger, 400 for a bad id', async () => {
    const app = await make();
    expect((await call(app, 'POST', `/followups/${S}/stop`, undefined, 'outsider')).statusCode).toBe(404);
    expect((await call(app, 'POST', '/followups/not-a-uuid/stop')).statusCode).toBe(400);
    expect((await call(app, 'POST', `/followups/${S}/stop`)).statusCode).toBe(200); expect(w.stopped).toEqual([S]);
  });
});
