import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeDb } from './helpers/pg.js';

let db: PGlite;
const rows = async (sql: string, p: unknown[] = []) => (await db.query(sql, p as any[])).rows as any[];
beforeAll(async () => { db = await makeDb(); });

describe('extracted_fields second read', () => {
  it('has the two nullable columns', async () => {
    const c = await rows(`select column_name, is_nullable from information_schema.columns where table_name = 'extracted_fields' and column_name in ('second_read','agreement') order by 1`);
    expect(c).toEqual([{ column_name: 'agreement', is_nullable: 'YES' }, { column_name: 'second_read', is_nullable: 'YES' }]);
  });
  it('agreement only accepts the four values, and second_read is length-capped', async () => {
    const defs = (await rows(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.extracted_fields'::regclass and conname in ('extracted_fields_agreement_chk','extracted_fields_second_read_len_chk')`));
    expect(defs).toHaveLength(2);
    const text = defs.map(x => x.d).join(' '); for (const v of ['agree', 'differ', 'ocr_only', 'ai_only']) expect(text).toContain(v); expect(text).toContain('80');
  });
  it('signed-in users still cannot write the new columns (the update grant names its columns)', async () => {
    const g = await rows(`select has_column_privilege('authenticated', 'public.extracted_fields', 'second_read', 'update') a, has_column_privilege('authenticated', 'public.extracted_fields', 'agreement', 'update') b, has_column_privilege('authenticated', 'public.extracted_fields', 'value_num', 'update') c`);
    expect(g[0]).toEqual({ a: false, b: false, c: true });
  });
});
