import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, HistoryEntry } from '../lib/types';
import { HistoryPanel } from './HistoryPanel';

const h = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({ id: 'h1', kind: 'allergy', text: 'penicillin rash', lang: 'en', source: 'health_worker', createdAt: '2026-10-06T00:00:00Z', confirmed: false, confirmedAt: null, confirmedBy: null, ...over });
const api = (over: Record<string, unknown> = {}) => ({ history: vi.fn().mockResolvedValue([h()]), addHistory: vi.fn().mockResolvedValue({ id: 'n' }), confirmHistory: vi.fn().mockResolvedValue({ id: 'h1', confirmed: true }), ...over }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = (a: Api, o: { editable?: boolean; canConfirm?: boolean } = {}) => render(<HistoryPanel api={a} patientId="p1" editable={o.editable ?? true} canConfirm={o.canConfirm ?? true} defaultLanguage="hi" />);

describe('HistoryPanel', () => {
  it('says it records as told and does not advise', async () => { view(api()); expect(await screen.findByText(/does not advise on any medicine, dose or allergy/)).toBeInTheDocument(); });
  it('shows allergies in a warning at the top, and groups the rest by kind', async () => {
    view(api({ history: vi.fn().mockResolvedValue([h(), h({ id: 'm', kind: 'medication', text: 'metformin morning' })]) }));
    expect(await screen.findByText('Reported allergies')).toBeInTheDocument(); expect(screen.getByText('metformin morning')).toBeInTheDocument(); expect(screen.getAllByText('Medicines being taken').length).toBeGreaterThan(1);
  });
  it('marks entries as not confirmed until staff confirm, and names who confirmed', async () => {
    view(api({ history: vi.fn().mockResolvedValue([h(), h({ id: 'm', kind: 'medication', text: 'x', confirmed: true, confirmedBy: 'Dr Das', confirmedAt: '2026-10-06T10:00:00Z' })]) }));
    expect(await screen.findByText('Reported, not confirmed')).toBeInTheDocument(); expect(screen.getByText(/Confirmed by Dr Das/)).toBeInTheDocument();
  });
  it('a reviewer can confirm and the list reloads', async () => {
    const a = api(); view(a); await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(a.confirmHistory).toHaveBeenCalledWith('h1')); expect(a.history).toHaveBeenCalledTimes(2);
  });
  it('others see no Confirm button', async () => { view(api(), { canConfirm: false }); await screen.findByText('Reported, not confirmed'); expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument(); });
  it('adds an entry in the chosen kind with the screen language, then clears the box', async () => {
    const a = api({ history: vi.fn().mockResolvedValue([]) }); view(a); await screen.findByText('Nothing recorded yet.');
    await userEvent.selectOptions(screen.getByLabelText('Add to history'), 'medication'); await userEvent.type(screen.getByLabelText('As told'), 'metformin');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(a.addHistory).toHaveBeenCalledWith('p1', { kind: 'medication', text: 'metformin', lang: 'hi' })); expect(screen.getByLabelText('As told')).toHaveValue('');
  });
  it('an empty entry is not sent', async () => { const a = api(); view(a); await screen.findByText('Reported, not confirmed'); await userEvent.click(screen.getByRole('button', { name: 'Add' })); expect(await screen.findByRole('alert')).toHaveTextContent('Type what was reported'); expect(a.addHistory).not.toHaveBeenCalled(); });
  it('a read-only encounter has no add form', async () => { view(api(), { editable: false }); await screen.findByText('Reported, not confirmed'); expect(screen.queryByLabelText('Add to history')).not.toBeInTheDocument(); });
  it('a load error is shown in words', async () => { view(api({ history: vi.fn().mockRejectedValue(new ApiError(403, 'No active consent for triage is recorded for this patient. Record consent first.')) })); expect(await screen.findByRole('alert')).toHaveTextContent('No active consent'); });
});
