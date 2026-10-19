import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignOutOthers } from './SignOutOthers';

describe('SignOutOthers', () => {
  it('signs out the other devices and says this one stays signed in', async () => {
    const fn = vi.fn().mockResolvedValue(null); render(<SignOutOthers signOutOthers={fn} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out of my other devices' }));
    expect(await screen.findByRole('status')).toHaveTextContent('This one stays signed in'); expect(fn).toHaveBeenCalledTimes(1);
  });
  it('shows the problem plainly as an alert', async () => {
    render(<SignOutOthers signOutOthers={vi.fn().mockResolvedValue('The other devices could not be signed out. Try again.')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out of my other devices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be signed out');
  });
});
