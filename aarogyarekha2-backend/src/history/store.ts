import type { SupabaseClient } from '@supabase/supabase-js';
import { DbError, type HistoryRow, type HistoryStore } from '../deps.js';

const COLS = 'id, patient_id, kind, text_original, lang, source, created_at, confirmed_by, confirmed_at';

export function makeHistoryStore(sb: SupabaseClient, userId: string): HistoryStore {
  return {
    async list(patientId) {
      const { data, error } = await sb.from('reported_history').select(COLS).eq('patient_id', patientId).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as HistoryRow[];
    },
    async add(a) {
      const { data, error } = await sb.from('reported_history').insert({ patient_id: a.patientId, kind: a.kind, text_original: a.text, lang: a.lang ?? null, source: 'health_worker', recorded_by: userId }).select('id').single();
      if (error) throw new DbError(error.code ?? 'XX000', error.message);
      return { id: (data as unknown as { id: string }).id };
    },
    async confirm(id) {
      const { data, error } = await sb.from('reported_history').update({ confirmed_by: userId, confirmed_at: new Date().toISOString() }).eq('id', id).is('confirmed_at', null).select('id');
      if (error) throw new DbError(error.code ?? 'XX000', error.message);
      return (data ?? []).length === 1;
    },
  };
}
