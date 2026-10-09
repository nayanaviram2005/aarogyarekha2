import type { SupabaseClient } from '@supabase/supabase-js';
import { DbError, type PatientBrief, type ReferralBoard, type ReferralBoardRow } from '../deps.js';

const COLS = 'id, encounter_id, patient_id, from_facility_id, to_facility_id, priority, reason_text, status, status_reason, sent_at, updated_at';

export function makeReferralBoard(sb: SupabaseClient, briefCols: string): ReferralBoard {
  return {
    async list(side, facilityIds, statuses, limit) {
      if (facilityIds.length === 0 || statuses.length === 0) return [];
      const q = sb.from('referrals').select(`${COLS}, patient:patients(${briefCols})`)
        .in(side === 'incoming' ? 'to_facility_id' : 'from_facility_id', facilityIds).in('status', statuses)
        .neq('status', 'draft').order('sent_at', { ascending: false, nullsFirst: false }).limit(limit);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as (Omit<ReferralBoardRow, 'patient'> & { patient: PatientBrief | PatientBrief[] | null })[])
        .map(r => ({ ...r, patient: Array.isArray(r.patient) ? r.patient[0] ?? null : r.patient }));
    },
    async respond(id, to, note) {
      const { data, error } = await sb.from('referrals').update({ status: to, status_reason: note }).eq('id', id).select('id');
      if (error) throw new DbError(error.code ?? 'XX000', error.message);
      if ((data ?? []).length !== 1) throw new DbError('42501', 'not allowed');
    },
  };
}
