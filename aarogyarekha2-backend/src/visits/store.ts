import { VisitError, type DoneRow, type VisitFlow, type VisitOutcome } from '../deps.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

const map = (e: unknown): never => {
  const x = e as { code?: string; message?: string; hint?: string };
  if (x.code === '42883' || x.code === '42703') throw new VisitError('not_set_up', 'migration 0018 is not applied');
  if (x.code === '42501') throw new VisitError('forbidden', x.message ?? 'not allowed');
  if (x.code === 'P0002') throw new VisitError('not_found', x.message ?? 'not found');
  if (x.code === '55000') throw new VisitError(x.hint === 'review_first' ? 'review_first' : x.hint === 'taken' ? 'taken' : 'state', x.message ?? 'wrong state');
  if (x.code === '22023') throw new VisitError('invalid', x.message ?? 'invalid');
  throw e;
};

export function makeVisitFlow(db: Queryable): VisitFlow {
  return {
    async callIn(a) {
      try { const r = await db.query(`select app.call_in($1::uuid, $2::uuid) r`, [a.actor, a.encounterId]); return { status: r.rows[0].r.status as string }; }
      catch (e) { return map(e); }
    },
    async complete(a) {
      try { const r = await db.query(`select app.complete_visit($1::uuid, $2::uuid, $3) r`, [a.actor, a.encounterId, a.outcome]); return { outcome: r.rows[0].r.outcome as VisitOutcome, queueStatus: r.rows[0].r.queueStatus as string }; }
      catch (e) { return map(e); }
    },
    async done(facilityIds, hours): Promise<DoneRow[]> {
      if (facilityIds.length === 0) return [];
      let r;
      try { r = await db.query(
        `select e.id, e.facility_id, e.status::text status, e.outcome, coalesce(e.closed_at, e.updated_at) finished_at, e.closed_by,
                p.public_ref, p.full_name, p.sex::text sex, q.urgency_code, q.entered_at, q.called_at, cp.display_name closed_by_name
           from public.encounters e
           join public.patients p on p.id = e.patient_id
           left join public.queue_items q on q.encounter_id = e.id
           left join public.profiles cp on cp.user_id = e.closed_by
          where e.facility_id = any($1::uuid[]) and e.deleted_at is null and e.status in ('closed', 'referred')
            and coalesce(e.closed_at, e.updated_at) >= now() - ($2::int * interval '1 hour')
          order by coalesce(e.closed_at, e.updated_at) desc limit 200`, [facilityIds, hours]); } catch (e) { return map(e); }
      return r.rows.map(x => ({
        encounterId: x.id, facilityId: x.facility_id, patientRef: x.public_ref, patientName: x.full_name, sex: x.sex,
        urgencyCode: x.urgency_code ?? null, outcome: (x.outcome ?? (x.status === 'referred' ? 'referred' : null)) as VisitOutcome | null,
        finishedAt: new Date(x.finished_at).toISOString(), by: x.closed_by_name ?? null,
        waitedMinutes: x.entered_at && x.called_at ? Math.max(0, Math.round((Date.parse(x.called_at) - Date.parse(x.entered_at)) / 60000)) : null,
      }));
    },
  };
}
