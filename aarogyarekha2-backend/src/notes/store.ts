import type { SupabaseClient } from '@supabase/supabase-js';
import { DbError, type NoteRow, type NotesStore } from '../deps.js';

const COLS = 'id, encounter_id, assessment_id, author_id, kind, body, created_at';

export function makeNotesStore(sb: SupabaseClient, userId: string): NotesStore {
  return {
    async list(encounterId) {
      const { data, error } = await sb.from('reviewer_notes').select(COLS).eq('encounter_id', encounterId).order('created_at', { ascending: true });
      if (error) throw new DbError(error.code ?? 'XX000', error.message);
      return (data ?? []) as unknown as NoteRow[];
    },
    async add(a) {
      const { data, error } = await sb.from('reviewer_notes').insert({ encounter_id: a.encounterId, assessment_id: a.assessmentId ?? null, author_id: userId, kind: a.kind, body: a.body ?? null }).select('id').single();
      if (error) throw new DbError(error.code ?? 'XX000', error.message);
      return { id: (data as unknown as { id: string }).id };
    },
  };
}
