import { TIER_WORD, tierOfUrgency, vitalLabel, vitalUnit } from './format';
import type { EncounterSummary } from './types';

export type TimelineKind = 'record' | 'reported' | 'measured' | 'rules' | 'reviewer';
export interface TimelineEvent { at: string; kind: TimelineKind; text: string; lang?: string }

export const KIND_LABEL: Record<TimelineKind, string> = { record: 'Record', reported: 'Reported', measured: 'Measured', rules: 'Rules', reviewer: 'Reviewer' };

const tierText = (u: string | null | undefined) => { const t = tierOfUrgency(u); return t ? `${TIER_WORD[t]} (priority ${t})` : 'no priority'; };
const unitWord = (v: number | string, unit: string) => (Number(v) === 1 ? unit.replace(/s$/, '') : unit);

export function buildTimeline(s: EncounterSummary): TimelineEvent[] {
  const out: (TimelineEvent & { order: number })[] = [];
  let order = 0;
  const add = (at: string | null | undefined, kind: TimelineKind, text: string, lang?: string) => { if (at && !Number.isNaN(Date.parse(at))) out.push({ at, kind, text, lang, order: order++ }); };

  add(s.encounter.created_at, 'record', 'Encounter opened');
  if (s.encounter.chief_complaint_original) add(s.encounter.created_at, 'reported', `Main complaint: ${s.encounter.chief_complaint_original}`, s.encounter.language);

  for (const x of s.symptoms) {
    const bits = [x.text_original];
    if (x.duration_value != null && x.duration_unit) bits.push(`for ${x.duration_value} ${unitWord(x.duration_value, x.duration_unit)}`);
    if (x.severity != null) bits.push(`severity ${x.severity} of 10`);
    add(x.created_at, 'reported', `Symptom: ${bits.join(', ')}`, x.lang ?? undefined);
  }
  for (const v of s.vitals) add(v.measured_at, 'measured', `${vitalLabel(v.kind)}: ${String(v.value)} ${vitalUnit(v.kind)}`.trim());

  if (s.encounter.submitted_at) add(s.encounter.submitted_at, 'record', 'Submitted for review');
  if (s.assessment) add(s.assessment.created_at, 'rules', `Rules assessment, version ${s.assessment.version}: ${tierText(s.assessment.urgency_code)}`);
  for (const r of s.reviews) {
    const who = r.reviewer_name ?? 'A reviewer';
    const what = r.action === 'approve' ? `${who} approved the rules result`
      : r.action === 'override_urgency' ? `${who} changed priority from ${tierText(r.from_urgency_code)} to ${tierText(r.to_urgency_code)}${r.reason ? `. Reason: ${r.reason}` : ''}`
      : `${who} recorded: ${r.action.replace(/_/g, ' ')}`;
    add(r.created_at, 'reviewer', what);
  }
  if (s.encounter.closed_at) add(s.encounter.closed_at, 'record', 'Encounter closed');

  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.order - b.order).map(({ order: _o, ...e }) => e);
}
