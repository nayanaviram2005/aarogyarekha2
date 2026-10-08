// Turns the engine's "missing information" into follow-up questions for the health worker, most useful first.
// "Most useful" = the question whose answer could move the tier furthest (smallest potential tier first).
// Questions only ask for information. They never suggest what the answer means or what to do about it.
import type { RuleSet, Tier, TriageDecision } from '../triage/types.js';

export interface FollowUp {
  fieldCode: string;                      // matches triage_signals / info_requests.field_code, e.g. 'sign.central_cyanosis'
  audience: 'health_worker' | 'patient';
  question: string;
  lang: 'en';
  potentialTier: Tier | null;             // the tier this answer could lead to if it came back worst-case
  rank: number;                           // 1 = ask first
  /** Where the wording came from: the model, worded for this patient, or the rule set's own fixed text (used when no model is available). */
  wording: 'ai' | 'rules';
}

const GENERIC: Record<string, string> = {
  'vital.resp_rate_pm': 'Count and record the breathing rate (breaths per minute).',
  'vital.spo2_pct': 'Record oxygen saturation (SpO2), if a pulse oximeter is available.',
  'vital.bp_systolic_mmhg': 'Record the blood pressure.',
  'vital.pulse_bpm': 'Record the pulse rate (beats per minute).',
  'vital.temperature_c': 'Record the body temperature.',
  'vital.consciousness': 'How responsive is the patient: alert, confused, responds to voice, responds to pain only, or unresponsive?',
  'vital.oxygen': 'Is the patient on supplemental oxygen?',
  'vital.bp_pregnancy': 'Record the blood pressure (both readings).',
  'context.age': "What is the patient's age?",
  'context.pregnancy_status': 'Is the patient pregnant?',
};

export function buildFollowUps(missing: TriageDecision['missing'], rs: RuleSet, limit?: number, phrasing: Record<string, string> = {}): FollowUp[] {
  const bySign = new Map(rs.floors.map(f => [f.sign, f]));
  const items = missing.map(m => {
    const ai = m.code.startsWith('sign.') ? phrasing[m.code.slice(5)] : undefined;
    let question = ai ?? GENERIC[m.code];
    if (!question && m.code.startsWith('sign.')) question = bySign.get(m.code.slice(5))?.question;
    return { m, question: question ?? m.label, wording: (ai ? 'ai' : 'rules') as 'ai' | 'rules' };
  });
  items.sort((a, b) => (a.m.potentialTier ?? 9) - (b.m.potentialTier ?? 9) || (a.m.code < b.m.code ? -1 : 1));
  return (limit ? items.slice(0, limit) : items).map((x, i) => ({
    fieldCode: x.m.code, audience: 'health_worker', question: x.question, lang: 'en', potentialTier: x.m.potentialTier, rank: i + 1, wording: x.wording,
  }));
}
