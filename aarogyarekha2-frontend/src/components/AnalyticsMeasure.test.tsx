import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsView, Api } from '../lib/types';
import { AnalyticsPanel } from './AnalyticsPanel';
import { MeasurementForm, MEASUREMENTS } from './MeasurementForm';

const an = (o: Partial<AnalyticsView> = {}): AnalyticsView => ({ days: 30, encounters: 128, submitted: 121, assessed: 118, reviewed: 96, byScenario: [{ scenario: 'opd_queue', n: 90 }], byUrgency: [{ urgency: 'red', n: 7 }, { urgency: 'green', n: 51 }], secondsToAssessment: { n: 118, median: 1.4, p90: 3.8 }, minutesToReview: { n: 96, median: 14.2, p90: 90 }, review: { approved: 81, changed: 15, loweredBelowRules: 2, agreementRate: 0.844 }, feedback: { helpful: 22, notHelpful: 3 }, note: 'Counts and times only.', ...o });

describe('AnalyticsPanel', () => {
  it('shows counts, typical and 9-in-10 times, agreement as a percentage, and the note', async () => {
    const api = { analytics: vi.fn().mockResolvedValue(an()) } as unknown as Api; render(<AnalyticsPanel api={api} />);
    expect(await screen.findByText('Counts and times only.')).toBeInTheDocument(); expect(screen.getByText('128')).toBeInTheDocument(); expect(screen.getByText('84.4%')).toBeInTheDocument();
    expect(screen.getByText(/Typical 1.4 seconds; 9 in 10 within 3.8 seconds/)).toBeInTheDocument(); expect(screen.getByText(/Typical 14.2 minutes; 9 in 10 within 1.5 hours/)).toBeInTheDocument();
    expect(screen.getByText(/15 \(2 to less urgent\)/)).toBeInTheDocument(); expect(screen.getByText(/22 helpful, 3 not helpful/)).toBeInTheDocument(); expect(screen.getByText(/Immediate 7/)).toBeInTheDocument();
  });
  it('says "no data" instead of inventing numbers', async () => {
    const api = { analytics: vi.fn().mockResolvedValue(an({ secondsToAssessment: { n: 0, median: null, p90: null }, review: { approved: 0, changed: 0, loweredBelowRules: 0, agreementRate: null }, feedback: null, byUrgency: [], byScenario: [] })) } as unknown as Api; render(<AnalyticsPanel api={api} />);
    expect(await screen.findByText('No data yet')).toBeInTheDocument(); expect(screen.getByText('no data')).toBeInTheDocument(); expect(screen.queryByText(/Feedback on drafts/)).not.toBeInTheDocument();
  });
  it('changing the period asks again', async () => {
    const f = vi.fn().mockResolvedValue(an()); render(<AnalyticsPanel api={{ analytics: f } as unknown as Api} />); await screen.findByText('128'); await userEvent.selectOptions(screen.getByLabelText('Period'), '90'); await waitFor(() => expect(f).toHaveBeenLastCalledWith(90));
  });
  it('a failure is shown in words', async () => { render(<AnalyticsPanel api={{ analytics: vi.fn().mockRejectedValue(new Error('The figures could not be worked out. Try again.')) } as unknown as Api} />); expect(await screen.findByRole('alert')).toHaveTextContent('could not be worked out'); });
});

describe('MeasurementForm', () => {
  const mk = (o: Record<string, unknown> = {}) => ({ addVital: vi.fn().mockResolvedValue({ id: 'v' }), ...o }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
  it('saves a typed reading in the chosen kind and says so', async () => {
    const a = mk(); const onSaved = vi.fn(); render(<MeasurementForm api={a} encounterId="e1" onSaved={onSaved} />);
    await userEvent.selectOptions(screen.getByLabelText('Measurement'), 'spo2_pct'); await userEvent.type(screen.getByLabelText(/Value/), '94'); await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(a.addVital).toHaveBeenCalledWith('e1', { kind: 'spo2_pct', value: 94 })); expect(onSaved).toHaveBeenCalled(); expect(await screen.findByRole('status')).toHaveTextContent('Oxygen saturation (SpO2) 94 % saved.');
  });
  it('stops a non-number or an impossible value before sending, naming the range', async () => {
    const a = mk(); render(<MeasurementForm api={a} encounterId="e1" onSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' })); expect(await screen.findByRole('alert')).toHaveTextContent('Type a number.');
    await userEvent.type(screen.getByLabelText(/Value/), '380'); await userEvent.click(screen.getByRole('button', { name: 'Save' })); expect(await screen.findByRole('alert')).toHaveTextContent('between 25 and 45'); expect(a.addVital).not.toHaveBeenCalled();
  });
  it('every kind has a sensible range and unit; a server error is shown', async () => {
    for (const m of MEASUREMENTS) { expect(m.min).toBeLessThan(m.max); expect(m.unit.length).toBeGreaterThan(0); }
    render(<MeasurementForm api={mk({ addVital: vi.fn().mockRejectedValue(new Error('The change could not be saved. Try again.')) })} encounterId="e1" onSaved={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Value/), '37'); await userEvent.click(screen.getByRole('button', { name: 'Save' })); expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
  });
});
