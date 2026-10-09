import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, ReviewerNote } from '../lib/types';
import { DoctorNotesPanel } from './DoctorNotesPanel';

const note = (o: Partial<ReviewerNote> = {}): ReviewerNote => ({ id: 'n1', kind: 'doctor_note', body: 'Started oral antibiotics; review in 3 days.', assessmentId: null, author: 'Dr Rao', at: '2026-10-07T09:00:00Z', ...o });
const mk = (over: Record<string, unknown> = {}) => ({
  notes: vi.fn().mockResolvedValue([note(), note({ id: 'n2', kind: 'comment', body: 'Recheck pulse', author: 'Nurse Das' })]), addNote: vi.fn().mockResolvedValue({ id: 'n3' }), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = (a: Api, p: Partial<{ status: string; canWrite: boolean; disabled: boolean }> = {}) => render(<DoctorNotesPanel api={a} encounterId="e1" status={p.status ?? 'reviewed'} canWrite={p.canWrite ?? true} {...(p.disabled ? { disabled: true } : {})} />);

describe('DoctorNotesPanel', () => {
  it('lists only the doctor’s notes, with who wrote them and when, and says they join the patient’s file', async () => {
    view(mk()); expect(await screen.findByText('Started oral antibiotics; review in 3 days.')).toBeInTheDocument();
    expect(screen.getByText('Dr Rao')).toBeInTheDocument(); expect(screen.queryByText('Recheck pulse')).toBeNull();
    expect(screen.getByText(/joins the patient’s file/)).toBeInTheDocument(); expect(screen.getByText(/including through emergency access/)).toBeInTheDocument(); expect(screen.getByText(/cannot be edited or removed/)).toBeInTheDocument();
  });
  it('adds a note, sends it as a doctor’s note, clears the box and reloads the list', async () => {
    const a = mk(); view(a); await screen.findByText('Dr Rao');
    await userEvent.type(screen.getByLabelText('Doctor’s note'), '  Advised rest and fluids.  '); expect(screen.getByText('28 of 2000 characters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add doctor’s note' }));
    await waitFor(() => expect(a.addNote).toHaveBeenCalledWith('e1', { kind: 'doctor_note', body: 'Advised rest and fluids.' }));
    expect(await screen.findByText('Added to the patient’s file.')).toBeInTheDocument(); expect(screen.getByLabelText('Doctor’s note')).toHaveValue(''); expect(a.notes).toHaveBeenCalledTimes(2);
  });
  it('an empty note is stopped before anything is sent', async () => {
    const a = mk(); view(a); await screen.findByText('Dr Rao'); await userEvent.click(screen.getByRole('button', { name: 'Add doctor’s note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Write the doctor’s note.'); expect(a.addNote).not.toHaveBeenCalled();
  });
  it('shows the server’s reason when the note is refused, and keeps the text', async () => {
    const a = mk({ addNote: vi.fn().mockRejectedValue(new ApiError(403, 'Only a doctor or medical officer at this facility can add a doctor’s note.')) }); view(a); await screen.findByText('Dr Rao');
    await userEvent.type(screen.getByLabelText('Doctor’s note'), 'Seen'); await userEvent.click(screen.getByRole('button', { name: 'Add doctor’s note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a doctor or medical officer'); expect(screen.getByLabelText('Doctor’s note')).toHaveValue('Seen');
  });
  it('before sign-off there is no form, only the reason why', async () => {
    view(mk(), { status: 'in_review' }); expect(await screen.findByText(/once the priority has been signed off/)).toBeInTheDocument(); expect(screen.queryByLabelText('Doctor’s note')).toBeNull();
  });
  it('a nurse sees the notes but no form', async () => {
    view(mk(), { canWrite: false }); expect(await screen.findByText('Started oral antibiotics; review in 3 days.')).toBeInTheDocument();
    expect(screen.getByText(/Only a doctor or medical officer at this facility can add/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add doctor’s note' })).toBeNull();
  });
  it('without the patient’s agreement the form is off', async () => {
    view(mk(), { disabled: true }); await screen.findByText('Dr Rao'); expect(screen.queryByLabelText('Doctor’s note')).toBeNull();
  });
  it('says when there are none yet', async () => {
    view(mk({ notes: vi.fn().mockResolvedValue([]) })); expect(await screen.findByText('No doctor’s notes yet.')).toBeInTheDocument();
  });
});
