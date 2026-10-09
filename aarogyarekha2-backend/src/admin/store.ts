import type { SupabaseClient } from '@supabase/supabase-js';
import { BreakGlassError, type AdminStore, type Analytics, type Spread, type SystemAdmin } from '../deps.js';
import type { AuditRow } from './suspicious.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }
interface Tx extends Queryable { release?: () => void }
interface TxSource extends Queryable { connect?: () => Promise<Tx> }

const CLINICAL = ['health_worker', 'nurse', 'doctor', 'medical_officer'];
const iso = (v: unknown) => new Date(v as string).toISOString();

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const spread = (r: { n: unknown; median: unknown; p90: unknown } | undefined): Spread => ({ n: Number(r?.n ?? 0), median: num(r?.median), p90: num(r?.p90) });

export function makeSystemAdmin(db: TxSource): SystemAdmin {
  return {
    async analytics(facilityIds, days): Promise<Analytics> {
      const empty: Analytics = { days, encounters: 0, submitted: 0, assessed: 0, reviewed: 0, byScenario: [], byUrgency: [], secondsToAssessment: { n: 0, median: null, p90: null }, minutesToReview: { n: 0, median: null, p90: null }, review: { approved: 0, changed: 0, loweredBelowRules: 0, agreementRate: null }, feedback: null };
      if (facilityIds.length === 0) return empty;
      const since = new Date(Date.now() - days * 86_400_000).toISOString(); const p = [facilityIds, since];
      const E = "select id, scenario, submitted_at from public.encounters where facility_id = any($1::uuid[]) and created_at >= $2::timestamptz and deleted_at is null";
      const [tot, sc, urg, ta, tr, rv, fb] = await Promise.all([
        db.query(`with e as (${E}) select (select count(*) from e) encounters, (select count(*) from e where submitted_at is not null) submitted,
                   (select count(distinct a.encounter_id) from public.triage_assessments a join e on e.id = a.encounter_id) assessed,
                   (select count(distinct r.encounter_id) from public.review_actions r join e on e.id = r.encounter_id where r.action in ('approve','override_urgency')) reviewed`, p),
        db.query(`with e as (${E}) select scenario, count(*)::int n from e group by scenario order by n desc`, p),
        db.query(`with e as (${E}), l as (select distinct on (a.encounter_id) a.encounter_id, a.urgency_code from public.triage_assessments a join e on e.id = a.encounter_id order by a.encounter_id, a.version desc)
                 select urgency_code urgency, count(*)::int n from l group by urgency_code order by n desc`, p),
        db.query(`with e as (${E}), f as (select a.encounter_id, min(a.created_at) at from public.triage_assessments a join e on e.id = a.encounter_id group by 1),
                   d as (select extract(epoch from (f.at - e.submitted_at)) s from f join e on e.id = f.encounter_id where e.submitted_at is not null and f.at >= e.submitted_at)
                 select count(*) n, percentile_cont(0.5) within group (order by s) median, percentile_cont(0.9) within group (order by s) p90 from d`, p),
        db.query(`with e as (${E}), q as (select qi.encounter_id, qi.entered_at from public.queue_items qi join e on e.id = qi.encounter_id),
                   f as (select r.encounter_id, min(r.created_at) at from public.review_actions r join e on e.id = r.encounter_id where r.action in ('approve','override_urgency') group by 1),
                   d as (select extract(epoch from (f.at - q.entered_at)) / 60 m from f join q on q.encounter_id = f.encounter_id where f.at >= q.entered_at)
                 select count(*) n, percentile_cont(0.5) within group (order by m) median, percentile_cont(0.9) within group (order by m) p90 from d`, p),
        db.query(`with e as (${E}), r as (select r.* from public.review_actions r join e on e.id = r.encounter_id where r.action in ('approve','override_urgency')),
                   rk as (select code, case code when 'red' then 1 when 'orange' then 2 when 'yellow' then 3 when 'green' then 4 end k from public.urgency_levels)
                 select count(*) filter (where r.action = 'approve') approved, count(*) filter (where r.action = 'override_urgency') changed,
                        count(*) filter (where r.action = 'override_urgency' and tk.k > fk.k) lowered
                 from r left join rk fk on fk.code = r.from_urgency_code left join rk tk on tk.code = r.to_urgency_code`, p),
        db.query(`select to_regclass('public.reviewer_notes') t`).then(async x => (x.rows[0]?.t ? db.query(`with e as (${E}) select count(*) filter (where n.kind = 'feedback_up') up, count(*) filter (where n.kind = 'feedback_down') down from public.reviewer_notes n join e on e.id = n.encounter_id`, p) : null)),
      ]);
      const t = tot.rows[0] ?? {}; const r = rv.rows[0] ?? {};
      const approved = Number(r.approved ?? 0), changed = Number(r.changed ?? 0);
      return {
        days, encounters: Number(t.encounters ?? 0), submitted: Number(t.submitted ?? 0), assessed: Number(t.assessed ?? 0), reviewed: Number(t.reviewed ?? 0),
        byScenario: sc.rows.map(x => ({ scenario: x.scenario, n: Number(x.n) })), byUrgency: urg.rows.map(x => ({ urgency: x.urgency, n: Number(x.n) })),
        secondsToAssessment: spread(ta.rows[0]), minutesToReview: spread(tr.rows[0]),
        review: { approved, changed, loweredBelowRules: Number(r.lowered ?? 0), agreementRate: approved + changed > 0 ? Math.round((approved / (approved + changed)) * 1000) / 1000 : null },
        feedback: fb ? { helpful: Number(fb.rows[0]?.up ?? 0), notHelpful: Number(fb.rows[0]?.down ?? 0) } : null,
      };
    },

    async verifyChain() {
      const n = await db.query('select count(*)::int as n from public.audit_events');
      const b = await db.query('select broken_id from app.verify_audit_chain(0)');
      return { checked: n.rows[0].n as number, brokenIds: b.rows.map(r => Number(r.broken_id)) };
    },

    async listBreakGlass(facilityIds, limit) {
      if (facilityIds.length === 0) return [];
      const r = await db.query(
        `select b.id, b.user_id, p.public_ref as patient_ref, b.facility_id, b.reason, b.created_at, b.expires_at, b.reviewed_by, b.reviewed_at
           from public.break_glass_grants b join public.patients p on p.id = b.patient_id
          where b.facility_id = any($1::uuid[]) order by b.created_at desc limit $2`, [facilityIds, limit]);
      return r.rows.map(x => ({ id: x.id, user_id: x.user_id, patient_ref: x.patient_ref, facility_id: x.facility_id, reason: x.reason, created_at: iso(x.created_at), expires_at: iso(x.expires_at), reviewed_by: x.reviewed_by ?? null, reviewed_at: x.reviewed_at ? iso(x.reviewed_at) : null }));
    },

    async grantBreakGlass(a) {
      const p = await db.query('select id, public_ref from public.patients where upper(public_ref) = upper($1) and deleted_at is null', [a.publicRef]);
      if (p.rows.length !== 1) throw new BreakGlassError('not_found', 'No patient has that record number.');
      const m = await db.query('select 1 from public.memberships where user_id = $1 and facility_id = $2 and is_active and role::text = any($3::text[])', [a.userId, a.facilityId, CLINICAL]);
      if (m.rows.length === 0) throw new BreakGlassError('forbidden', 'Only clinical staff at that facility can use emergency access.');
      const g = await db.query('insert into public.break_glass_grants (user_id, patient_id, facility_id, reason) values ($1,$2,$3,$4) returning id, expires_at', [a.userId, p.rows[0].id, a.facilityId, a.reason]);
      return { id: g.rows[0].id as string, patientId: p.rows[0].id as string, publicRef: p.rows[0].public_ref as string, expiresAt: iso(g.rows[0].expires_at) };
    },
  };
}

export function makeAdminStore(sb: SupabaseClient): AdminStore {
  return {
    async recentAudit(sinceIso, limit) {
      const { data, error } = await sb.from('audit_events').select('id, occurred_at, actor_user_id, actor_role, facility_id, action, entity_type, outcome, patient_id, ip')
        .gte('occurred_at', sinceIso).order('occurred_at', { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AuditRow[];
    },
    async reviewBreakGlass(id, reviewerId) {
      const { data, error } = await sb.from('break_glass_grants').update({ reviewed_by: reviewerId, reviewed_at: new Date().toISOString() }).eq('id', id).is('reviewed_at', null).select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    },
    async patientEncounters(patientId) {
      const { data, error } = await sb.from('encounters').select('id, status, scenario, created_at').eq('patient_id', patientId).is('deleted_at', null).order('created_at', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as { id: string; status: string; scenario: string; created_at: string }[];
    },
  };
}
