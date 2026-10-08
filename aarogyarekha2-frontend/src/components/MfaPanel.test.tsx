import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MfaApi } from '../lib/types';
import { MfaPanel } from './MfaPanel';

const mfa = (over: Partial<MfaApi> = {}): MfaApi & Record<string, ReturnType<typeof vi.fn>> => ({
  hasFactor: vi.fn().mockResolvedValue(true), enroll: vi.fn().mockResolvedValue({ factorId: 'f1', qr: 'data:image/svg+xml;base64,AAAA', secret: 'JBSWY3DPEHPK3PXP' }), verify: vi.fn().mockResolvedValue(null), ...over,
}) as never;

describe('MfaPanel', () => {
  it('with an authenticator already set up, asks only for the 6-digit code', async () => {
    render(<MfaPanel mfa={mfa()} onVerified={() => {}} />);
    expect(await screen.findByLabelText('6-digit code from your authenticator app')).toBeInTheDocument();
    expect(screen.queryByText('Set up authenticator app')).not.toBeInTheDocument();
  });
  it('the Verify button waits for exactly six digits, and letters are ignored', async () => {
    render(<MfaPanel mfa={mfa()} onVerified={() => {}} />);
    const box = await screen.findByLabelText(/6-digit code/);
    const btn = screen.getByRole('button', { name: 'Verify' });
    await userEvent.type(box, '12ab345'); expect(box).toHaveValue('12345'); expect(btn).toBeDisabled();
    await userEvent.type(box, '6'); expect(btn).toBeEnabled();
  });
  it('a right code verifies the session and tells the screen', async () => {
    const onVerified = vi.fn(); const m = mfa();
    render(<MfaPanel mfa={m} onVerified={onVerified} />);
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(m.verify).toHaveBeenCalledWith('123456', undefined);
  });
  it('a wrong code shows a plain message, clears the box and does not continue', async () => {
    const onVerified = vi.fn();
    render(<MfaPanel mfa={mfa({ verify: vi.fn().mockResolvedValue('That code is not correct, or it has expired. Check the code in your app and try again.') })} onVerified={onVerified} />);
    const box = await screen.findByLabelText(/6-digit code/);
    await userEvent.type(box, '000000'); await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not correct');
    expect(box).toHaveValue(''); expect(onVerified).not.toHaveBeenCalled();
  });
  it('a network failure is shown instead of crashing', async () => {
    render(<MfaPanel mfa={mfa({ verify: vi.fn().mockRejectedValue(new Error('x')) })} onVerified={() => {}} />);
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456'); await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
  });
  it('with no authenticator yet it offers setup, shows the picture and the typed key, then verifies against the new factor', async () => {
    const m = mfa({ hasFactor: vi.fn().mockResolvedValue(false) }); const onVerified = vi.fn();
    render(<MfaPanel mfa={m} onVerified={onVerified} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up authenticator app' }));
    expect(await screen.findByAltText(/QR code/)).toHaveAttribute('src', 'data:image/svg+xml;base64,AAAA');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/6-digit code/), '654321'); await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(m.verify).toHaveBeenCalledWith('654321', 'f1');
  });
  it('a setup failure is shown and can be retried', async () => {
    const enroll = vi.fn().mockRejectedValueOnce(new Error('Two-factor setup could not be started. Try again.')).mockResolvedValue({ factorId: 'f', qr: 'data:x', secret: 'S' });
    render(<MfaPanel mfa={mfa({ hasFactor: vi.fn().mockResolvedValue(false), enroll })} onVerified={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up authenticator app' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be started');
    await userEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }));
    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
  });
});
