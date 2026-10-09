import type { NotifyContext, SmsLogRow, SmsStore } from './notify.js';
import type { Tier } from './messages.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

export function makeSmsStore(db: Queryable): SmsStore {
  return {
    async context(encounterId): Promise<NotifyContext | null> {
      const r = await db.query(
        `select e.patient_id, e.facility_id, f.name facility_name, p.full_name, p.preferred_language, p.phone,
                exists (select 1 from public.consents c where c.patient_id = e.patient_id and c.purpose::text = 'status_messages' and c.revoked_at is null
                          and c.granted_at <= now() and (c.expires_at is null or c.expires_at > now())) consent_active,
                (select l.tier from public.sms_log l where l.encounter_id = e.id and l.result = 'sent' order by l.created_at desc, l.id desc limit 1) last_tier
           from public.encounters e join public.patients p on p.id = e.patient_id join public.facilities f on f.id = e.facility_id
          where e.id = $1::uuid and e.deleted_at is null`, [encounterId]);
      const x = r.rows[0]; if (!x) return null;
      return { patientId: x.patient_id, facilityId: x.facility_id, facilityName: x.facility_name ?? 'the facility', fullName: x.full_name ?? null, language: x.preferred_language ?? null,
               phone: x.phone ?? null, consentActive: x.consent_active === true, lastTier: x.last_tier == null ? null : (Number(x.last_tier) as Tier) };
    },
    async log(row: SmsLogRow) {
      await db.query(
        `insert into public.sms_log (encounter_id, patient_id, facility_id, kind, tier, language, result, reason, provider, provider_id, segments)
         values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [row.encounterId, row.patientId, row.facilityId, row.kind, row.tier, row.language, row.result, row.reason, row.provider, row.providerId, row.segments]);
    },
    async revokeByPhone(phone) {
      const r = await db.query(`select app.revoke_sms_consents($1) r`, [phone]);
      return Number(r.rows[0]?.r?.revoked ?? 0);
    },
  };
}
