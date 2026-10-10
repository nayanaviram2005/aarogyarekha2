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
  trainingSummary: vi.fn().mockResolvedValue({ enabled: true, count: 3, latestAt: '2026-10-10T10:00:00.000Z' }),
  downloadTrainingData: vi.fn().mockResolvedValue({ filename: 'training-cases-2026-10-10.csv', blob: new Blob(['case_id\n']), rows: 3 }),
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

describe('training data', () => {
  it('says how many anonymous cases are saved, and downloads them as CSV or JSON lines', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const a = api(); current = a; render(<PlatformPage />);
    expect(await screen.findByText(/3 cases saved/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(a.downloadTrainingData).toHaveBeenCalledWith('csv'));
    expect(await screen.findByText('Training data downloaded.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download JSON lines with FHIR' }));
    await waitFor(() => expect(a.downloadTrainingData).toHaveBeenCalledWith('jsonl'));
  });

  it('cannot download when nothing is saved yet', async () => {
    current = api({ trainingSummary: vi.fn().mockResolvedValue({ enabled: true, count: 0, latestAt: null }) }); render(<PlatformPage />);
    expect(await screen.findByText(/0 cases saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });

  it('explains what to set when training data is off', async () => {
    current = api({ trainingSummary: vi.fn().mockResolvedValue({ enabled: false, count: 0, latestAt: null }) }); render(<PlatformPage />);
    expect(await screen.findByText(/TRAINING_PSEUDONYM_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
  });

  it('shows the server\'s reason when the download is refused', async () => {
    current = api({ downloadTrainingData: vi.fn().mockRejectedValue(new Error('A verified second factor is needed.')) }); render(<PlatformPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByText(/second factor is needed/)).toBeInTheDocument();
  });

  it('says so when the count cannot be loaded', async () => {
    current = api({ trainingSummary: vi.fn().mockRejectedValue(new Error('Check that migration 0022 is applied.')) }); render(<PlatformPage />);
    expect(await screen.findByText(/migration 0022 is applied/)).toBeInTheDocument();
  });
});
