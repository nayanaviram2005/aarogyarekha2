// Database side of the reminder worker. System path (database connection), not a user's session.
import type { DueReminder, ReminderStore } from './core.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }

/**
 * Claiming marks the rows 'sent' in the SAME statement that selects them (skip locked), so two runners can never pick the same
 * reminder and a reminder is never sent twice. If sending then fails, markFailed flips it to 'failed'. At-most-once on purpose.
 */
export function makeReminderStore(db: Queryable): ReminderStore {
  return {
    async claimDue(now: Date, limit: number): Promise<DueReminder[]> {
      const r = await db.query(
        `with picked as (
           select r.id from public.reminders r join public.followup_schedules s on s.id = r.schedule_id
           where r.status = 'scheduled' and r.due_at <= $1::timestamptz and s.active
           order by r.due_at limit $2 for update of r skip locked),
         upd as (
           update public.reminders r set status = 'sent', sent_at = $1::timestamptz from picked where r.id = picked.id
           returning r.id, r.channel, r.due_at, r.schedule_id, r.consent_id)
         select upd.id, upd.channel, upd.due_at, f.name as facility_name, p.preferred_language as language, p.phone,
                exists (select 1 from public.consents c where c.id = upd.consent_id and c.revoked_at is null and (c.expires_at is null or c.expires_at > $1::timestamptz)) as consent_active
         from upd join public.followup_schedules s on s.id = upd.schedule_id
                  join public.patients p on p.id = s.patient_id
                  join public.facilities f on f.id = s.facility_id
         order by upd.due_at`, [now.toISOString(), limit]);
      return r.rows.map(x => ({ id: x.id, channel: x.channel, dueAt: new Date(x.due_at).toISOString(), facilityName: x.facility_name, language: x.language ?? 'en', phone: x.phone ?? null, consentActive: x.consent_active === true }));
    },
    async markSent(id: string, at: Date) {
      // Already 'sent' from the claim. Move a repeating schedule on to its next date, counted from the last due date.
      await db.query(
        `update public.followup_schedules s set next_due_at = s.next_due_at + (s.cadence_days || ' days')::interval
         where s.id = (select schedule_id from public.reminders where id = $1) and s.cadence_days is not null and s.next_due_at is not null and s.next_due_at <= $2::timestamptz`, [id, at.toISOString()]);
    },
    async markFailed(id: string) {
      await db.query(`update public.reminders set status = 'failed', sent_at = null where id = $1`, [id]);
    },
  };
}
