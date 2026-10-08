import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, MemberView } from '../lib/types';
import { MembersPanel } from './MembersPanel';

const m = (o: Partial<MemberView> = {}): MemberView => ({ userId: 'u1', facilityId: 'f1', role: 'nurse', active: true, since: '2026-01-01T00:00:00Z', name: 'Ravi', email: 'ravi@x.in', isSelf: false, canChange: true, ...o });
const admin = m({ userId: 'u0', name: 'Asha', email: 'asha@x.in', role: 'facility_admin', isSelf: true, canChange: false });
const api = (o: Record<string, unknown> = {}) => ({
  members: vi.fn().mockResolvedValue([admin, m()]), memberChanges: vi.fn().mockResolvedValue([{ at: '2026-10-07T08:00:00Z', facilityId: 'f1', op: 'set_role', role: 'doctor', previous: 'nurse', actor: 'Asha', target: 'Ravi' }]),
  addMember: vi.fn().mockResolvedValue({ userId: 'x', role: 'doctor', previous: 'none' }), setMemberRole: vi.fn().mockResolvedValue({ userId: 'u1', role: 'doctor', previous: 'nurse' }), removeMember: vi.fn().mockResolvedValue({ userId: 'u1', removed: true }), ...o,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
afterEach(() => vi.restoreAllMocks());

describe('MembersPanel', () => {
  it('lists people, marks you, and gives no controls for an administrator row', async () => {
    render(<MembersPanel api={api()} />);
    expect(await screen.findByText('Ravi')).toBeInTheDocument(); expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByLabelText('Role for Ravi')).toBeInTheDocument(); expect(screen.queryByLabelText('Role for Asha')).toBeNull(); expect(screen.getByText('Facility administrator')).toBeInTheDocument();
    expect(screen.getByText(/platform administrator/)).toBeInTheDocument(); expect(screen.getByText(/Role set · Ravi · Doctor \(was Nurse\)/)).toBeInTheDocument();
  });
  it('changes a role and reloads', async () => {
    const a = api(); render(<MembersPanel api={a} />); await userEvent.selectOptions(await screen.findByLabelText('Role for Ravi'), 'doctor');
    await waitFor(() => expect(a.setMemberRole).toHaveBeenCalledWith('u1', 'doctor', undefined)); expect(await screen.findByText('Role for Ravi is now Doctor.')).toBeInTheDocument(); expect(a.members).toHaveBeenCalledTimes(2);
  });
  it('removes after confirming, and not when declined', async () => {
    const a = api(); const c = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true); render(<MembersPanel api={a} />);
    const row = (await screen.findByText('Ravi')).closest('tr')!; await userEvent.click(within(row).getByRole('button', { name: 'Remove' })); expect(a.removeMember).not.toHaveBeenCalled();
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' })); await waitFor(() => expect(a.removeMember).toHaveBeenCalledWith('u1', undefined)); expect(c).toHaveBeenCalledTimes(2);
  });
  it('adds a person by email with the chosen role and clears the box', async () => {
    const a = api(); render(<MembersPanel api={a} />); await userEvent.type(await screen.findByLabelText('Email of their account'), 'new@x.in'); await userEvent.selectOptions(screen.getByLabelText('Role'), 'doctor'); await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(a.addMember).toHaveBeenCalledWith({ email: 'new@x.in', role: 'doctor' })); await waitFor(() => expect(screen.getByLabelText('Email of their account')).toHaveValue(''));
  });
  it('shows the server\'s plain refusal and keeps the typed email', async () => {
    const a = api({ addMember: vi.fn().mockRejectedValue(new ApiError(404, 'There is no account with that email.')) }); render(<MembersPanel api={a} />);
    await userEvent.type(await screen.findByLabelText('Email of their account'), 'no@x.in'); await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await screen.findByText('There is no account with that email.')).toBeInTheDocument(); expect(screen.getByLabelText('Email of their account')).toHaveValue('no@x.in');
  });
  it('a removed person can be added back; the add button is off with no email', async () => {
    const a = api({ members: vi.fn().mockResolvedValue([m({ active: false })]) }); render(<MembersPanel api={a} />);
    expect(screen.getByRole('button', { name: 'Add person' })).toBeDisabled(); await userEvent.click(await screen.findByRole('button', { name: 'Add back' })); await waitFor(() => expect(a.setMemberRole).toHaveBeenCalledWith('u1', 'nurse', undefined));
  });
  it('names the facility only when the person administers more than one', async () => {
    const a = api({ members: vi.fn().mockResolvedValue([m(), m({ userId: 'u9', name: 'Mala', facilityId: 'f2' })]) }); render(<MembersPanel api={a} />);
    await userEvent.selectOptions(await screen.findByLabelText('Role for Mala'), 'doctor'); await waitFor(() => expect(a.setMemberRole).toHaveBeenCalledWith('u9', 'doctor', 'f2'));
  });
  it('a failed load says why', async () => { render(<MembersPanel api={api({ members: vi.fn().mockRejectedValue(new ApiError(403, 'Administrator access is needed for this screen.')) })} />); expect(await screen.findByText('Administrator access is needed for this screen.')).toBeInTheDocument(); });
});
