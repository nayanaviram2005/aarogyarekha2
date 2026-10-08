import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, BoardReferral } from '../lib/types';

const h = vi.hoisted(() => ({ api: null as unknown }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
vi.mock('../components/ReferralNote', () => ({ ReferralNote: ({ onClose }: { onClose: () => void }) => <div role="dialog">Referral note shown<button onClick={onClose}>Close note</button></div> }));
import { ReferralsPage } from './ReferralsPage';

const row = (over: Partial<BoardReferral> = {}): BoardReferral => ({ id: 'r1', encounterId: 'e', patientId: 'p', status: 'requested', statusReason: null, priority: 'urgent', reasonText: 'Needs a scan', sentAt: '2026-10-07T08:00:00Z', updatedAt: '2026-10-07T08:00:00Z', from: { id: 'fa', name: 'Seed PHC' }, to: { id: 'fb', name: 'Seed District Hospital' }, patient: { id: 'p', publicRef: 'AR-0001', fullName: 'Anita Rao', sex: 'female', birthDate: null, ageYears: 30, language: 'hi' }, ...over });
const mk = (over: Record<string, unknown> = {}) => ({ incomingReferrals: vi.fn().mockResolvedValue([row()]), sentReferrals: vi.fn().mockResolvedValue([row({ status: 'accepted' })]), respondToReferral: vi.fn().mockResolvedValue({ id: 'r1', status: 'accepted' }), referral: vi.fn().mockResolvedValue({ referral: {}, preview: false, bundle: {}, readiness: {} }), ...over }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = () => render(<MemoryRouter><ReferralsPage /></MemoryRouter>);

beforeEach(() => { h.api = mk(); });

describe('ReferralsPage', () => {
  it('shows the incoming referral with who, how urgent, from where, why, and where it stands', async () => {
    view(); const card = await screen.findByRole('region', { name: 'Referral AR-0001' });
    expect(within(card).getByText(/Anita Rao/)).toBeInTheDocument(); expect(within(card).getByText(/Urgent/)).toBeInTheDocument(); expect(within(card).getByText(/from Seed PHC/)).toBeInTheDocument();
    expect(within(card).getByText('Waiting for a reply')).toBeInTheDocument(); expect(within(card).getByText(/Needs a scan/)).toBeInTheDocument();
  });
  it('a waiting referral offers Accept and Decline, and nothing else', async () => {
    view(); await screen.findByText(/Anita Rao/);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Patient has arrived' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
  });
  it('accept replies at once and reloads the list', async () => {
    const a = mk(); h.api = a; view(); await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(a.respondToReferral).toHaveBeenCalledWith('r1', 'accept', undefined)); await waitFor(() => expect(a.incomingReferrals).toHaveBeenCalledTimes(2));
  });
  it('declining asks for a reason first, will not send a short one, then sends the confirmed one', async () => {
    const a = mk(); h.api = a; view(); await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(a.respondToReferral).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Reason for declining/), 'no'); await userEvent.click(screen.getByRole('button', { name: 'Confirm: decline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 5 characters'); expect(a.respondToReferral).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/Reason for declining/)); await userEvent.type(screen.getByLabelText(/Reason for declining/), 'No bed free today'); await userEvent.click(screen.getByRole('button', { name: 'Confirm: decline' }));
    await waitFor(() => expect(a.respondToReferral).toHaveBeenCalledWith('r1', 'reject', 'No bed free today'));
  });
  it('cancel closes the reason box without sending', async () => {
    const a = mk(); h.api = a; view(); await userEvent.click(await screen.findByRole('button', { name: 'Decline' })); await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/Reason for declining/)).not.toBeInTheDocument(); expect(a.respondToReferral).not.toHaveBeenCalled();
  });
  it('an accepted referral offers "Patient has arrived"; an in-progress one offers "Mark completed" with an optional note', async () => {
    h.api = mk({ incomingReferrals: vi.fn().mockResolvedValue([row({ id: 'a', status: 'accepted' }), row({ id: 'b', status: 'in_progress', patient: { ...row().patient!, publicRef: 'AR-0002' } })]) }); view();
    await userEvent.click(await screen.findByRole('button', { name: 'Patient has arrived' }));
    await waitFor(() => expect((h.api as Api & Record<string, ReturnType<typeof vi.fn>>).respondToReferral).toHaveBeenCalledWith('a', 'start', undefined));
    await userEvent.click(screen.getByRole('button', { name: 'Mark completed' })); await userEvent.click(screen.getByRole('button', { name: 'Confirm: mark completed' }));
    await waitFor(() => expect((h.api as Api & Record<string, ReturnType<typeof vi.fn>>).respondToReferral).toHaveBeenCalledWith('b', 'complete', undefined));
  });
  it('finished and declined referrals offer no actions and show the decline reason', async () => {
    h.api = mk({ incomingReferrals: vi.fn().mockResolvedValue([row({ status: 'rejected', statusReason: 'No bed free' }), row({ id: 'r2', status: 'completed', patient: { ...row().patient!, publicRef: 'AR-0003' } })]) }); view();
    expect(await screen.findByText(/No bed free/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument(); expect(screen.getAllByRole('button', { name: 'View referral note' })).toHaveLength(2);
  });
  it('the Sent tab loads the sent list and offers no reply buttons', async () => {
    const a = mk(); h.api = a; view(); await userEvent.click(await screen.findByRole('tab', { name: 'Sent' }));
    expect(await screen.findByText(/to Seed District Hospital/)).toBeInTheDocument(); expect(a.sentReferrals).toHaveBeenCalled(); expect(screen.queryByRole('button', { name: /Accept|Decline|arrived|completed/ })).not.toBeInTheDocument();
  });
  it('the finished/declined checkbox asks for the wider list', async () => {
    const a = mk(); h.api = a; view(); await screen.findByText(/Anita Rao/); await userEvent.click(screen.getByLabelText(/Include finished and declined/));
    await waitFor(() => expect(a.incomingReferrals).toHaveBeenLastCalledWith(['requested', 'accepted', 'in_progress', 'rejected', 'completed', 'cancelled']));
  });
  it('shows an empty state for each tab', async () => {
    h.api = mk({ incomingReferrals: vi.fn().mockResolvedValue([]), sentReferrals: vi.fn().mockResolvedValue([]) }); view();
    expect(await screen.findByText('No referrals are waiting for you.')).toBeInTheDocument(); await userEvent.click(screen.getByRole('tab', { name: 'Sent' })); expect(await screen.findByText('No referrals sent.')).toBeInTheDocument();
  });
  it('a refusal from the server is shown in words and the list reloads to the true state', async () => {
    const a = mk({ respondToReferral: vi.fn().mockRejectedValue(new ApiError(409, 'This referral is accepted, so it cannot be accepted.')) }); h.api = a; view();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be accepted'); await waitFor(() => expect(a.incomingReferrals).toHaveBeenCalledTimes(2));
  });
  it('a row whose patient the user cannot see says so instead of crashing', async () => {
    h.api = mk({ incomingReferrals: vi.fn().mockResolvedValue([row({ patient: null })]) }); view(); expect(await screen.findByText('Patient not visible to you')).toBeInTheDocument();
  });
  it('opens and closes the referral note', async () => {
    const a = mk(); h.api = a; view(); await userEvent.click(await screen.findByRole('button', { name: 'View referral note' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); expect(a.referral).toHaveBeenCalledWith('r1');
    await userEvent.click(screen.getByRole('button', { name: 'Close note' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('a load failure is shown in words', async () => {
    h.api = mk({ incomingReferrals: vi.fn().mockRejectedValue(new ApiError(403, 'Only clinical staff can see referrals.')) }); view();
    expect(await screen.findByRole('alert')).toHaveTextContent('Only clinical staff');
  });
});
