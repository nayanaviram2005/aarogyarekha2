import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsPanel } from './AnalyticsPanel';
import type { Api, AnalyticsView } from '../lib/types';

const view: AnalyticsView = { days: 30, referralsSent: 1, perDay: [{ day: '2026-10-01', n: 2 }], encounters: 2, submitted: 2, assessed: 2, reviewed: 1, byScenario: [], byUrgency: [], secondsToAssessment: { n: 0, median: null, p90: null }, minutesToReview: { n: 0, median: null, p90: null }, review: { approved: 1, changed: 0, loweredBelowRules: 0, agreementRate: 1 }, feedback: null, note: '' };

afterEach(() => vi.restoreAllMocks());

describe('AnalyticsPanel CSV', () => {
  it('downloads what is on the screen as a CSV file named by period', async () => {
    let blob: Blob | null = null; let name = '';
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { blob = b; return 'blob:x'; }, revokeObjectURL: () => {} }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download; });
    render(<AnalyticsPanel api={{ analytics: vi.fn().mockResolvedValue(view) } as unknown as Api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download as CSV' }));
    expect(click).toHaveBeenCalled(); expect(name).toMatch(/^aarogyarekha-activity-30days-\d{4}-\d{2}-\d{2}\.csv$/);
    expect((await (blob as unknown as Blob).text())).toContain('Visits started,2');
  });
});
