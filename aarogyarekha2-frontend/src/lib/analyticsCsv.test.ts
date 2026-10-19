import { describe, expect, it } from 'vitest';
import { analyticsCsv, analyticsFilename } from './analyticsCsv';
import type { AnalyticsView } from './types';

const view = (over: Partial<AnalyticsView> = {}): AnalyticsView => ({
  days: 30, referralsSent: 2, perDay: [{ day: '2026-10-01', n: 4 }, { day: '2026-10-02', n: 7 }], encounters: 11, submitted: 10, assessed: 9, reviewed: 8,
  byScenario: [{ scenario: 'opd_queue', n: 6 }, { scenario: 'campus_fever', n: 5 }], byUrgency: [{ urgency: 'red', n: 1 }, { urgency: 'green', n: 5 }],
  secondsToAssessment: { n: 9, median: 12.5, p90: 40 }, minutesToReview: { n: 8, median: null, p90: null },
  review: { approved: 6, changed: 2, loweredBelowRules: 1, agreementRate: 0.75 }, feedback: null, note: 'n', ...over,
});

describe('analyticsCsv', () => {
  it('has the headline numbers, one row per day, and the splits, with Windows line ends', () => {
    const csv = analyticsCsv(view(), new Date('2026-10-19T10:00:00Z')); const lines = csv.split('\r\n');
    expect(lines).toContain('Visits started,11'); expect(lines).toContain('Agreement rate,75%'); expect(lines).toContain('Generated on,2026-10-19');
    expect(lines).toContain('2026-10-01,4'); expect(lines).toContain('2026-10-02,7'); expect(lines.some(l => /^Immediate|^Red/i.test(l))).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true); expect(csv).not.toContain('\n\n');
  });
  it('leaves a blank for figures with no data instead of writing null', () => {
    const csv = analyticsCsv(view({ review: { approved: 0, changed: 0, loweredBelowRules: 0, agreementRate: null } }));
    expect(csv).toContain('Agreement rate,\r\n'); expect(csv).toContain('"Minutes until a reviewer acts, typical",\r\n'); expect(csv).not.toContain('null');
  });
  it('quotes cells with commas and quotes, and defuses text a spreadsheet would run as a formula', () => {
    const csv = analyticsCsv(view({ byScenario: [{ scenario: '=HYPERLINK("x")', n: 1 }] }));
    expect(csv).toContain('"\'=HYPERLINK(""x"")",1');
    expect(csv.split('\r\n')[0]).toBe('AarogyaRekha activity and agreement'); expect(csv).toContain('Figures are counts of visits');
  });
  it('names the file by period and date', () => { expect(analyticsFilename(90, new Date('2026-10-19T00:00:00Z'))).toBe('aarogyarekha-activity-90days-2026-10-19.csv'); });
});
