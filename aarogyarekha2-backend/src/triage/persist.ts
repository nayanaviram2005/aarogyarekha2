// Runs the triage engine for an encounter and stores the result: assessment, signals, queue entry.
//
//  * The rule set is LOADED FROM THE DATABASE (versioned data) and must be 'approved'. Its stored definition must hash to
//    the value in its own row, so a silent edit to the stored rules is detected.
//  * Every string that will be stored passes the non-diagnostic guard first.
//  * One transaction; the encounter row is locked so two concurrent runs cannot produce the same assessment version.
//  * The queue is ESCALATE-ONLY here: a re-run can raise an item's urgency, never lower it. A lower result is reported
//    as `downgradeSuggested` for a reviewer to confirm (design rule: downgrades need a human).
import { assertNoteNonDiagnostic } from '../guard/nonDiagnostic.js';
import { hashRuleSet, triage } from './engine.js';
import type { RuleSet, Tier, TriageDecision, TriageInput } from './types.js';

export interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }
export interface PoolLike { connect(): Promise<Queryable & { release(): void }> }

export class RuleSetUnavailable extends Error {
  constructor(public readonly reason: 'not_found' | 'not_approved' | 'integrity', detail: string) { super(`Rule set unavailable (${reason}): ${detail}`); }
}

export const DISCLAIMER = 'Organises information for review. Does not diagnose or advise treatment.';

export async function loadRuleSet(db: Queryable, name: string, version: string): Promise<{ id: string; ruleSet: RuleSet }> {
  const r = await db.query('select id, status, definition from public.triage_rule_sets where name = $1 and version = $2', [name, version]);
  const row = r.rows[0];
  if (!row) throw new RuleSetUnavailable('not_found', `${name}@${version}`);
  if (row.status !== 'approved') throw new RuleSetUnavailable('not_approved', `${name}@${version} is ${row.status}`);
  const def = row.definition as RuleSet & { integrityHash?: string };
  const ruleSet: RuleSet = { ...def, name, version, status: 'approved' };
  if (!def.integrityHash || def.integrityHash !== hashRuleSet(ruleSet))
    throw new RuleSetUnavailable('integrity', `${name}@${version} stored rules do not match their recorded hash`);
  return { id: row.id, ruleSet };
}

/** The AI second opinion, when there was one. Stored in the assessment note so a reviewer sees it beside the rules result. */
export interface StoredAiOpinion { tier: Tier; reason: string; provider: string; model: string }
export interface PersistArgs { encounterId: string; facilityId: string; ruleSetName: string; ruleSetVersion: string; input: TriageInput; aiOpinion?: StoredAiOpinion | null }
export interface PersistResult { assessmentId: string; version: number; decision: TriageDecision; queueUrgency: string; downgradeSuggested: boolean; ruleSet: RuleSet }

export async function assessEncounter(pool: PoolLike, a: PersistArgs): Promise<PersistResult> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    const { id: ruleSetId, ruleSet } = await loadRuleSet(db, a.ruleSetName, a.ruleSetVersion);
    const decision = triage(a.input, ruleSet);

    const derived = {
      tier: decision.tier, potentialTier: decision.potentialTier,
      winning: decision.winning, log: decision.log,
      missing: decision.missing, news2: decision.news2,
      vulnerable: decision.vulnerable, insufficientData: decision.insufficientData,
      ruleSet: decision.ruleSet,
    };
    // Guard the engine-derived content. The fixed disclaimer is added AFTER: it is a constant we write, and it
    // legitimately contains the words the guard exists to block ("does not diagnose"). Do not loosen the guard for it.
    assertNoteNonDiagnostic(derived);                                     // throws NonDiagnosticViolation
    // The AI's reason was already checked by the non-diagnostic guard when it was received; it is checked again here with the rest.
    let aiOpinion: Record<string, unknown> | undefined;
    if (a.aiOpinion) {
      const rulesTier = Math.min(...decision.log.filter(l => l.layer !== 'external').map(l => l.tier));
      aiOpinion = { tier: a.aiOpinion.tier, reason: a.aiOpinion.reason, provider: a.aiOpinion.provider, model: a.aiOpinion.model, machineGenerated: true, rulesTier, relation: a.aiOpinion.tier === rulesTier ? 'agrees' : a.aiOpinion.tier < rulesTier ? 'raised' : 'lower' };
      assertNoteNonDiagnostic(aiOpinion.reason);
    }
    const note = { disclaimer: DISCLAIMER, ...derived, ...(aiOpinion ? { aiOpinion } : {}) };
    for (const s of decision.signals) assertNoteNonDiagnostic(s.display_text);

    await db.query('select id from public.encounters where id = $1 for update', [a.encounterId]);   // serialise per encounter
    const v = await db.query('select coalesce(max(version), 0) + 1 as next from public.triage_assessments where encounter_id = $1', [a.encounterId]);
    const version = Number(v.rows[0].next);

    const ins = await db.query(
      `insert into public.triage_assessments (encounter_id, version, rule_set_id, basis, urgency_code, note, input_fingerprint, engine_version)
       values ($1, $2, $3, 'rules_engine', $4, $5::jsonb, $6, $7) returning id`,
      [a.encounterId, version, ruleSetId, decision.urgencyCode, JSON.stringify(note), decision.inputFingerprint, decision.engineVersion]);
    const assessmentId: string = ins.rows[0].id;

    for (const s of decision.signals)
      await db.query(
        `insert into public.triage_signals (assessment_id, signal_code, kind, source, weight, display_text, evidence)
         values ($1, $2, $3::public.signal_kind, $4::public.signal_source, $5, $6, $7::jsonb)`,
        [assessmentId, s.signal_code, s.kind, s.source, s.weight, s.display_text, JSON.stringify(s.evidence)]);

    // Escalate-only queue upsert: an existing entry changes only if the new urgency is strictly MORE urgent.
    await db.query(
      `insert into public.queue_items (encounter_id, facility_id, urgency_code, priority_score)
       values ($1, $2, $3, $4)
       on conflict (encounter_id) do update
         set urgency_code = excluded.urgency_code, priority_score = excluded.priority_score
         where (select rank from public.urgency_levels where code = excluded.urgency_code)
             < (select rank from public.urgency_levels where code = public.queue_items.urgency_code)`,
      [a.encounterId, a.facilityId, decision.urgencyCode, decision.tier]);
    const q = await db.query('select urgency_code from public.queue_items where encounter_id = $1', [a.encounterId]);
    const queueUrgency: string = q.rows[0].urgency_code;
    await db.query('commit');
    return { assessmentId, version, decision, queueUrgency, downgradeSuggested: queueUrgency !== decision.urgencyCode, ruleSet };
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}
