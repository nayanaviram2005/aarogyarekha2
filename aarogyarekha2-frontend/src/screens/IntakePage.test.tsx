import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../lib/types';

const h = vi.hoisted(() => ({ api: null as unknown, refresh: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./queueContext', () => ({ useQueue: () => ({ entries: [], loading: false, error: null, generatedAt: null, refresh: h.refresh }) }));
vi.mock('./PaneFrame', () => ({ PaneFrame: ({ center }: { center: React.ReactNode }) => <div>{center}</div> }));
import { IntakePage } from './IntakePage';

const mkApi = () => ({
  readRecord: vi.fn().mockResolvedValue({ identity: { fullName: 'Asha Rao', ageYears: 27, sex: 'female' }, rows: 3, readable: true, note: null, averageConfidence: null }),
  registerPatient: vi.fn().mockResolvedValue({ id: 'p1', publicRef: 'AR-1' }),
  createEncounter: vi.fn().mockResolvedValue({ id: 'e1', status: 'draft' }),
  uploadDocument: vi.fn().mockResolvedValue({ id: 'd1', metadataBytesRemoved: 0 }),
  extractDocument: vi.fn().mockResolvedValue({}),
  addSymptom: vi.fn().mockResolvedValue({}), addVital: vi.fn().mockResolvedValue({}), saveInputs: vi.fn().mockResolvedValue({}),
  submit: vi.fn().mockResolvedValue({}), assess: vi.fn().mockResolvedValue({}), recordConsent: vi.fn().mockResolvedValue({ id: 'c' }),
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;

const registerFromReport = async () => {
  render(<MemoryRouter><IntakePage /></MemoryRouter>);
  await userEvent.upload(screen.getByLabelText('Patient records (optional)'), new File(['x'], 'cbc.pdf', { type: 'application/pdf' }));
  const go = await screen.findByRole('button', { name: 'Extract details and register' });
  await waitFor(() => expect(go).toBeEnabled());
  await userEvent.click(go);
};

let a: ReturnType<typeof mkApi>;
beforeEach(() => { a = mkApi(); h.api = a; });

describe('registering from a record', () => {
  it('registers the person and opens the complaint screen, without starting a visit', async () => {
    await registerFromReport();
    expect(await screen.findByLabelText(/Main complaint/)).toBeInTheDocument();
    expect(screen.getByText('Asha Rao is registered')).toBeInTheDocument();
    expect(a.registerPatient).toHaveBeenCalledTimes(1);
    expect(a.createEncounter).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Temperature (°C)')).toBeInTheDocument();
  });
  it('will not put anyone in the queue without a complaint, and says to write Routine for a check-up', async () => {
    await registerFromReport();
    await userEvent.click(await screen.findByRole('button', { name: 'Get the priority' }));
    expect((await screen.findAllByText(/Enter the main complaint/))[0]).toHaveTextContent('Routine');
    expect(a.createEncounter).not.toHaveBeenCalled();
  });
  it('starts the visit with the typed complaint and attaches the report', async () => {
    await registerFromReport();
    await userEvent.type(await screen.findByLabelText(/Main complaint/), 'Routine');
    await userEvent.click(screen.getByRole('button', { name: 'Get the priority' }));
    await waitFor(() => expect(a.createEncounter).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'p1', chiefComplaint: 'Routine' })));
    await waitFor(() => expect(a.uploadDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(a.assess).toHaveBeenCalledWith('e1'));
  });
  it('treats a complaint of only spaces as missing', async () => {
    await registerFromReport();
    await userEvent.type(await screen.findByLabelText(/Main complaint/), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Get the priority' }));
    expect((await screen.findAllByText(/Enter the main complaint/)).length).toBeGreaterThan(0);
    expect(a.createEncounter).not.toHaveBeenCalled();
  });
});
