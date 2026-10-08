import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, Followup } from '../lib/types';
import { FollowupsPanel } from './FollowupsPanel';

const fu = (over: Partial<Followup> = {}): Followup => ({ id: 'f1', kind: 'anc_visit', cadenceDays: 28, nextDueAt: '2026-10-20T04:30:00Z', active: true, createdAt: '2026-10-06T00:00:00Z', reminders: [], ...over });
const api = (over: Record<string, unknown> = {}) => ({
  followups: vi.fn().mockResolvedValue([fu()]), createFollowup: vi.fn().mockResolvedValue({ id: 'f2', nextDueAt: '2026-10-14T00:00:00Z' }),
  scheduleReminder: vi.fn().mockResolvedValue({ id: 'r', dueAt: 'x', channel: 'sms', status: 'scheduled' }), stopFollowup: vi.fn().mockResolvedValue({ id: 'f1', active: false }),
  recordConsent: vi.fn().mockResolvedValue({ id: 'c' }), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = (a: Api, editable = true) => render(<FollowupsPanel api={a} encounterId="e1" patientId="p1" editable={editable} />);

describe('FollowupsPanel', () => {
  it('says reminders are fixed-text and only a test sender, so nobody thinks a real SMS went out', async () => {
    view(api()); await screen.findByText(/Antenatal visit/);
    expect(screen.getByText(/only the facility name and the date/)).toBeInTheDocument(); expect(screen.getByText(/nothing is sent to a real phone/)).toBeInTheDocument();
  });
  it('lists follow-ups with the repeat rhythm and each reminder\'s plain status', async () => {
    view(api({ followups: vi.fn().mockResolvedValue([fu({ reminders: [{ id: 'r1', due_at: '2026-10-20T04:30:00Z', channel: 'whatsapp', status: 'failed', sent_at: null }, { id: 'r2', due_at: '2026-10-20T04:30:00Z', channel: 'sms', status: 'scheduled', sent_at: null }] })]) }));
    expect(await screen.findByText(/repeats every 28 days/)).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp on .*: Not sent/)).toBeInTheDocument(); expect(screen.getByText(/SMS on .*: Waiting to be sent/)).toBeInTheDocument();
  });
  it('shows an empty state', async () => {
    view(api({ followups: vi.fn().mockResolvedValue([]) })); expect(await screen.findByText('No follow-up planned.')).toBeInTheDocument();
  });
  it('plans a follow-up with the chosen kind, days and repeat, then reloads', async () => {
    const a = api({ followups: vi.fn().mockResolvedValue([]) }); view(a);
    await screen.findByText('No follow-up planned.');
    await userEvent.selectOptions(screen.getByLabelText('Plan a follow-up'), 'vaccination');
    await userEvent.clear(screen.getByLabelText('Days until visit')); await userEvent.type(screen.getByLabelText('Days until visit'), '14');
    await userEvent.type(screen.getByLabelText('Repeat every (days)'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Plan follow-up' }));
    await waitFor(() => expect(a.createFollowup).toHaveBeenCalledWith('e1', { kind: 'vaccination', firstDueInDays: 14, cadenceDays: 30 }));
    expect(a.followups).toHaveBeenCalledTimes(2);
  });
  it('leaving repeat empty plans a one-off', async () => {
    const a = api({ followups: vi.fn().mockResolvedValue([]) }); view(a); await screen.findByText('No follow-up planned.');
    await userEvent.click(screen.getByRole('button', { name: 'Plan follow-up' }));
    await waitFor(() => expect(a.createFollowup).toHaveBeenCalledWith('e1', { kind: 'anc_visit', firstDueInDays: 7 }));
  });
  it.each([['abc', ''], ['-1', ''], ['400', ''], ['1.5', ''], ['7', '0'], ['7', 'x']])('refuses days=%s repeat=%s with a plain message and sends nothing', async (d, r) => {
    const a = api({ followups: vi.fn().mockResolvedValue([]) }); view(a); await screen.findByText('No follow-up planned.');
    await userEvent.clear(screen.getByLabelText('Days until visit')); await userEvent.type(screen.getByLabelText('Days until visit'), d);
    if (r) await userEvent.type(screen.getByLabelText('Repeat every (days)'), r);
    await userEvent.click(screen.getByRole('button', { name: 'Plan follow-up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number/); expect(a.createFollowup).not.toHaveBeenCalled();
  });
  it('schedules a reminder on the chosen channel', async () => {
    const a = api(); view(a); await screen.findByText(/Antenatal visit/);
    await userEvent.selectOptions(screen.getByLabelText('Remind by'), 'ivr');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule reminder' }));
    await waitFor(() => expect(a.scheduleReminder).toHaveBeenCalledWith('f1', { channel: 'ivr' }));
  });
  it('without the patient\'s consent it asks for it, records the reminders purpose, and schedules by itself', async () => {
    const schedule = vi.fn().mockRejectedValueOnce(new ApiError(403, 'The patient has not agreed to reminders. Record that consent first.')).mockResolvedValue({ id: 'r', dueAt: 'x', channel: 'sms', status: 'scheduled' });
    const a = api({ scheduleReminder: schedule }); view(a); await screen.findByText(/Antenatal visit/);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule reminder' }));
    expect(await screen.findByText('Record consent for reminders')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Witness name'), 'A. Witness'); await userEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    await waitFor(() => expect(a.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ purpose: 'reminders' })));
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));
  });
  it('other errors are shown in words, with no consent form', async () => {
    view(api({ scheduleReminder: vi.fn().mockRejectedValue(new ApiError(409, 'This follow-up has been stopped.')) })); await screen.findByText(/Antenatal visit/);
    await userEvent.click(screen.getByRole('button', { name: 'Schedule reminder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('has been stopped'); expect(screen.queryByText(/Record consent/)).not.toBeInTheDocument();
  });
  it('stopping a follow-up reloads the list', async () => {
    const a = api(); view(a); await screen.findByText(/Antenatal visit/);
    await userEvent.click(screen.getByRole('button', { name: 'Stop follow-up' }));
    await waitFor(() => expect(a.stopFollowup).toHaveBeenCalledWith('f1')); expect(a.followups).toHaveBeenCalledTimes(2);
  });
  it('a stopped follow-up offers no actions; a read-only encounter offers none and no planning form', async () => {
    const { unmount } = view(api({ followups: vi.fn().mockResolvedValue([fu({ active: false })]) })); await screen.findByText(/stopped/);
    expect(screen.queryByRole('button', { name: 'Schedule reminder' })).not.toBeInTheDocument(); unmount();
    view(api(), false); await screen.findByText(/Antenatal visit/);
    expect(screen.queryByRole('button', { name: 'Schedule reminder' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Plan follow-up' })).not.toBeInTheDocument();
  });
  it('a load failure is shown in words', async () => {
    view(api({ followups: vi.fn().mockRejectedValue(new ApiError(503, 'Follow-up planning is not set up.')) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up');
  });
});
