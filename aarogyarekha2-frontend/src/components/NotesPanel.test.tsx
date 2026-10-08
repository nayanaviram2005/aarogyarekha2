import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, ReviewerNote } from '../lib/types';
import { NotesPanel } from './NotesPanel';

const n = (o: Partial<ReviewerNote> = {}): ReviewerNote => ({ id: 'n1', kind: 'comment', body: 'Recheck pulse', assessmentId: null, author: 'Nurse Das', at: '2026-10-07T08:00:00Z', ...o });
const api = (o: Record<string, unknown> = {}) => ({ notes: vi.fn().mockResolvedValue([n()]), addNote: vi.fn().mockResolvedValue({ id: 'x' }), ...o }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = (a: Api, p: { canWrite?: boolean; assessmentId?: string | null; disabled?: boolean } = {}) => render(<NotesPanel api={a} encounterId="e1" assessmentId={p.assessmentId === undefined ? 'a1' : p.assessmentId} canWrite={p.canWrite ?? true} disabled={p.disabled} />);

describe('NotesPanel', () => {
  it('says notes do not change the priority and lists them with author and kind', async () => { view(api()); expect(await screen.findByText('Recheck pulse')).toBeInTheDocument(); expect(screen.getByText(/do not change the priority/)).toBeInTheDocument(); expect(screen.getAllByText('Note').length).toBeGreaterThan(0); });
  it('escalations are shown in a warning', async () => { view(api({ notes: vi.fn().mockResolvedValue([n({ kind: 'escalation', body: 'Looks worse than the score' })]) })); expect(await screen.findByText('Escalated for a senior look')).toBeInTheDocument(); });
  it('adds a note, clears the box and reloads', async () => {
    const a = api(); view(a); await screen.findByText('Recheck pulse'); await userEvent.type(screen.getByLabelText('Note'), 'Pulse rechecked'); await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(a.addNote).toHaveBeenCalledWith('e1', { kind: 'comment', body: 'Pulse rechecked' })); expect(a.notes).toHaveBeenCalledTimes(2);
  });
  it('an escalation needs a reason and says so', async () => {
    const a = api(); view(a); await screen.findByText('Recheck pulse'); await userEvent.selectOptions(screen.getByLabelText('Add'), 'escalation'); await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Say why this needs a senior look.'); expect(a.addNote).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Why does this need a senior look?'), 'Worse than score'); await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(a.addNote).toHaveBeenCalledWith('e1', { kind: 'escalation', body: 'Worse than score' }));
  });
  it('feedback: helpful goes straight in', async () => {
    const a = api(); view(a); await userEvent.click(await screen.findByRole('button', { name: 'Helpful' })); await waitFor(() => expect(a.addNote).toHaveBeenCalledWith('e1', { kind: 'feedback_up', assessmentId: 'a1' }));
  });
  it('feedback: not helpful asks what was wrong, which is optional', async () => {
    const b = api(); view(b); await userEvent.click(await screen.findByRole('button', { name: 'Not helpful' })); await userEvent.type(screen.getByLabelText(/What was wrong/), 'Missed pregnancy'); await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(b.addNote).toHaveBeenCalledWith('e1', { kind: 'feedback_down', assessmentId: 'a1', body: 'Missed pregnancy' }));
  });
  it('feedback with no text is allowed; once given for this assessment it is not asked again', async () => {
    const a = api({ notes: vi.fn().mockResolvedValue([n({ kind: 'feedback_up', body: null, assessmentId: 'a1' })]) }); view(a); expect(await screen.findByText(/Feedback for this assessment is recorded/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
  });
  it('feedback for an OLDER assessment does not hide the question for the current one', async () => { view(api({ notes: vi.fn().mockResolvedValue([n({ kind: 'feedback_up', body: null, assessmentId: 'old' })]) })); expect(await screen.findByRole('button', { name: 'Helpful' })).toBeInTheDocument(); });
  it('no assessment yet: no feedback question. Not a reviewer or read-only: no forms at all', async () => {
    const { unmount } = view(api(), { assessmentId: null }); await screen.findByText('Recheck pulse'); expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument(); unmount();
    const u2 = view(api(), { canWrite: false }); await screen.findByText('Recheck pulse'); expect(screen.queryByLabelText('Note')).not.toBeInTheDocument(); u2.unmount();
    view(api(), { disabled: true }); await screen.findByText('Recheck pulse'); expect(screen.queryByLabelText('Note')).not.toBeInTheDocument();
  });
  it('the server\'s refusal and load failures are shown in words', async () => {
    view(api({ addNote: vi.fn().mockRejectedValue(new ApiError(403, 'Only a nurse, doctor or medical officer at this facility can add notes or feedback.')) })); await userEvent.type(await screen.findByLabelText('Note'), 'x'); await userEvent.click(screen.getByRole('button', { name: 'Add' })); expect(await screen.findByRole('alert')).toHaveTextContent('nurse, doctor or medical officer');
  });
  it('a load failure is shown', async () => { view(api({ notes: vi.fn().mockRejectedValue(new ApiError(503, 'Reviewer notes are not set up.')) })); expect(await screen.findByRole('alert')).toHaveTextContent('not set up'); });
});
