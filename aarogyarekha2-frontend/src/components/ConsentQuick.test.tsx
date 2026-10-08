import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MeContext } from '../screens/meContext';
import type { Api, Me } from '../lib/types';
import { ConsentForm, NOTICE_VERSION } from './ConsentForm';

const me = (name: string | null) => ({ userId: 'u', displayName: name, memberships: [] }) as Me;
const view = (m: Me | null, props: { purpose?: 'care_triage' | 'external_ai_processing' } = {}) => {
  const api = { recordConsent: vi.fn().mockResolvedValue({ id: 'c' }) } as unknown as Api & { recordConsent: ReturnType<typeof vi.fn> };
  const onRecorded = vi.fn();
  render(<MeContext.Provider value={m}><ConsentForm api={api} patientId="p1" onRecorded={onRecorded} {...props} /></MeContext.Provider>);
  return { api, onRecorded };
};

describe('consent in one tap', () => {
  it('shows the notice to read aloud and one button; it records spoken consent from the patient, witnessed by the person recording', async () => {
    const { api, onRecorded } = view(me('Seed Nurse A'));
    expect(screen.getByText(/Read this to the patient/)).toBeInTheDocument(); expect(screen.getByText(/Recorded as spoken consent from the patient, witnessed by Seed Nurse A/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Patient agrees' }));
    await waitFor(() => expect(api.recordConsent).toHaveBeenCalledWith('p1', { purpose: 'care_triage', givenBy: 'self', method: 'verbal_witnessed', noticeVersion: NOTICE_VERSION, witnessName: 'Seed Nurse A' }));
    expect(onRecorded).toHaveBeenCalled();
  });
  it('works for the outside-AI consent too, with that notice', async () => {
    const { api } = view(me('Seed Nurse A'), { purpose: 'external_ai_processing' });
    await userEvent.click(screen.getByRole('button', { name: 'Patient agrees' })); await waitFor(() => expect(api.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ purpose: 'external_ai_processing', method: 'verbal_witnessed' })));
  });
  it('a guardian, paper or another witness is one click away and opens the full form, which still needs a witness name', async () => {
    const { api } = view(me('Seed Nurse A'));
    await userEvent.click(screen.getByRole('button', { name: /A guardian, a paper form, or someone else/ }));
    expect(screen.getByLabelText('Consent given by')).toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    expect(screen.getByText('Enter the name of the witness.')).toBeInTheDocument(); expect(api.recordConsent).not.toHaveBeenCalled();
  });
  it('without a known staff name it shows the full form (nobody is assumed to be the witness)', () => {
    view(me(null)); expect(screen.getByLabelText('Consent given by')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Patient agrees' })).toBeNull();
    view(null);
  });
  it('shows the server\'s plain refusal and keeps the button usable', async () => {
    const api = { recordConsent: vi.fn().mockRejectedValue(new Error('You are not allowed to do this at this facility.')) } as unknown as Api;
    render(<MeContext.Provider value={me('Seed Nurse A')}><ConsentForm api={api} patientId="p1" onRecorded={() => {}} /></MeContext.Provider>);
    await userEvent.click(screen.getByRole('button', { name: 'Patient agrees' })); expect(await screen.findByText('You are not allowed to do this at this facility.')).toBeInTheDocument();
  });
});

describe('consent as a pop-up', () => {
  const popup = (onCancel = vi.fn()) => {
    const api = { recordConsent: vi.fn().mockResolvedValue({ id: 'c' }) } as unknown as Api;
    render(<MeContext.Provider value={me('Seed Nurse A')}><ConsentForm api={api} patientId="p1" onRecorded={() => {}} dialog onCancel={onCancel} intro={<p>Consent is needed first.</p>} /></MeContext.Provider>);
    return { api, onCancel };
  };
  it('is a modal dialog with the explanation and the one-tap button inside it', () => {
    popup();
    const d = screen.getByRole('dialog', { name: 'Consent for triage' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveTextContent('Consent is needed first.'); expect(d).toContainElement(screen.getByRole('button', { name: 'Patient agrees' }));
  });
  it('closes with Escape or Close and records nothing', async () => {
    const { api, onCancel } = popup();
    await userEvent.keyboard('{Escape}'); expect(onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close' })); expect(onCancel).toHaveBeenCalledTimes(2);
    expect(api.recordConsent).not.toHaveBeenCalled();
  });
  it('without dialog it stays an ordinary inline section', () => {
    view(me('Seed Nurse A')); expect(screen.queryByRole('dialog')).toBeNull();
  });
});
