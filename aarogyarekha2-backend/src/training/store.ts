import type { TrainingCase } from './deidentify.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

export interface TrainingSummary { count: number; latestAt: string | null }
export interface TrainingStore {
  key: string;
  write(c: TrainingCase): Promise<void>;
  summary(): Promise<TrainingSummary>;
  list(limit: number): Promise<TrainingCase[]>;
}

export function makeDbStore(db: Queryable, key: string): TrainingStore {
  return {
    key,
    async write(c) {
      await db.query(
        `insert into public.training_cases (case_id, schema_version, features, engine, label, fhir, withheld_fields)
         values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
         on conflict (case_id) do nothing`,
        [c.caseId, c.schema, JSON.stringify(c.features), JSON.stringify(c.engine), JSON.stringify(c.label), JSON.stringify(c.fhir), c.withheldFields]);
    },
    async summary() {
      const r = await db.query('select count(*)::int as n, max(created_at) as latest from public.training_cases');
      const row = r.rows[0];
      return { count: row.n, latestAt: row.latest ? new Date(row.latest).toISOString() : null };
    },
    async list(limit) {
      const r = await db.query(
        'select case_id, schema_version, features, engine, label, fhir, withheld_fields from public.training_cases order by created_at, id limit $1', [limit]);
      return r.rows.map((x): TrainingCase => ({ caseId: x.case_id, schema: x.schema_version, features: x.features, engine: x.engine, label: x.label, withheldFields: x.withheld_fields, fhir: x.fhir }));
    },
  };
}
