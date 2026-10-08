import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '../lib/types';

const h = vi.hoisted(() => ({ entries: [] as unknown[], loading: false }));
vi.mock('./queueContext', () => ({ useQueue: () => ({ entries: h.entries, loading: h.loading, error: null, generatedAt: null, refresh: vi.fn() }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
import { ScenariosPage } from './ScenariosPage';

const ago = (hrs: number) => new Date(Date.now() - hrs * 3_600_000).toISOString();
const e = (over: Partial<QueueEntry> = {}): QueueEntry => ({ encounterId: Math.random().toString(36).slice(2), patient: { id: 'p', public_ref: 'AR-1', full_name: 'Test Person', sex: 'female', birth_date: null, age_years_reported: 20, preferred_language: 'en' }, scenario: 'campus_fever', chiefComplaint: 'fever', chiefComplaintTranslated: null, assessed: true, urgencyCode: 'yellow', tier: 3, potentialTier: null, missingCount: 0, winningLabel: null, vulnerable: false, queueStatus: 'waiting', waitingSince: ago(3), assessmentVersion: 1, engineTier: 3, reviewed: false, ...over });
const view = () => render(<MemoryRouter><ScenariosPage /></MemoryRouter>);

beforeEach(() => { h.entries = []; h.loading = false; });

describe('ScenariosPage', () => {
  it('has a tab per scenario with how many are waiting', () => {
    h.entries = [e(), e(), e({ scenario: 'occupational' })]; view();
    expect(screen.getByRole('tab', { name: 'Campus fever (2)' })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: 'Workplace (1)' })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: 'Health camp (0)' })).toBeInTheDocument();
  });
  it('below the alert count it shows a quiet count, with the count marked as a placeholder', () => {
    h.entries = [e(), e()]; view();
    expect(screen.getByRole('status')).toHaveTextContent('2 similar visits in the last 72 hours'); expect(screen.getByRole('status')).toHaveTextContent('placeholder');
  });
  it('at the alert count it raises a warning that says it is a count, not a finding about the cause', () => {
    h.entries = Array.from({ length: 5 }, () => e()); view();
    expect(screen.getByText('5 similar visits in the last 72 hours')).toBeInTheDocument();
    expect(screen.getByText(/not a finding about the cause/)).toBeInTheDocument(); expect(screen.getByText(/not set by a public-health authority/)).toBeInTheDocument();
  });
  it('old visits do not count towards the alert', () => {
    h.entries = Array.from({ length: 6 }, () => e({ waitingSince: ago(200) })); view();
    expect(screen.queryByText(/at or above the alert count/)).not.toBeInTheDocument(); expect(screen.getByRole('status')).toHaveTextContent('0 similar visits');
  });
  it('lists the people with links to their records, and counts by priority', () => {
    const a = e({ tier: 1, urgencyCode: 'red' }); h.entries = [a, e({ tier: 3 }), e({ assessed: false, tier: null })]; view();
    const counts = screen.getByRole('region', { name: 'Priority counts' });
    expect(within(counts).getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('link', { name: /Test Person/ })[0]).toHaveAttribute('href', `/encounters/${a.encounterId}`);
  });
  it('workplace shows its note but no cluster alert; health camp offers camp registration', async () => {
    h.entries = Array.from({ length: 8 }, () => e({ scenario: 'occupational' })); view();
    await userEvent.click(screen.getByRole('tab', { name: 'Workplace (8)' }));
    expect(screen.queryByText(/similar visits/)).not.toBeInTheDocument(); expect(screen.getByText(/Note the workplace/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Health camp (0)' }));
    expect(screen.getByRole('link', { name: 'Camp registration' })).toHaveAttribute('href', '/camp'); expect(screen.getByText('No one is waiting for this type of visit.')).toBeInTheDocument();
  });
  it('shows loading while the queue loads', () => { h.loading = true; view(); expect(screen.getByText('Loading…')).toBeInTheDocument(); });
});
