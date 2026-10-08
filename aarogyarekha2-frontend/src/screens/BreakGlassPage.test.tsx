import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';

const h = vi.hoisted(() => ({ api: null as unknown }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
import { BreakGlassPage } from './BreakGlassPage';

const mk = (over: Record<string, unknown> = {}) => ({
  requestBreakGlass: vi.fn().mockResolvedValue({ id: 'g', patientId: 'p1', patientRef: 'AR-0042', expiresAt: '2026-10-07T09:00:00Z' }),
  patientEncounters: vi.fn().mockResolvedValue({ patientRef: 'AR-0042', encounters: [{ id: 'e1', status: 'in_review', scenario: 'opd_queue', created_at: '2026-10-06T08:00:00Z' }] }), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = () => render(<MemoryRouter><BreakGlassPage /></MemoryRouter>);
const fill = async (ref = 'ar-0042', reason = 'Unconscious on arrival, relatives not found') => {
  await userEvent.type(screen.getByLabelText('Patient record number'), ref); await userEvent.type(screen.getByLabelText(/Why do you need this record now/), reason);
};

beforeEach(() => { h.api = mk(); });

describe('BreakGlassPage', () => {
  it('says up front that every use is recorded and reviewed', () => {
    view(); expect(screen.getByText('Every use is recorded')).toBeInTheDocument(); expect(screen.getByText(/reviews each one afterwards/)).toBeInTheDocument();
  });
  it('a short reason is stopped before anything is sent', async () => {
    const a = mk(); h.api = a; view(); await fill('AR-0042', 'urgent');
    await userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 10 characters'); expect(a.requestBreakGlass).not.toHaveBeenCalled();
  });
  it('a missing record number is stopped too', async () => {
    const a = mk(); h.api = a; view(); await userEvent.type(screen.getByLabelText(/Why do you need/), 'Unconscious on arrival');
    await userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('record number'); expect(a.requestBreakGlass).not.toHaveBeenCalled();
  });
  it('on success shows the expiry and links to the patient\'s visits; the reason box is cleared', async () => {
    const a = mk(); h.api = a; view(); await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));
    expect(await screen.findByText('Access granted for AR-0042')).toBeInTheDocument();
    expect(a.requestBreakGlass).toHaveBeenCalledWith({ publicRef: 'ar-0042', reason: 'Unconscious on arrival, relatives not found' });
    expect(screen.getByRole('link', { name: /in review/ })).toHaveAttribute('href', '/encounters/e1'); expect(screen.getByText(/After that you will not be able to open this record/)).toBeInTheDocument();
  });
  it('Done returns to an empty form (the reason is not kept)', async () => {
    view(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(screen.getByLabelText(/Why do you need/)).toHaveValue('');
  });
  it('granted but no visits recorded says so', async () => {
    h.api = mk({ patientEncounters: vi.fn().mockResolvedValue({ patientRef: 'AR-1', encounters: [] }) }); view(); await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));
    expect(await screen.findByText('No visits are recorded for this patient.')).toBeInTheDocument();
  });
  it('still shows the grant if listing visits fails', async () => {
    h.api = mk({ patientEncounters: vi.fn().mockRejectedValue(new Error('x')) }); view(); await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));
    expect(await screen.findByText('Access granted for AR-0042')).toBeInTheDocument();
  });
  it.each([['no such patient', 404, 'No patient has that record number.'], ['no second factor', 403, 'Two-factor sign-in is required for this action. Verify with your authenticator app, then try again.']])('%s: shows the server\'s plain message and stays on the form', async (_n, status, msg) => {
    h.api = mk({ requestBreakGlass: vi.fn().mockRejectedValue(new ApiError(status, msg)) }); view(); await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(msg); await waitFor(() => expect(screen.getByRole('button', { name: 'Get emergency access' })).toBeEnabled());
  });
});
