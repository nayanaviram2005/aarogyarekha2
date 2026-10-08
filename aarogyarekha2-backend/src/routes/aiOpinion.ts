// Gathers the AI second opinion for one assessment. Never throws: any problem becomes a status the reviewer can read, and the
// rules result stands alone. Needs the patient's separate consent to outside AI processing; every call is logged.
import type { FastifyRequest } from 'fastify';
import type { Deps } from '../deps.js';
import type { EncounterRow } from '../fhir/project.js';
import { AiError } from '../ai/provider.js';
import { PiiLeak } from '../ai/redact.js';
import { getAiOpinion, type Candidate } from '../ai/triageOpinion.js';
import { isConsentActive } from '../intake/consent.js';
import { loadRecordContext } from './records.js';
import { reportNotes } from '../ocr/recordContext.js';
import type { Tier, TriageInput } from '../triage/types.js';

export type AiOpinionStatus = 'ok' | 'not_set_up' | 'no_consent' | 'unavailable' | 'unusable';
export interface AiSecondOpinion { status: AiOpinionStatus; tier: Tier | null; reason: string | null; ask: string[] | null; phrasing: Record<string, string>; provider: string | null; model: string | null }
export const NO_OPINION = (status: AiOpinionStatus): AiSecondOpinion => ({ status, tier: null, reason: null, ask: null, phrasing: {}, provider: null, model: null });

export async function secondOpinion(deps: Deps, req: FastifyRequest, enc: EncounterRow, input: TriageInput, sex: string | null | undefined, candidates: Candidate[] = []): Promise<AiSecondOpinion> {
  const t = deps.triageAi ?? deps.translator;
  if (!t || t.name === 'mock') return NO_OPINION('not_set_up');
  try {
    const consents = await req.reader!.getConsents(enc.patient_id);
    const ai = consents.filter(x => x.purpose === 'external_ai_processing' && isConsentActive([x]))[0];
    if (!ai?.id) return NO_OPINION('no_consent');
    const [patient, summary] = await Promise.all([req.reader!.getPatient(enc.patient_id), req.reader!.getEncounterSummary(enc.id)]);
    if (!patient || !summary) return NO_OPINION('unavailable');

    // What the uploaded reports say, from rows a person has checked. A failure to load them never stops the opinion.
    const records = await loadRecordContext(req, enc.id).catch(() => []);
    const notes = reportNotes(records);
    const words = {
      complaint: enc.chief_complaint_translated ?? enc.chief_complaint_original,
      symptoms: summary.symptoms.map(s => ({ text: s.text_translated ?? s.text_original, duration: s.duration_value != null && s.duration_unit ? `${s.duration_value} ${s.duration_unit}` : null, severity: s.severity })),
      reportNotes: notes,
    };
    const known = { names: [patient.full_name], identifiers: [patient.public_ref, patient.phone] };
    let run;
    try { run = await getAiOpinion(t.generate, input, words, sex, known, candidates); }
    catch (err) {
      const status = err instanceof AiError ? (err.kind === 'timeout' ? 'timeout' : err.kind === 'rejected' ? 'rejected' : 'error') : 'error';
      if (err instanceof AiError && err.kind !== 'not_configured') await deps.logExternalRun({ encounterId: enc.id, consentId: ai.id, provider: t.name, model: t.model, items: 1, chars: 0, status, purpose: 'triage_opinion' }).catch(() => {});
      if (err instanceof PiiLeak) req.log.error({ reqId: req.id }, 'AI second opinion blocked: personal details would have been sent');
      else req.log.warn({ reqId: req.id, kind: err instanceof AiError ? err.kind : 'unknown' }, 'AI second opinion unavailable');
      return NO_OPINION(err instanceof AiError && err.kind === 'not_configured' ? 'not_set_up' : 'unavailable');
    }
    // The disclosure is recorded before the result is used. If it cannot be recorded, the opinion is not used.
    try { await deps.logExternalRun({ encounterId: enc.id, consentId: ai.id, provider: run.served.provider, model: run.served.model, items: 1, chars: run.sentChars, status: 'ok', purpose: 'triage_opinion' }); }
    catch { req.log.error({ reqId: req.id }, 'external run could not be logged; AI opinion not used'); return NO_OPINION('unavailable'); }
    if (!run.opinion) return NO_OPINION('unusable');
    return { status: 'ok', tier: run.opinion.tier, reason: run.opinion.reason, ask: run.opinion.ask, phrasing: run.opinion.phrasing, provider: run.served.provider, model: run.served.model };
  } catch (err) {
    req.log.warn({ reqId: req.id, err: (err as Error).message }, 'AI second opinion could not run');
    return NO_OPINION('unavailable');
  }
}

/** Compare with the rules' own result (every layer except the AI hint). The AI can only raise: `raised` is the only case that changes the stored tier. */
export function compareWithRules(ai: AiSecondOpinion, log: { layer: string; tier: Tier }[]) {
  const rulesTier = Math.min(...log.filter(l => l.layer !== 'external').map(l => l.tier)) as Tier;
  if (ai.tier == null) return { rulesTier, relation: null as null | 'agrees' | 'raised' | 'lower' };
  return { rulesTier, relation: (ai.tier === rulesTier ? 'agrees' : ai.tier < rulesTier ? 'raised' : 'lower') as 'agrees' | 'raised' | 'lower' };
}
