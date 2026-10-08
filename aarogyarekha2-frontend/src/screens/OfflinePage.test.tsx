import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';
import { createOutbox, memoryStore } from '../offline/outbox';

const h = vi.hoisted(() => ({ api: null as unknown, refresh: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./queueContext', () => ({ useQueue: () => ({ entries: [], loading: false, error: null, generatedAt: null, refresh: h.refresh }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
import { OfflinePage } from './OfflinePage';

const mkApi = (over: Record<string, unknown> = {}) => ({
  registerPatient: vi.fn().mockResolvedValue({ id: 'p1', publicRef: 'AR-1' }), recordConsent: vi.fn().mockResolvedValue({ id: 'c' }), createEncounter: vi.fn().mockResolvedValue({ id: 'e1', status: 'draft' }),
  addVital: vi.fn().mockResolvedValue({}), submit: vi.fn().mockResolvedValue({}), assess: vi.fn().mockResolvedValue({}), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const setOnline = (v: boolean) => { Object.defineProperty(navigator, 'onLine', { value: v, configurable: true }); };
const fill = async () => {
  await userEvent.type(screen.getByLabelText('Witness name'), 'A. Witness'); await userEvent.type(screen.getByLabelText('Name'), 'Meera Das');
  await userEvent.type(screen.getByLabelText('Age in years'), '28'); await userEvent.type(screen.getByLabelText(/Main complaint/), 'bukhar');
  await userEvent.click(screen.getByLabelText(/The notice was read/));
};
const view = (o = createOutbox(memoryStore())) => ({ o, ...render(<MemoryRouter><OfflinePage outbox={o} /></MemoryRouter>) });

beforeEach(() => { h.refresh.mockReset(); setOnline(true); h.api = mkApi(); });

describe('OfflinePage', () => {
  it('says what protects the notes and what does not leave the computer until sent', () => {
    view(); expect(screen.getByText(/Take notes while the connection is down/)).toBeInTheDocument();
  });
  it('offline: shows a warning and turns sending off', async () => {
    setOnline(false); const o = createOutbox(memoryStore()); await o.put('x', { row: { name: 'A', age: '3', complaint: 'c', consented: true, sex: 'unknown', language: 'en', temperature: '' }, witness: 'W' }); view(o);
    expect(screen.getByText('You are offline')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Send 1 note' })).toBeDisabled(); expect(screen.getByText(/Sending is off/)).toBeInTheDocument();
  });
  it('saving puts an ENCRYPTED note on the device and sends nothing', async () => {
    const a = mkApi(); h.api = a; const store = memoryStore(); const { o } = view(createOutbox(store)); await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Save on this computer' }));
    expect(await screen.findByText(/Meera Das/)).toBeInTheDocument();
    expect(screen.getByText('Saved on this computer (1)')).toBeInTheDocument(); expect(a.registerPatient).not.toHaveBeenCalled();
    const raw = (await store.get((await store.keys()).find(k => k.startsWith('note:'))!)) as { ct: ArrayBuffer };
    expect(new TextDecoder('latin1').decode(raw.ct)).not.toContain('Meera'); expect((await o.list())).toHaveLength(1);
  });
  it('does not save a note without consent or a witness, and says why', async () => {
    view(); await userEvent.type(screen.getByLabelText('Name'), 'Meera Das'); await userEvent.type(screen.getByLabelText('Age in years'), '28'); await userEvent.type(screen.getByLabelText(/Main complaint/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save on this computer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Consent has not been recorded'); expect(screen.getByText('Nothing saved.')).toBeInTheDocument();
  });
  it('sends the saved notes through the same steps as camp registration and removes the ones that went through', async () => {
    const a = mkApi(); h.api = a; const { o } = view(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Save on this computer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send 1 note' }));
    await waitFor(() => expect(screen.getByText('Nothing saved.')).toBeInTheDocument());
    expect(a.registerPatient).toHaveBeenCalledTimes(1); expect(a.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ witnessName: 'A. Witness' }));
    expect(await o.list()).toEqual([]); expect(h.refresh).toHaveBeenCalled();
  });
  it('a note that fails stays on the device with its progress, and a retry does not register the person twice', async () => {
    const a = mkApi({ createEncounter: vi.fn().mockRejectedValueOnce(new ApiError(502, 'The change could not be saved. Try again.')).mockResolvedValue({ id: 'e1', status: 'draft' }) }); h.api = a;
    const { o } = view(); await fill(); await userEvent.click(screen.getByRole('button', { name: 'Save on this computer' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send 1 note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again to continue'); expect(await o.list()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Send 1 note' }));
    await waitFor(() => expect(screen.getByText('Nothing saved.')).toBeInTheDocument());
    expect(a.registerPatient).toHaveBeenCalledTimes(1);
  });
  it('discard deletes one note; delete-all wipes everything', async () => {
    const o = createOutbox(memoryStore()); await o.put('a', { row: { name: 'Anil', age: '5' }, witness: 'W' }); await o.put('b', { row: { name: 'Bina', age: '6' }, witness: 'W' }); view(o);
    expect(await screen.findByText(/Anil/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Discard' })[0]!);
    await waitFor(() => expect(screen.queryByText(/Anil/)).not.toBeInTheDocument()); expect(screen.getByText(/Bina/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete all saved notes' }));
    await waitFor(() => expect(screen.getByText('Nothing saved.')).toBeInTheDocument()); expect(await o.list()).toEqual([]);
  });
  it('notes saved earlier show when the page opens', async () => {
    const o = createOutbox(memoryStore()); await o.put('a', { row: { name: 'Anil', age: '5' }, witness: 'W' });
    view(o); expect(await screen.findByText(/Anil/)).toBeInTheDocument();
  });
});
