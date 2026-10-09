import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, PatientSearchHit, TriageHistory } from '../lib/types';

const h = vi.hoisted(() => ({ api: null as unknown }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
import { BreakGlassPage } from './BreakGlassPage';

const hit = (o: Partial<PatientSearchHit> = {}): PatientSearchHit => ({ publicRef: 'AR-0042', name: 'Sita Mohanty', sex: 'female', age: 34, facility: 'Cuttack CHC', ownFacility: false, ...o });
const history = (o: Partial<TriageHistory> = {}): TriageHistory => ({
  patientRef: 'AR-0042', patientName: 'Sita Mohanty',
  visits: [{ id: 'e1', createdAt: '2026-10-05T08:00:00Z', facility: 'Cuttack CHC', scenario: 'opd_queue', status: 'closed', outcome: 'treated_here', complaint: 'Chest pain since morning', assessedUrgency: 'orange', finalUrgency: 'red', reviewedBy: 'Dr Rao', reviewedAt: '2026-10-05T08:20:00Z',
    notes: [{ id: 'n1', body: 'ECG normal. Started aspirin; review in 2 days.', author: 'Dr Rao', at: '2026-10-05T09:00:00Z' }] },
  { id: 'e0', createdAt: '2026-07-01T08:00:00Z', facility: 'Cuttack CHC', scenario: 'opd_queue', status: 'closed', outcome: 'sent_home', complaint: null, assessedUrgency: 'yellow', finalUrgency: null, reviewedBy: null, reviewedAt: null, notes: [] }], ...o,
});
const mk = (over: Record<string, unknown> = {}) => ({
  searchBreakGlassPatients: vi.fn().mockResolvedValue({ truncated: false, patients: [hit(), hit({ publicRef: 'AR-0043', name: 'Sita Das', age: null, sex: null, facility: 'Khordha PHC', ownFacility: true })] }),
  requestBreakGlass: vi.fn().mockResolvedValue({ id: 'g', patientId: 'p1', patientRef: 'AR-0042', expiresAt: '2026-10-07T09:00:00Z' }),
  patientTriageHistory: vi.fn().mockResolvedValue(history()), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = () => render(<MemoryRouter><BreakGlassPage /></MemoryRouter>);
const search = async (text: string) => { await userEvent.type(screen.getByRole('combobox'), text); return screen.findByRole('listbox', {}, { timeout: 2000 }); };
const reason = (text = 'Unconscious on arrival, relatives not found') => userEvent.type(screen.getByLabelText(/Why do you need this record now/), text);
const chosen = () => screen.getAllByRole('status').find(el => el.textContent?.includes('Change patient'))!;
const request = () => userEvent.click(screen.getByRole('button', { name: 'Get emergency access' }));

beforeEach(() => { h.api = mk(); });

describe('finding the patient', () => {
  it('says up front that every use, and every search, is recorded', () => {
    view(); expect(screen.getByText('Every use is recorded')).toBeInTheDocument(); expect(screen.getByText(/Searches are logged too/)).toBeInTheDocument();
  });
  it('lists matches by name or record number with age, sex and where the patient is registered', async () => {
    const a = mk(); h.api = a; view(); await search('sita');
    await waitFor(() => expect(a.searchBreakGlassPatients).toHaveBeenCalledWith('sita'));
    const options = await screen.findAllByRole('option'); expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Sita Mohanty · AR-0042'); expect(options[0]).toHaveTextContent('34 y, female · Cuttack CHC');
    expect(options[1]).toHaveTextContent('Khordha PHC · your facility (open from the queue)');
  });
  it('does not search for fewer than two characters', async () => {
    const a = mk(); h.api = a; view(); await userEvent.type(screen.getByRole('combobox'), 's');
    await new Promise(r => setTimeout(r, 450)); expect(a.searchBreakGlassPatients).not.toHaveBeenCalled();
  });
  it('says when nobody matches', async () => {
    h.api = mk({ searchBreakGlassPatients: vi.fn().mockResolvedValue({ truncated: false, patients: [] }) }); view(); await search('zzz');
    expect(await screen.findByText(/No patient matches/)).toBeInTheDocument();
  });
  it('says when the list was cut', async () => {
    h.api = mk({ searchBreakGlassPatients: vi.fn().mockResolvedValue({ truncated: true, patients: [hit()] }) }); view(); await search('sita');
    expect(await screen.findByText(/Type more to narrow the list/)).toBeInTheDocument();
  });
  it('choosing a patient fills the form, and Change patient goes back to searching', async () => {
    view(); await search('sita'); await userEvent.click((await screen.findAllByRole('option'))[0]!);
    expect(screen.queryByRole('combobox')).toBeNull(); expect(chosen()).toHaveTextContent('Sita Mohanty · AR-0042 · 34 y, female · Cuttack CHC');
    await userEvent.click(screen.getByRole('button', { name: 'Change patient' })); expect(screen.getByRole('combobox')).toHaveValue('');
  });
  it('the arrow keys and Enter choose a patient', async () => {
    view(); await search('sita'); await screen.findAllByRole('option');
    await userEvent.keyboard('{ArrowDown}{Enter}'); expect(chosen()).toHaveTextContent('Sita Das · AR-0043');
  });
  it('shows the reason when the search itself is refused', async () => {
    h.api = mk({ searchBreakGlassPatients: vi.fn().mockRejectedValue(new ApiError(403, 'Only clinical staff can use emergency access.')) }); view(); await search('sita');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only clinical staff can use emergency access.');
  });
});

describe('asking for access', () => {
  it('a short reason is stopped before anything is sent', async () => {
    const a = mk(); h.api = a; view(); await search('sita'); await userEvent.click((await screen.findAllByRole('option'))[0]!); await reason('urgent'); await request();
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 10 characters'); expect(a.requestBreakGlass).not.toHaveBeenCalled();
  });
  it('no patient chosen is stopped too', async () => {
    const a = mk(); h.api = a; view(); await reason(); await request();
    expect(await screen.findByRole('alert')).toHaveTextContent('Find the patient by name or record number'); expect(a.requestBreakGlass).not.toHaveBeenCalled();
  });
  it('a record number typed in full still works without choosing from the list', async () => {
    const a = mk(); h.api = a; view(); await userEvent.type(screen.getByRole('combobox'), 'ar-0042'); await reason(); await request();
    await waitFor(() => expect(a.requestBreakGlass).toHaveBeenCalledWith({ publicRef: 'ar-0042', reason: 'Unconscious on arrival, relatives not found' }));
  });
  it('on success shows the triage history: priority, complaint, outcome, who signed off, and the doctor’s notes', async () => {
    const a = mk(); h.api = a; view(); await search('sita'); await userEvent.click((await screen.findAllByRole('option'))[0]!); await reason(); await request();
    expect(await screen.findByText('Access granted for Sita Mohanty (AR-0042)')).toBeInTheDocument();
    expect(a.requestBreakGlass).toHaveBeenCalledWith({ publicRef: 'AR-0042', reason: 'Unconscious on arrival, relatives not found' }); expect(a.patientTriageHistory).toHaveBeenCalledWith('p1');
    const visits = screen.getAllByRole('listitem').filter(li => li.className.includes('block'));
    expect(visits).toHaveLength(2);
    expect(within(visits[0]!).getByRole('img', { name: /Immediate/ })).toBeInTheDocument(); expect(within(visits[0]!).getByText('Complaint: Chest pain since morning')).toBeInTheDocument();
    expect(visits[0]).toHaveTextContent('Outcome: Treated here.'); expect(visits[0]).toHaveTextContent('Signed off by Dr Rao');
    expect(within(visits[0]!).getByText('ECG normal. Started aspirin; review in 2 days.')).toBeInTheDocument();
    expect(within(visits[0]!).getByRole('link', { name: 'Open the full visit' })).toHaveAttribute('href', '/encounters/e1');
    expect(within(visits[1]!).getByRole('img', { name: /Urgent/ })).toBeInTheDocument(); expect(visits[1]).toHaveTextContent('No complaint recorded.'); expect(visits[1]).toHaveTextContent('Not signed off.'); expect(visits[1]).toHaveTextContent('No doctor’s notes for this visit.');
    expect(screen.getByText(/After that you will not be able to open this record/)).toBeInTheDocument();
  });
  it('Done returns to an empty form (the patient and reason are not kept)', async () => {
    view(); await userEvent.type(screen.getByRole('combobox'), 'AR-0042'); await reason(); await request();
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(screen.getByLabelText(/Why do you need/)).toHaveValue(''); expect(screen.getByRole('combobox')).toHaveValue('');
  });
  it('granted but no visits recorded says so', async () => {
    h.api = mk({ patientTriageHistory: vi.fn().mockResolvedValue(history({ visits: [] })) }); view(); await userEvent.type(screen.getByRole('combobox'), 'AR-0042'); await reason(); await request();
    expect(await screen.findByText('No visits are recorded for this patient.')).toBeInTheDocument();
  });
  it('still shows the grant, with the reason, if the history cannot be loaded', async () => {
    h.api = mk({ patientTriageHistory: vi.fn().mockRejectedValue(new ApiError(502, 'The triage history could not be loaded. Try again.')) }); view(); await userEvent.type(screen.getByRole('combobox'), 'AR-0042'); await reason(); await request();
    expect(await screen.findByText('Access granted for this patient')).toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('The triage history could not be loaded');
  });
  it.each([['no such patient', 404, 'No patient has that record number.'], ['no second factor', 403, 'Two-factor sign-in is required for this action. Verify with your authenticator app, then try again.']])('%s: shows the server’s plain message and stays on the form', async (_n, status, msg) => {
    h.api = mk({ requestBreakGlass: vi.fn().mockRejectedValue(new ApiError(status as number, msg as string)) }); view(); await userEvent.type(screen.getByRole('combobox'), 'AR-0042'); await reason(); await request();
    expect(await screen.findByRole('alert')).toHaveTextContent(msg as string); await waitFor(() => expect(screen.getByRole('button', { name: 'Get emergency access' })).toBeEnabled());
  });
});
