import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, PlatformFacilityView } from '../lib/types';
import { PlatformPage } from './PlatformPage';

let current: Api;
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: current }) }));

const fac = (o: Partial<PlatformFacilityView> = {}): PlatformFacilityView => ({ id: 'f1', name: 'Khordha PHC', type: 'phc', state: 'Odisha', district: 'Khordha', code: null, active: true, staff: 3, lastActivity: '2026-10-07T08:00:00.000Z', visits30: 12, referrals30: 2, admins: [{ userId: 'a1', name: 'Asha', email: 'asha@x.in' }], ...o });
const api = (o: Record<string, unknown> = {}) => ({
  platformFacilities: vi.fn().mockResolvedValue([fac()]), createFacility: vi.fn().mockResolvedValue({ id: 'f2' }), setFacilityActive: vi.fn().mockResolvedValue({ id: 'f1', active: false }),
  appointFacilityAdmin: vi.fn().mockResolvedValue({ userId: 'x' }), removeFacilityAdmin: vi.fn().mockResolvedValue({ userId: 'a1', removed: true }), ...o,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => vi.restoreAllMocks());

describe('PlatformPage', () => {
  it('lists facilities with their administrators and has no accessibility violations', async () => {
    current = api(); const { container } = render(<PlatformPage />);
    expect(await screen.findByText('Khordha PHC')).toBeInTheDocument(); expect(screen.getByText(/Asha/)).toBeInTheDocument(); expect(screen.getByText('3 staff')).toBeInTheDocument();
    expect((await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false }, 'landmark-one-main': { enabled: false }, 'page-has-heading-one': { enabled: false } } })).violations).toEqual([]);
  });
  it('adds a facility and reloads the list', async () => {
    const a = api(); current = a; render(<PlatformPage />);
    await userEvent.type(await screen.findByLabelText('Name'), 'Cuttack CHC'); await userEvent.selectOptions(screen.getByLabelText('Type'), 'chc'); await userEvent.type(screen.getByLabelText(/Pincode/), '753001');
    await userEvent.click(screen.getByRole('button', { name: 'Add facility' }));
    await waitFor(() => expect(a.createFacility).toHaveBeenCalledWith({ name: 'Cuttack CHC', type: 'chc', state: '', district: '', pincode: '753001', code: '' }));
    expect(await screen.findByText('Cuttack CHC was added.')).toBeInTheDocument(); expect(a.platformFacilities).toHaveBeenCalledTimes(2);
  });
  it('asks before switching a facility off, and does nothing if the person says no', async () => {
    const a = api(); current = a; render(<PlatformPage />);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false); await userEvent.click(await screen.findByRole('button', { name: 'Switch off' }));
    expect(a.setFacilityActive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Switch off' })); await waitFor(() => expect(a.setFacilityActive).toHaveBeenCalledWith('f1', false));
  });
  it('appoints and removes an administrator', async () => {
    const a = api(); current = a; render(<PlatformPage />);
    await userEvent.type(await screen.findByLabelText(/Appoint an administrator/), 'new@x.in'); await userEvent.click(screen.getByRole('button', { name: 'Appoint' }));
    await waitFor(() => expect(a.appointFacilityAdmin).toHaveBeenCalledWith('f1', 'new@x.in'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' })); await waitFor(() => expect(a.removeFacilityAdmin).toHaveBeenCalledWith('f1', 'a1'));
  });
  it('shows the server\'s reason when something is refused', async () => {
    current = api({ appointFacilityAdmin: vi.fn().mockRejectedValue(new Error('That person has no profile yet. Ask them to sign in once, then appoint them.')) }); render(<PlatformPage />);
    await userEvent.type(await screen.findByLabelText(/Appoint an administrator/), 'x@y.in'); await userEvent.click(screen.getByRole('button', { name: 'Appoint' }));
    expect(await screen.findByText(/sign in once/)).toBeInTheDocument();
  });
});

describe('facility health', () => {
  it('shows visits, referrals and last activity for each facility, and says when there is none', async () => {
    current = api({ platformFacilities: vi.fn().mockResolvedValue([fac(), fac({ id: 'f2', name: 'Quiet CHC', visits30: 0, referrals30: 0, lastActivity: null })]) }); render(<PlatformPage />);
    expect(await screen.findByText(/12 visits and 2 referrals sent in 30 days · last activity/)).toBeInTheDocument();
    expect(screen.getByText(/0 visits and 0 referrals sent in 30 days · no activity yet/)).toBeInTheDocument();
  });
});
