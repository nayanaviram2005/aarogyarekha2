import { formatTime, latestVitals, TIER_WORD, tierOfUrgency, vitalLabel, vitalUnit } from './format';
import type { EncounterSummary } from './types';

export interface SummaryLine { label: string; text: string }

const unitWord = (v: number | string, unit: string) => (Number(v) === 1 ? unit.replace(/s$/, '') : unit);
const DAYS: Record<string, number> = { minute: 1 / 1440, minutes: 1 / 1440, hour: 1 / 24, hours: 1 / 24, day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30 };
const ago = (v: number | string | null, unit: string | null) => (v != null && unit ? Number(v) * (DAYS[unit] ?? 0) : -1);

export function buildCaseSummary(input: EncounterSummary): SummaryLine[] {
  const s = { ...input, symptoms: input.symptoms ?? [], vitals: input.vitals ?? [], reviews: input.reviews ?? [], followUps: input.followUps ?? [] };
  const out: SummaryLine[] = [];

  const complaint = s.encounter.chief_complaint_translated ?? s.encounter.chief_complaint_original;
  if (complaint) out.push({ label: 'Main complaint', text: complaint });

  const sym = [...s.symptoms].sort((a, b) => ago(b.duration_value, b.duration_unit) - ago(a.duration_value, a.duration_unit));
  if (sym.length) {
    out.push({
      label: 'Symptoms, longest first',
      text: sym.map(x => {
        const bits = [x.text_translated ?? x.text_original];
        if (x.duration_value != null && x.duration_unit) bits.push(`${x.duration_value} ${unitWord(x.duration_value, x.duration_unit)}`);
        if (x.severity != null) bits.push(`severity ${x.severity}/10`);
        return bits.join(', ');
      }).join('; '),
    });
  }

  const vit = latestVitals(s.vitals);
  if (vit.length) out.push({ label: 'Latest measurements', text: vit.map(v => `${vitalLabel(v.kind)} ${String(v.value)}${vitalUnit(v.kind) ? ' ' + vitalUnit(v.kind) : ''}`).join(', ') });

  if (s.encounter.submitted_at) out.push({ label: 'Submitted', text: formatTime(s.encounter.submitted_at) });

  if (s.assessment) {
    const t = tierOfUrgency(s.assessment.urgency_code);
    const ai = s.assessment.note.aiOpinion;
    out.push({ label: 'Rules result', text: `${t ? `${TIER_WORD[t]} (priority ${t})` : 'no priority'}, ${formatTime(s.assessment.created_at)}. ${s.assessment.note.winning.detail}${ai ? ` AI second opinion: ${TIER_WORD[ai.tier].toLowerCase()}.` : ''}` });
  }

  const last = [...s.reviews].reverse().find(r => !s.assessment || r.assessment_id === s.assessment.id);
  if (s.assessment) {
    if (!last) out.push({ label: 'Review', text: 'Not reviewed yet. This is a draft.' });
    else {
      const who = last.reviewer_name ?? 'A reviewer';
      const to = tierOfUrgency(last.to_urgency_code);
      out.push({ label: 'Review', text: last.action === 'override_urgency' ? `${who} changed the priority${to ? ` to ${TIER_WORD[to].toLowerCase()}` : ''}${last.reason ? `: ${last.reason}` : ''} (${formatTime(last.created_at)})` : `${who} approved the rules result (${formatTime(last.created_at)})` });
    }
  }

  const open = s.followUps.filter(f => f.status === 'open').length;
  if (open > 0) out.push({ label: 'Still open', text: `${open} question${open === 1 ? '' : 's'} to answer` });

  return out;
}
