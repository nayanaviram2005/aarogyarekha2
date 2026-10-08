import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, BreakGlassGrantView, FlagsResponse } from '../lib/types';

const h = vi.hoisted(() => ({ api: null as unknown }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
import { AdminPage, ChainBadge } from './AdminPage';

const flags = (over: Partial<FlagsResponse> = {}): FlagsResponse => ({ hours: 24, examined: 120, rulesValidated: false, flags: [], ...over });
const grant = (over: Partial<BreakGlassGrantView> = {}): BreakGlassGrantView => ({ id: 'g1', who: 'Nurse Das', userId: 'u1', patientRef: 'AR-0042', facilityId: 'f', reason: 'Unconscious on arrival', createdAt: '2026-10-07T08:00:00Z', expiresAt: '2026-10-07T09:00:00Z', reviewedAt: null, reviewed: false, ...over });
const mk = (over: Record<string, unknown> = {}) => ({ members: vi.fn().mockResolvedValue([]), memberChanges: vi.fn().mockResolvedValue([]), analytics: vi.fn().mockResolvedValue({ days: 30, encounters: 0, submitted: 0, assessed: 0, reviewed: 0, byScenario: [], byUrgency: [], secondsToAssessment: { n: 0, median: null, p90: null }, minutesToReview: { n: 0, median: null, p90: null }, review: { approved: 0, changed: 0, loweredBelowRules: 0, agreementRate: null }, feedback: null, note: 'n' }), auditFlags: vi.fn().mockResolvedValue(flags()), breakGlassList: vi.fn().mockResolvedValue([]), auditChain: vi.fn().mockResolvedValue({ intact: true, checked: 77, brokenIds: [], checkedAt: '2026-10-07T10:00:00Z' }), reviewBreakGlass: vi.fn().mockResolvedValue({ id: 'g1', reviewed: true }), ...over }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = () => render(<MemoryRouter><AdminPage /></MemoryRouter>);

beforeEach(() => { h.api = mk(); });

describe('ChainBadge', () => {
  it('not checked, intact and broken look different and say so in words', () => {
    const { rerender } = render(<ChainBadge chain={null} busy={false} onCheck={() => {}} />);
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    rerender(<ChainBadge chain={{ intact: true, checked: 5, brokenIds: [], checkedAt: '2026-10-07T10:00:00Z' }} busy={false} onCheck={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Audit log intact · 5 entries checked');
    rerender(<ChainBadge chain={{ intact: false, checked: 5, brokenIds: [3, 4], checkedAt: '2026-10-07T10:00:00Z' }} busy={false} onCheck={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('AUDIT LOG DOES NOT MATCH · 2 entries differ (first: 3)');
  });
  it('shows a plus when the list of broken rows was cut off', () => {
    render(<ChainBadge chain={{ intact: false, checked: 99, brokenIds: Array.from({ length: 20 }, (_, i) => i + 1), checkedAt: '2026-10-07T10:00:00Z' }} busy={false} onCheck={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('20+ entries differ');
  });
  it('the button is off while checking', () => {
    render(<ChainBadge chain={null} busy onCheck={() => {}} />); expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  });
});

describe('AdminPage', () => {
  it('warns that the limits are drafts, and says when nothing is unusual', async () => {
    view(); expect(await screen.findByText('Draft thresholds')).toBeInTheDocument(); expect(await screen.findByText('Nothing unusual among 120 logged events.')).toBeInTheDocument();
  });
  it('lists flags with what, who, count and when; information flags say so', async () => {
    h.api = mk({ auditFlags: vi.fn().mockResolvedValue(flags({ flags: [
      { kind: 'many_patients', severity: 'review', who: { actorId: 'u1', ip: null, name: 'Nurse Das' }, count: 31, firstAt: '2026-10-07T08:00:00Z', lastAt: '2026-10-07T08:08:00Z', text: "Opened 31 different patients' records within 10 minutes." },
      { kind: 'failed_logins', severity: 'review', who: { actorId: null, ip: '203.0.113.9', name: null }, count: 6, firstAt: '2026-10-07T08:00:00Z', lastAt: '2026-10-07T08:05:00Z', text: '6 failed sign-ins from one address within 10 minutes.' },
      { kind: 'emergency_access', severity: 'info', who: { actorId: 'u2', ip: null, name: 'Dr Rao' }, count: 1, firstAt: '2026-10-07T08:00:00Z', lastAt: '2026-10-07T08:00:00Z', text: 'Used emergency access 1 time.' }] })) });
    view();
    expect(await screen.findByText('Many records opened')).toBeInTheDocument(); expect(screen.getByText('Nurse Das')).toBeInTheDocument(); expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
    expect(screen.getByText('For your information.')).toBeInTheDocument(); expect(screen.getByText('31')).toBeInTheDocument();
  });
  it('changing the look-back asks again with the new hours', async () => {
    const a = mk(); h.api = a; view(); await screen.findByText(/Nothing unusual/);
    await userEvent.selectOptions(screen.getByLabelText('Look back'), '168');
    await waitFor(() => expect(a.auditFlags).toHaveBeenLastCalledWith(168));
  });
  it('checking the chain shows the result', async () => {
    view(); await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Audit log intact · 77 entries checked')).toBeInTheDocument();
  });
  it('lists emergency access with who, record, reason; the admin marks one reviewed and the list reloads', async () => {
    const a = mk({ breakGlassList: vi.fn().mockResolvedValueOnce([grant()]).mockResolvedValue([grant({ reviewed: true, reviewedAt: '2026-10-07T11:00:00Z' })]) }); h.api = a; view();
    const row = (await screen.findByText('AR-0042')).closest('tr')!;
    expect(within(row).getByText('Nurse Das')).toBeInTheDocument(); expect(within(row).getByText('Unconscious on arrival')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => expect(a.reviewBreakGlass).toHaveBeenCalledWith('g1'));
    expect(await screen.findByText(/^Reviewed /)).toBeInTheDocument();
  });
  it('a non-administrator sees the plain refusal instead of data', async () => {
    h.api = mk({ auditFlags: vi.fn().mockRejectedValue(new ApiError(403, 'Administrator access is needed for this screen.')), breakGlassList: vi.fn().mockRejectedValue(new ApiError(403, 'Administrator access is needed for this screen.')) });
    view(); expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access is needed');
  });
  it('one list failing does not hide the other', async () => {
    h.api = mk({ breakGlassList: vi.fn().mockRejectedValue(new ApiError(502, 'Emergency access records could not be loaded. Try again.')) });
    view(); expect(await screen.findByText(/Nothing unusual/)).toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
