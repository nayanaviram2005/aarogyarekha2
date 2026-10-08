import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../lib/types';

const h = vi.hoisted(() => ({ api: null as unknown, refresh: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./queueContext', () => ({ useQueue: () => ({ entries: [], loading: false, error: null, generatedAt: null, refresh: h.refresh }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
import { CampBatchPage } from './CampBatchPage';

const mkApi = (over: Record<string, unknown> = {}) => ({
  registerPatient: vi.fn().mockResolvedValue({ id: 'p1', publicRef: 'AR-1' }), recordConsent: vi.fn().mockResolvedValue({ id: 'c' }), createEncounter: vi.fn().mockResolvedValue({ id: 'e1', status: 'draft' }),
  addVital: vi.fn().mockResolvedValue({}), submit: vi.fn().mockResolvedValue({}), assess: vi.fn().mockResolvedValue({}), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = () => render(<MemoryRouter><CampBatchPage /></MemoryRouter>);
const fillRow = async (n: number, name: string, age: string, complaint: string, consent = true) => {
  await userEvent.type(screen.getByLabelText(`Name, row ${n}`), name); await userEvent.type(screen.getByLabelText(`Age, row ${n}`), age); await userEvent.type(screen.getByLabelText(`Complaint, row ${n}`), complaint);
  if (consent) await userEvent.click(screen.getByLabelText(`Consent given, row ${n}`));
};

beforeEach(() => { h.refresh.mockReset(); });

describe('CampBatchPage', () => {
  it('shows the consent notice to read aloud, and flags it as draft wording', () => {
    h.api = mkApi(); view();
    expect(screen.getByText(/This system does not diagnose/)).toBeInTheDocument(); expect(screen.getByText(/Draft wording/)).toBeInTheDocument();
  });
  it('the Save button counts only rows with something typed, and is off when there are none', async () => {
    h.api = mkApi(); view();
    expect(screen.getByRole('button', { name: 'Save 0 people' })).toBeDisabled();
    await fillRow(1, 'Meera Das', '28', 'bukhar'); expect(screen.getByRole('button', { name: 'Save 1 person' })).toBeEnabled();
  });
  it('saves each person through registration, consent, visit, queue; says so; links to the record; refreshes the queue', async () => {
    const a = mkApi(); h.api = a; view();
    await userEvent.type(screen.getByLabelText(/Witness name/), 'A. Witness');
    await fillRow(1, 'Meera Das', '28', 'bukhar'); await fillRow(2, 'Ravi Nayak', '40', 'khansi');
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 people' }));
    await waitFor(() => expect(screen.getAllByText(/In the queue and assessed/)).toHaveLength(2));
    expect(a.registerPatient).toHaveBeenCalledTimes(2); expect(a.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ witnessName: 'A. Witness', purpose: 'care_triage' }));
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '/encounters/e1'); expect(h.refresh).toHaveBeenCalled();
    expect(screen.getByLabelText('Name, row 1')).toBeDisabled();            // saved rows are locked
  });
  it('a person without recorded consent is NOT saved, and the row says why', async () => {
    const a = mkApi(); h.api = a; view();
    await userEvent.type(screen.getByLabelText(/Witness name/), 'W');
    await fillRow(1, 'Meera Das', '28', 'bukhar', false);
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 person' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Consent has not been recorded'); expect(a.registerPatient).not.toHaveBeenCalled();
  });
  it('without a witness name nobody is saved', async () => {
    const a = mkApi(); h.api = a; view();
    await fillRow(1, 'Meera Das', '28', 'bukhar'); await userEvent.click(screen.getByRole('button', { name: 'Save 1 person' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('witness'); expect(a.registerPatient).not.toHaveBeenCalled();
  });
  it('one failing row does not stop the others, and pressing Save again continues the failed one only', async () => {
    const a = mkApi({ createEncounter: vi.fn().mockRejectedValueOnce(new Error('The change could not be saved. Try again.')).mockResolvedValue({ id: 'e2', status: 'draft' }) });
    h.api = a; view();
    await userEvent.type(screen.getByLabelText(/Witness name/), 'W'); await fillRow(1, 'Meera Das', '28', 'bukhar'); await fillRow(2, 'Ravi Nayak', '40', 'khansi');
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 people' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Try again to continue'));
    expect(screen.getAllByText(/In the queue and assessed/)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 person' }));
    await waitFor(() => expect(screen.getAllByText(/In the queue and assessed/)).toHaveLength(2));
    expect(a.registerPatient).toHaveBeenCalledTimes(2);                    // nobody registered twice
  });
  it('adds more rows', async () => {
    h.api = mkApi(); view(); await userEvent.click(screen.getByRole('button', { name: 'Add 5 rows' }));
    expect(screen.getByLabelText('Name, row 10')).toBeInTheDocument();
  });
  it('a possible duplicate is shown with who it matched and a "Different person" tick', async () => {
    const { ApiError } = await import('../lib/api');
    const a = mkApi({ registerPatient: vi.fn().mockRejectedValueOnce(new ApiError(409, 'dup', [{ id: 'old', publicRef: 'AR-0001', fullName: 'Meera Das', sex: 'female', birthDate: null, ageYears: 28 }])).mockResolvedValue({ id: 'p9', publicRef: 'AR-9' }) });
    h.api = a; view();
    await userEvent.type(screen.getByLabelText(/Witness name/), 'W'); await fillRow(1, 'Meera Das', '28', 'bukhar');
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 person' }));
    const alert = await screen.findByRole('alert'); expect(within(alert).getByText(/AR-0001/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Different person, row 1'));
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 person' }));
    await waitFor(() => expect(screen.getByText(/In the queue and assessed/)).toBeInTheDocument());
    expect((a.registerPatient as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toMatchObject({ confirmNotDuplicate: true });
  });
});
