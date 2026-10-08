import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, DoneEntry, EncounterSummary, QueueEntry } from '../lib/types';
import { DoneToday, QueueCounts } from './QueueFlow';
import { VisitPanel } from './VisitPanel';

const summary = (o: { status?: string; queue?: string | null } = {}): EncounterSummary => ({
  encounter: { id: 'e1', patient_id: 'p', facility_id: 'f', status: o.status ?? 'submitted', scenario: 'opd_queue', language: 'en', chief_complaint_original: null, chief_complaint_translated: null, submitted_at: null, closed_at: null, created_at: '', updated_at: '' },
  patient: {} as never, symptoms: [], vitals: [], triageContext: {}, assessment: null, followUps: [], consentActive: true, reviews: [],
  queue: o.queue === null ? null : { urgency_code: 'orange', status: o.queue ?? 'waiting', entered_at: '2026-10-08T05:00:00Z' },
}) as unknown as EncounterSummary;
const api = (o: Record<string, unknown> = {}) => ({ callIn: vi.fn().mockResolvedValue({}), completeVisit: vi.fn().mockResolvedValue({}), ...o }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const panel = (a: Api, s: EncounterSummary, p: { canReview?: boolean; reviewed?: boolean } = {}) => render(<VisitPanel api={a} summary={s} canReview={p.canReview ?? true} reviewedCurrent={p.reviewed ?? true} onChanged={async () => {}} />);

describe('VisitPanel', () => {
  it('a waiting patient can be called in, and then the queue is refreshed', async () => {
    const a = api(); const onChanged = vi.fn(); render(<VisitPanel api={a} summary={summary()} canReview reviewedCurrent={false} onChanged={onChanged} />);
    expect(screen.getByText('Waiting')).toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: 'Call in patient' }));
    await waitFor(() => expect(a.callIn).toHaveBeenCalledWith('e1')); await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it('a patient in review is completed with the chosen outcome', async () => {
    const a = api(); panel(a, summary({ queue: 'in_review', status: 'in_review' }));
    expect(screen.getByText('In review')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Complete visit' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('How did the visit end?'), 'sent_home'); await userEvent.click(screen.getByRole('button', { name: 'Complete visit' }));
    await waitFor(() => expect(a.completeVisit).toHaveBeenCalledWith('e1', 'sent_home'));
  });
  it('treated or sent home is blocked until the priority is reviewed, with the reason in words; did not wait is not', async () => {
    const a = api(); panel(a, summary({ queue: 'in_review', status: 'in_review' }), { reviewed: false });
    await userEvent.selectOptions(screen.getByLabelText('How did the visit end?'), 'treated_here');
    expect(screen.getByRole('status')).toHaveTextContent('Review and sign off the priority first'); expect(screen.getByRole('button', { name: 'Complete visit' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('How did the visit end?'), 'did_not_wait'); expect(screen.getByRole('button', { name: 'Complete visit' })).toBeEnabled();
  });
  it('someone who cannot review is told so, and can still record that the patient did not wait', async () => {
    panel(api(), summary({ queue: 'in_review', status: 'in_review' }), { canReview: false });
    await userEvent.selectOptions(screen.getByLabelText('How did the visit end?'), 'sent_home'); expect(screen.getByRole('status')).toHaveTextContent('Only a nurse or doctor');
    await userEvent.selectOptions(screen.getByLabelText('How did the visit end?'), 'did_not_wait'); expect(screen.getByRole('button', { name: 'Complete visit' })).toBeEnabled();
  });
  it('shows the server\'s plain refusal', async () => {
    const a = api({ callIn: vi.fn().mockRejectedValue(new ApiError(409, 'This patient is already in review by someone else.')) }); panel(a, summary());
    await userEvent.click(screen.getByRole('button', { name: 'Call in patient' })); expect(await screen.findByText('This patient is already in review by someone else.')).toBeInTheDocument();
  });
  it('a completed or referred patient has left the queue and offers no actions; an unassessed one shows nothing', () => {
    const { unmount } = panel(api(), summary({ status: 'closed' })); expect(screen.getByText('Visit completed')).toBeInTheDocument(); expect(screen.queryByRole('button')).toBeNull(); unmount();
    const r = panel(api(), summary({ status: 'referred' })); expect(screen.getByText('Referred')).toBeInTheDocument(); r.unmount();
    const u = panel(api(), summary({ queue: null })); expect(u.container).toBeEmptyDOMElement();
  });
});

const entry = (o: Partial<QueueEntry>): QueueEntry => ({ encounterId: 'e' + Math.random(), assessed: true, tier: 2, queueStatus: 'waiting', ...o }) as QueueEntry;
describe('QueueCounts', () => {
  it('counts who waits at each priority, who is in review, and not assessed', () => {
    render(<QueueCounts entries={[entry({ tier: 1 }), entry({ tier: 2 }), entry({ tier: 2 }), entry({ tier: null, assessed: false }), entry({ queueStatus: 'in_review' })]} doneCount={7} showingDone={false} onShowDone={() => {}} />);
    expect(screen.getByText(/4 waiting/)).toBeInTheDocument(); expect(screen.getByText(/1 immediate, 2 very urgent/)).toBeInTheDocument(); expect(screen.getByText(/1 not assessed/)).toBeInTheDocument();
    expect(screen.getByText(/1 in review/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Done today (7)' })).toBeInTheDocument();
  });
  it('the done button toggles and says how to get back', async () => {
    const f = vi.fn(); const { rerender } = render(<QueueCounts entries={[]} doneCount={null} showingDone={false} onShowDone={f} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done today' })); expect(f).toHaveBeenCalled();
    rerender(<QueueCounts entries={[]} doneCount={null} showingDone onShowDone={f} />); expect(screen.getByRole('button', { name: 'Back to the queue' })).toHaveAttribute('aria-pressed', 'true');
  });
});

const done = (o: Partial<DoneEntry> = {}): DoneEntry => ({ encounterId: 'd1', facilityId: 'f', patientRef: 'AR-0001', patientName: 'Asha Rao', sex: 'female', urgencyCode: 'orange', outcome: 'treated_here', finishedAt: '2026-10-08T05:00:00Z', by: 'Nurse Das', waitedMinutes: 25, ...o });
describe('DoneToday', () => {
  it('lists who was finished, with the outcome, who did it and how long they waited', async () => {
    const onLoaded = vi.fn(); render(<DoneToday api={{ queueDone: vi.fn().mockResolvedValue([done(), done({ encounterId: 'd2', patientName: null, patientRef: 'AR-0002', outcome: 'referred', by: null, waitedMinutes: null })]) } as unknown as Api} onLoaded={onLoaded} />);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument(); expect(screen.getByText('Treated here')).toBeInTheDocument(); expect(screen.getByText('Referred')).toBeInTheDocument(); expect(screen.getByText(/By Nurse Das · waited 25 min/)).toBeInTheDocument(); expect(onLoaded).toHaveBeenCalledWith(2);
  });
  it('says plainly when there is nobody, and shows a load error', async () => {
    const { unmount } = render(<DoneToday api={{ queueDone: vi.fn().mockResolvedValue([]) } as unknown as Api} />); expect(await screen.findByText(/No one has been completed/)).toBeInTheDocument(); unmount();
    render(<DoneToday api={{ queueDone: vi.fn().mockRejectedValue(new ApiError(503, 'Visit flow is not set up. It needs migration 0018.')) } as unknown as Api} />); expect(await screen.findByRole('alert')).toHaveTextContent('migration 0018');
  });
});
