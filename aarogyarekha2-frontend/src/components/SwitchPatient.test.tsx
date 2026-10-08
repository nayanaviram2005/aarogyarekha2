import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecent, pushRecent, readRecent } from '../lib/recentPatients';
import type { Api, PatientBrief } from '../lib/types';
import { SwitchPatient } from './SwitchPatient';

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const pt: PatientBrief = { id: 'p1', public_ref: 'AR-0001', full_name: 'Anita Rao', sex: 'female', birth_date: null, age_years_reported: 30, preferred_language: 'hi' };
const api = (over: Record<string, unknown> = {}) => ({ patients: vi.fn().mockResolvedValue([pt]), patientEncounters: vi.fn().mockResolvedValue({ patientRef: 'AR-0001', encounters: [{ id: E1, status: 'closed', scenario: 'opd_queue', created_at: '' }] }), ...over }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}{(l.state as { patient?: PatientBrief } | null)?.patient ? ' with patient' : ''}</p>; };
const view = (a: Api | null, open = true, onClose = () => {}) => render(<MemoryRouter><SwitchPatient api={a} open={open} onClose={onClose} /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);

beforeEach(() => sessionStorage.clear());

describe('recent list storage', () => {
  it('keeps the newest first, no duplicates, at most 6, and only ids and record numbers', () => {
    for (let i = 0; i < 8; i++) pushRecent(sessionStorage, { encounterId: `${i}`.padStart(8, '0') + '-1111-4111-8111-111111111111', ref: `AR-${i}000` });
    pushRecent(sessionStorage, { encounterId: E1, ref: 'AR-0001' }); pushRecent(sessionStorage, { encounterId: E2, ref: 'AR-0002' }); pushRecent(sessionStorage, { encounterId: E1, ref: 'AR-0001' });
    const r = readRecent(sessionStorage); expect(r).toHaveLength(6); expect(r.map(x => x.ref).slice(0, 2)).toEqual(['AR-0001', 'AR-0002']); expect(sessionStorage.getItem('aarogyarekha.recent')).not.toMatch(/Anita|name/i);
  });
  it('ignores junk in storage, including anything that is not a visit id and record number', () => {
    sessionStorage.setItem('aarogyarekha.recent', JSON.stringify([{ encounterId: '<script>', ref: 'AR-1' }, { encounterId: E1, ref: '<b>x</b>' }, { encounterId: E2, ref: 'AR-2' }, 5, null]));
    expect(readRecent(sessionStorage)).toEqual([{ encounterId: E2, ref: 'AR-2' }]); sessionStorage.setItem('aarogyarekha.recent', 'not json'); expect(readRecent(sessionStorage)).toEqual([]);
  });
  it('clear removes it; blocked storage does not throw', () => { pushRecent(sessionStorage, { encounterId: E1, ref: 'AR-1' }); clearRecent(sessionStorage); expect(readRecent(sessionStorage)).toEqual([]); expect(() => pushRecent(null, { encounterId: E1, ref: 'AR-1' })).not.toThrow(); expect(readRecent(null)).toEqual([]); });
});

describe('SwitchPatient', () => {
  it('renders nothing when closed', () => { const { container } = view(api(), false); expect(container.querySelector('[role=dialog]')).toBeNull(); });
  it('lists records opened earlier and jumps to one', async () => {
    pushRecent(sessionStorage, { encounterId: E1, ref: 'AR-0001' }); const onClose = vi.fn(); view(api(), true, onClose);
    await userEvent.click(await screen.findByRole('button', { name: /AR-0001/ })); expect(screen.getByTestId('where')).toHaveTextContent(`/encounters/${E1}`); expect(onClose).toHaveBeenCalled();
  });
  it('says nothing yet when there are no recents, and Clear empties the list', async () => {
    const { unmount } = view(api()); expect(screen.getByText('Nothing yet.')).toBeInTheDocument(); unmount();
    pushRecent(sessionStorage, { encounterId: E1, ref: 'AR-0001' }); view(api()); await userEvent.click(screen.getByRole('button', { name: 'Clear this list' })); expect(screen.getByText('Nothing yet.')).toBeInTheDocument();
  });
  it('searching and picking a patient opens their latest visit', async () => {
    const a = api(); view(a); await userEvent.type(screen.getByLabelText('Name or record number'), 'Anita'); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: /Anita Rao/ })); await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/encounters/${E1}`)); expect(a.patients).toHaveBeenCalledWith('Anita');
  });
  it('a patient with no visits goes to a new intake with that patient already chosen', async () => {
    view(api({ patientEncounters: vi.fn().mockResolvedValue({ patientRef: 'AR-0001', encounters: [] }) })); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: /Anita Rao/ })); await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/intake with patient'));
  });
  it('if the visit list cannot be loaded it still starts an intake rather than failing', async () => {
    view(api({ patientEncounters: vi.fn().mockRejectedValue(new Error('x')) })); await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: /Anita Rao/ })); await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/intake with patient'));
  });
  it('no match and a search failure are shown in words', async () => {
    const { unmount } = view(api({ patients: vi.fn().mockResolvedValue([]) })); await userEvent.click(screen.getByRole('button', { name: 'Search' })); expect(await screen.findByText('No patients match.')).toBeInTheDocument(); unmount();
    view(api({ patients: vi.fn().mockRejectedValue(new Error('The server is busy.')) })); await userEvent.click(screen.getByRole('button', { name: 'Search' })); expect(await screen.findByRole('alert')).toHaveTextContent('busy');
  });
  it('Escape and Close both close it', async () => {
    const onClose = vi.fn(); view(api(), true, onClose); await userEvent.keyboard('{Escape}'); await userEvent.click(screen.getByRole('button', { name: 'Close' })); expect(onClose).toHaveBeenCalledTimes(2);
  });
});
