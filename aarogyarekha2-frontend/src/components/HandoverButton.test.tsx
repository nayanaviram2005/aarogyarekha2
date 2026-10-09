import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';
import { HandoverButton } from './HandoverButton';

const mk = (fn = vi.fn().mockResolvedValue({ filename: 'handover-abc.pdf', blob: new Blob(['x']) })) => ({ downloadHandoverPdf: fn }) as unknown as Api & { downloadHandoverPdf: typeof fn };
beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn(); });

describe('handover summary button', () => {
  it('starts in the patient\'s own language and asks the server for that language', async () => {
    const a = mk(); render(<HandoverButton api={a} encounterId="e1" patientLanguage="hi" />);
    expect(screen.getByLabelText('Language')).toHaveValue('hi');
    expect(screen.getByText(/draft pending native-speaker review/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download summary (PDF)' }));
    await waitFor(() => expect(a.downloadHandoverPdf).toHaveBeenCalledWith('e1', 'hi'));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
  it('falls back to English for an unknown language, and lets the person pick another', async () => {
    const a = mk(); render(<HandoverButton api={a} encounterId="e1" patientLanguage="xx" />);
    expect(screen.getByLabelText('Language')).toHaveValue('en'); expect(screen.queryByText(/native-speaker/)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'or');
    await userEvent.click(screen.getByRole('button', { name: 'Download summary (PDF)' }));
    await waitFor(() => expect(a.downloadHandoverPdf).toHaveBeenCalledWith('e1', 'or'));
  });
  it('shows the server\'s reason when it fails, and enables the button again', async () => {
    const a = mk(vi.fn().mockRejectedValue(new ApiError(403, 'No active consent for triage is recorded for this patient. Record consent first.')));
    render(<HandoverButton api={a} encounterId="e1" patientLanguage="en" />);
    await userEvent.click(screen.getByRole('button', { name: 'Download summary (PDF)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No active consent');
    expect(screen.getByRole('button', { name: 'Download summary (PDF)' })).toBeEnabled();
  });
});
