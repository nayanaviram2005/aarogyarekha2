import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeStatusSms } from '../src/sms/notify.js';
import { makeMockSender } from '../src/sms/twilio.js';
import { makeSmsStore } from '../src/sms/store.js';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const F = randomUUID(), P1 = randomUUID(), P2 = randomUUID(), P3 = randomUUID(), U = randomUUID();
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
const store = () => makeSmsStore({ query: async (sql, p) => ({ rows: (await db.query(sql, p as any[])).rows as any[] }) });
const consent = (p: string, purpose: string) => db.query(`insert into public.consents (patient_id, purpose, method, notice_version, given_by) values ($1, $2::public.consent_purpose, 'verbal_witnessed', 'v', 'self')`, [p, purpose]);
const encounter = async (patient: string) => { const e = randomUUID(); await db.query(`insert into public.encounters (id, patient_id, facility_id, status) values ($1,$2,$3,'submitted')`, [e, patient, F]); return e; };

beforeAll(async () => {
  db = await makeDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'n@t.test')`, [U]);
  await db.query(`insert into public.facilities (id, name, type) values ($1, 'Seed PHC', 'phc')`, [F]);
  await db.query(`insert into public.patients (id, registered_facility_id, full_name, preferred_language, phone) values ($1,$4,'Asha Rao','hi','+919876543210'), ($2,$4,'Ravi Das','en','09876543210'), ($3,$4,'Meera Sahu','or','8888888888')`, [P1, P2, P3, F]);
  await db.query(`insert into public.memberships (user_id, facility_id, role) values ($1,$2,'nurse')`, [U, F]);
});

describe('the schema', () => {
  it('has the new consent purpose and the log table with its checks', async () => {
    const e = await rows(`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'consent_purpose' order by e.enumsortorder`);
    expect(e.map(x => x.enumlabel)).toContain('status_messages');
    const ok = await rows(`select count(*)::int n from information_schema.columns where table_name = 'sms_log' and column_name in ('phone', 'body', 'text', 'message')`);
    expect(ok[0].n).toBe(0);
  });
  it('rejects values outside the allowed lists', async () => {
    const e = await encounter(P1);
    const ins = (kind: string, tier: number, lang: string, result: string, reason: string | null) => db.query(`insert into public.sms_log (encounter_id, patient_id, facility_id, kind, tier, language, result, reason, provider) values ($1,$2,$3,$4,$5,$6,$7,$8,'mock')`, [e, P1, F, kind, tier, lang, result, reason]);
    await expect(ins('status', 5, 'en', 'sent', null)).rejects.toThrow(); await expect(ins('status', 1, 'fr', 'sent', null)).rejects.toThrow(); await expect(ins('spam', 1, 'en', 'sent', null)).rejects.toThrow();
    await expect(ins('status', 1, 'en', 'sent', 'because')).rejects.toThrow(); await ins('status', 1, 'en', 'sent', null);
  });
  it('signed-in users can only read the log (clinicians at the facility), never write it', async () => {
    const g = await rows(`select has_table_privilege('authenticated', 'public.sms_log', 'select') s, has_table_privilege('authenticated', 'public.sms_log', 'insert') i, has_table_privilege('authenticated', 'public.sms_log', 'update') u, has_table_privilege('anon', 'public.sms_log', 'select') a`);
    expect(g[0]).toEqual({ s: true, i: false, u: false, a: false });
    expect((await rows(`select relrowsecurity r from pg_class where relname = 'sms_log'`))[0].r).toBe(true);
  });
});

describe('the store\'s own SQL', () => {
  it('reads what the notifier needs: first facts, consent and the last status sent', async () => {
    const e = await encounter(P1); const s = store();
    expect(await s.context(e)).toMatchObject({ patientId: P1, facilityId: F, facilityName: 'Seed PHC', fullName: 'Asha Rao', language: 'hi', phone: '+919876543210', consentActive: false, lastTier: null });
    await consent(P1, 'status_messages'); expect((await s.context(e))!.consentActive).toBe(true);
    await s.log({ encounterId: e, patientId: P1, facilityId: F, kind: 'status', tier: 3, language: 'hi', result: 'sent', reason: null, provider: 'mock', providerId: 'M1', segments: 2 });
    await s.log({ encounterId: e, patientId: P1, facilityId: F, kind: 'status', tier: 2, language: 'hi', result: 'skipped', reason: 'no_phone', provider: 'mock', providerId: null, segments: null });
    expect((await s.context(e))!.lastTier).toBe(3);
  });
  it('an unknown encounter is null; a revoked or expired consent does not count', async () => {
    expect(await store().context(randomUUID())).toBeNull();
    const e = await encounter(P2); await consent(P2, 'status_messages'); await db.query(`update public.consents set revoked_at = now() where patient_id = $1`, [P2]); expect((await store().context(e))!.consentActive).toBe(false);
  });
  it('the whole flow: consent, sign-off, one message, and a later lower status sends the gentle one', async () => {
    const e = await encounter(P3); await consent(P3, 'status_messages'); const sender = makeMockSender(); const svc = makeStatusSms(store(), sender);
    expect((await svc.afterSignOff({ encounterId: e, effectiveUrgency: 'orange' })).status).toBe('sent'); expect(sender.sent).toHaveLength(1); expect(sender.sent[0]!.to).toBe('+918888888888'); expect(sender.sent[0]!.body).toMatch(/[଀-୿]/);
    expect((await svc.afterSignOff({ encounterId: e, effectiveUrgency: 'orange' })).reason).toBe('duplicate'); expect(sender.sent).toHaveLength(1);
    expect((await svc.afterSignOff({ encounterId: e, effectiveUrgency: 'yellow' })).kind).toBe('moved_down'); expect(sender.sent).toHaveLength(2);
    const log = await rows(`select kind, tier, result from public.sms_log where encounter_id = $1 order by created_at, id`, [e]); expect(log).toEqual([{ kind: 'status', tier: 2, result: 'sent' }, { kind: 'moved_down', tier: 3, result: 'sent' }]);
  });
});

describe('STOP: app.revoke_sms_consents', () => {
  it('ends the status and reminder consents of every patient with that number (any way of writing it), and nothing else', async () => {
    const a = randomUUID(), b = randomUUID(), other = randomUUID();
    await db.query(`insert into public.patients (id, registered_facility_id, full_name, phone) values ($1,$4,'Fam One','+917777777777'), ($2,$4,'Fam Two','07777777777'), ($3,$4,'Not Them','+916666666666')`, [a, b, other, F]);
    for (const p of [a, b, other]) { await consent(p, 'status_messages'); await consent(p, 'reminders'); await consent(p, 'care_triage'); }
    const r = (await rows(`select app.revoke_sms_consents('+91 7777777777') r`))[0].r; expect(r.revoked).toBe(4);
    const left = await rows(`select patient_id, purpose::text p from public.consents where revoked_at is null and patient_id in ($1,$2,$3) order by 1, 2`, [a, b, other]);
    expect(left.filter(x => x.patient_id === a || x.patient_id === b).map(x => x.p)).toEqual(['care_triage', 'care_triage']);
    expect(left.filter(x => x.patient_id === other).map(x => x.p).sort()).toEqual(['care_triage', 'reminders', 'status_messages']);
    const audit = (await rows(`select details from public.audit_events where entity_type = 'consent' order by id desc limit 1`))[0].details; expect(audit).toMatchObject({ op: 'sms_stop', revoked: 4 }); expect(JSON.stringify(audit)).not.toMatch(/7777777777/);
  });
  it('refuses something that is not a phone number, and is callable only by the service role', async () => {
    await expect(rows(`select app.revoke_sms_consents('12')`)).rejects.toThrow();
    const r = await rows(`select has_function_privilege('authenticated', 'app.revoke_sms_consents(text)', 'execute') a, has_function_privilege('anon', 'app.revoke_sms_consents(text)', 'execute') b, has_function_privilege('service_role', 'app.revoke_sms_consents(text)', 'execute') c`);
    expect(r[0]).toEqual({ a: false, b: false, c: true });
  });
});
