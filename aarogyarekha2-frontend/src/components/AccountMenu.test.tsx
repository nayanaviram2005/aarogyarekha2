import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { accountLabel, primaryRole, rolesByFacility, rolesOf } from '../lib/account';
import type { Me } from '../lib/types';
import { AccountMenu } from './AccountMenu';

const mem = (role: string, facilityId = 'f1', facilityName = 'Seed PHC Khordha') => ({ facilityId, facilityName, facilityType: 'phc', role });
const me = (name: string | null, ...roles: ReturnType<typeof mem>[]): Me => ({ userId: 'u', displayName: name, memberships: roles }) as Me;

describe('account label', () => {
  it('shows the name and role, like "Seed Doctor A · Doctor"', () => {
    expect(accountLabel(me('Seed Doctor A', mem('doctor')))).toBe('Seed Doctor A · Doctor');
    expect(accountLabel(me('Seed Nurse A', mem('nurse')))).toBe('Seed Nurse A · Nurse');
    expect(accountLabel(me('Seed Health Worker A', mem('health_worker')))).toBe('Seed Health Worker A · Health worker');
    expect(accountLabel(me('Seed Admin', mem('facility_admin')))).toMatch(/Seed Admin · Facility administrator/);
  });
  it('the most senior role leads when someone holds several, with a count of the rest', () => {
    const m = me('Dr. R', mem('nurse'), mem('doctor', 'f2', 'DH'), mem('facility_admin'));
    expect(primaryRole(m)).toBe('doctor'); expect(rolesOf(m)).toEqual(['doctor', 'nurse', 'facility_admin']); expect(accountLabel(m)).toBe('Dr. R · Doctor +2');
  });
  it('never sits empty: no name, no role, or nothing loaded yet', () => {
    expect(accountLabel(me(null, mem('nurse')))).toBe('Nurse'); expect(accountLabel(me('Someone'))).toBe('Someone'); expect(accountLabel(null)).toBe('Signed in');
  });
  it('lists roles per facility', () => {
    expect(rolesByFacility(me('A', mem('nurse'), mem('doctor'), mem('doctor', 'f2', 'DH')))).toEqual([{ facility: 'Seed PHC Khordha', roles: ['Nurse', 'Doctor'] }, { facility: 'DH', roles: ['Doctor'] }]);
  });
});

const view = (m: Me | null, o: { loadFailed?: boolean; needMfa?: boolean } = {}) => {
  const f = { signOut: vi.fn(), setLow: vi.fn(), verify: vi.fn(), retry: vi.fn() };
  render(<MemoryRouter><I18nProvider><AccountMenu me={m} loadFailed={o.loadFailed} onRetry={f.retry} lowData={false} setLowData={f.setLow} needMfa={o.needMfa ?? false} onVerifyMfa={f.verify} onSignOut={f.signOut} /></I18nProvider></MemoryRouter>);
  return f;
};

describe('AccountMenu', () => {
  it('is a button with the name and role that opens a menu with the person\'s facility and role', async () => {
    view(me('Seed Doctor A', mem('doctor')));
    const b = screen.getByRole('button', { name: /Seed Doctor A · Doctor/ }); expect(b).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(b); expect(b).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByText('Seed PHC Khordha: Doctor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings'); expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
  it('closes with Escape (focus returns to the button) and on a click outside', async () => {
    view(me('Seed Nurse A', mem('nurse'))); const b = screen.getByRole('button', { name: /Seed Nurse A/ });
    await userEvent.click(b); await userEvent.keyboard('{Escape}'); expect(b).toHaveAttribute('aria-expanded', 'false'); expect(b).toHaveFocus();
    await userEvent.click(b); await userEvent.click(document.body); expect(b).toHaveAttribute('aria-expanded', 'false');
  });
  it('signing out and the low-data switch work from the menu; the administration link is for administrators only', async () => {
    const f = view(me('Seed Admin', mem('facility_admin'))); await userEvent.click(screen.getByRole('button', { name: /Seed Admin/ }));
    expect(screen.getByRole('link', { name: 'Administration and people' })).toHaveAttribute('href', '/admin');
    await userEvent.click(screen.getByLabelText('Low data mode')); expect(f.setLow).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' })); expect(f.signOut).toHaveBeenCalled();
  });
  it('a clinician sees no administration link', async () => {
    view(me('Seed Doctor A', mem('doctor'))); await userEvent.click(screen.getByRole('button', { name: /Seed Doctor A/ })); expect(screen.queryByRole('link', { name: 'Administration and people' })).toBeNull();
  });
  it('when the profile could not load, it says so and offers to try again; it never hides the sign-out', async () => {
    const f = view(null, { loadFailed: true }); await userEvent.click(screen.getByRole('button', { name: /Signed in/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded'); await userEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(f.retry).toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
  it('someone with no role is told to ask their administrator', async () => { view(me('New User')); await userEvent.click(screen.getByRole('button', { name: /New User/ })); expect(screen.getByText(/No role at any facility yet/)).toBeInTheDocument(); });
  it('offers two-factor verification only when it is needed', async () => {
    const f = view(me('Seed Doctor A', mem('doctor')), { needMfa: true }); await userEvent.click(screen.getByRole('button', { name: /Seed Doctor A/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Verify two-factor sign-in' })); expect(f.verify).toHaveBeenCalled();
  });
});
