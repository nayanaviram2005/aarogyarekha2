import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../lib/types';
import { ConsentForm, TRAINING_NOTICE_VERSION } from './ConsentForm';

vi.mock('../screens/meContext', () => ({ useMe: () => ({ displayName: 'Nurse Devi', memberships: [] }) }));

const api = () => ({ recordConsent: vi.fn().mockResolvedValue({ id: 'c' }) }) as unknown as Api & { recordConsent: ReturnType<typeof vi.fn> };

describe('consent for triage, with the optional anonymous training copy', () => {
  it('records only the care consent when the training box is left alone', async () => {
    const a = api(); const done = vi.fn();
    render(<ConsentForm api={a} patientId="p1" onRecorded={done} />);
    await userEvent.click(screen.getByRole('button', { name: 'Patient agrees' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(a.recordConsent).toHaveBeenCalledTimes(1);
    expect(a.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ purpose: 'care_triage' }));
  });

  it('records a second, separate consent when the patient also agrees to the anonymous copy', async () => {
    const a = api(); const done = vi.fn();
    render(<ConsentForm api={a} patientId="p1" onRecorded={done} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /anonymous copy of this case being used to train the triage tool/ }));
    expect(screen.getByText(/cannot be traced to you/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Patient agrees' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(a.recordConsent).toHaveBeenCalledTimes(2);
    expect(a.recordConsent).toHaveBeenNthCalledWith(1, 'p1', expect.objectContaining({ purpose: 'care_triage' }));
    expect(a.recordConsent).toHaveBeenNthCalledWith(2, 'p1', expect.objectContaining({ purpose: 'research_deidentified', noticeVersion: TRAINING_NOTICE_VERSION, witnessName: 'Nurse Devi', givenBy: 'self' }));
  });

  it('does not offer the training copy on other consents', () => {
    render(<ConsentForm api={api()} patientId="p1" onRecorded={() => {}} purpose="referral_sharing" />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
