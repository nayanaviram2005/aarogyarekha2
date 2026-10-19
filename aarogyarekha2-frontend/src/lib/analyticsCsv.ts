import { scenarioLabel, TIER_WORD, tierOfUrgency } from './format';
import type { AnalyticsView } from './types';

const cell = (v: string | number | null): string => {
  const text = v === null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(text) && typeof v === 'string' ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const line = (...cells: (string | number | null)[]) => cells.map(cell).join(',');

export function analyticsCsv(a: AnalyticsView, generatedOn: Date = new Date()): string {
  const rows: string[] = [
    line('AarogyaRekha activity and agreement'),
    line('Period in days', a.days),
    line('Generated on', generatedOn.toISOString().slice(0, 10)),
    line('Figures are counts of visits on synthetic or real records as held by this system. Priorities are drafts until a reviewer signs them.'),
    '',
    line('Measure', 'Value'),
    line('Visits started', a.encounters),
    line('Submitted to the queue', a.submitted),
    line('Assessed by the rules', a.assessed),
    line('Signed off by a reviewer', a.reviewed),
    line('Referrals sent', a.referralsSent),
    line('Reviewer confirmed the priority', a.review.approved),
    line('Reviewer changed the priority', a.review.changed),
    line('Changed to less urgent', a.review.loweredBelowRules),
    line('Agreement rate', a.review.agreementRate === null ? null : Math.round(a.review.agreementRate * 1000) / 10 + '%'),
    line('Seconds to a draft assessment, typical', a.secondsToAssessment.median),
    line('Seconds to a draft assessment, 9 in 10 within', a.secondsToAssessment.p90),
    line('Minutes until a reviewer acts, typical', a.minutesToReview.median),
    line('Minutes until a reviewer acts, 9 in 10 within', a.minutesToReview.p90),
    '',
    line('Day', 'Visits'),
    ...a.perDay.map(d => line(d.day, d.n)),
    '',
    line('Priority', 'Visits'),
    ...a.byUrgency.map(u => { const t = tierOfUrgency(u.urgency); return line(t ? TIER_WORD[t] : u.urgency, u.n); }),
    '',
    line('Type of visit', 'Visits'),
    ...a.byScenario.map(s => line(scenarioLabel(s.scenario), s.n)),
  ];
  return rows.join('\r\n') + '\r\n';
}

export const analyticsFilename = (days: number, on: Date = new Date()) => `aarogyarekha-activity-${days}days-${on.toISOString().slice(0, 10)}.csv`;
