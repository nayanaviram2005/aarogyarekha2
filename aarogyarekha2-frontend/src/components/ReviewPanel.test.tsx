import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, ReviewRecord } from '../lib/types';
import { ReviewPanel } from './ReviewPanel';

const api = (review: Api['review'] = vi.fn().mockResolvedValue({ reviewId: 'r' })) => ({ review }) as unknown as Api;
const base = { encounterId: 'e1', assessmentId: 'a1', rulesUrgency: 'orange' as const, effectiveUrgency: 'orange' as const, ruleFloor: true, current: null, reviewerName: 'Nurse Rao', canReview: true, onDone: () => {} };

describe('who sees the controls', () => {
  it('a person who cannot review sees no buttons, only an explanation', () => {
    render(<ReviewPanel {...base} api={api()} canReview={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/nurse, doctor or medical officer reviews and signs off/i)).toBeInTheDocument();
  });
});

describe('confirming the priority', () => {
  it('asks for a second step naming the reviewer, then records an approval of exactly the assessment on screen', async () => {
    const review = vi.fn().mockResolvedValue({ reviewId: 'r' }); const onDone = vi.fn();
    render(<ReviewPanel {...base} api={api(review)} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm priority' }));
    expect(review).not.toHaveBeenCalled();                                         // one click is not enough
    expect(screen.getByText(/Nurse Rao/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign off' }));
    expect(review).toHaveBeenCalledWith('e1', { action: 'approve', assessmentId: 'a1' });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
  it('cancel records nothing', async () => {
    const review = vi.fn();
    render(<ReviewPanel {...base} api={api(review)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm priority' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(review).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm priority' })).toBeInTheDocument();
  });
  it('once signed off, the confirm button is gone and the reviewer is named', () => {
    const current = { id: 'x', action: 'approve', reviewer_name: 'Dr Mehta', created_at: '2026-10-06T10:00:00Z' } as ReviewRecord;
    render(<ReviewPanel {...base} api={api()} current={current} />);
    expect(screen.queryByRole('button', { name: 'Confirm priority' })).not.toBeInTheDocument();
    expect(screen.getByText('Dr Mehta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change priority' })).toBeInTheDocument();
  });
  it('is disabled when the encounter can no longer be reviewed', () => {
    render(<ReviewPanel {...base} api={api()} disabled />);
    expect(screen.getByRole('button', { name: 'Confirm priority' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change priority' })).toBeDisabled();
  });
});

describe('changing the priority', () => {
  async function open() { await userEvent.click(screen.getByRole('button', { name: 'Change priority' })); }
  const fill = async (to: string, code = 'clinical_judgement', text = 'Looks worse than the numbers show') => {
    await userEvent.selectOptions(screen.getByLabelText('New priority'), to);
    await userEvent.selectOptions(screen.getByLabelText('Reason'), code);
    await userEvent.type(screen.getByLabelText('Explain the change'), text);
  };

  it('never offers the priority that is already in force', async () => {
    render(<ReviewPanel {...base} api={api()} />);
    await open();
    const options = [...screen.getByLabelText('New priority').querySelectorAll('option')].map(o => o.textContent);
    expect(options).toContain('Immediate'); expect(options).toContain('Routine');
    expect(options).not.toContain('Very urgent');
  });
  it('needs a priority, a reason and at least 10 characters before it can be submitted', async () => {
    render(<ReviewPanel {...base} api={api()} />);
    await open();
    const submit = screen.getAllByRole('button', { name: 'Change priority' }).find(b => b.getAttribute('type') === 'submit')!;
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('New priority'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'clinical_judgement');
    await userEvent.type(screen.getByLabelText('Explain the change'), 'too short');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Explain the change'), ' now long enough');
    expect(submit).toBeEnabled();
  });
  it('raising the priority sends the override with the reason code, without a downgrade confirmation', async () => {
    const review = vi.fn().mockResolvedValue({ reviewId: 'r' });
    render(<ReviewPanel {...base} api={api(review)} />);
    await open(); await fill('1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Change priority' }).find(b => b.getAttribute('type') === 'submit')!);
    expect(review).toHaveBeenCalledWith('e1', { action: 'override', assessmentId: 'a1', toUrgency: 'red', reasonCode: 'clinical_judgement', reason: 'Looks worse than the numbers show', confirmDowngrade: undefined });
  });
  it('lowering below the rules shows a warning that names the danger-sign rule and blocks submit until confirmed', async () => {
    const review = vi.fn().mockResolvedValue({ reviewId: 'r' });
    render(<ReviewPanel {...base} api={api(review)} />);
    await open(); await fill('4', 'data_entry_error', 'The reading was taken wrongly');
    expect(screen.getByText(/Lower than the rules set \(Very urgent\)/)).toBeInTheDocument();
    expect(screen.getByText(/danger-sign rule set this priority/i)).toBeInTheDocument();
    const submit = screen.getAllByRole('button', { name: 'Change priority' }).find(b => b.getAttribute('type') === 'submit')!;
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(review).toHaveBeenCalledWith('e1', expect.objectContaining({ toUrgency: 'green', reasonCode: 'data_entry_error', confirmDowngrade: true }));
  });
  it('changing the chosen priority clears an earlier confirmation', async () => {
    render(<ReviewPanel {...base} api={api()} />);
    await open(); await fill('4');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.selectOptions(screen.getByLabelText('New priority'), '3');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('a score-based priority gets the warning without the danger-sign sentence', async () => {
    render(<ReviewPanel {...base} ruleFloor={false} api={api()} />);
    await open(); await fill('4');
    expect(screen.getByText(/Lower than the rules set/)).toBeInTheDocument();
    expect(screen.queryByText(/danger-sign rule set this priority/i)).not.toBeInTheDocument();
  });
  it('a change relative to a reviewer-lowered case still compares against what the RULES said', async () => {
    render(<ReviewPanel {...base} effectiveUrgency="green" api={api()} />);   // already lowered to routine
    await open();
    await userEvent.selectOptions(screen.getByLabelText('New priority'), '3');   // yellow is still lower than orange
    expect(screen.getByText(/Lower than the rules set/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('New priority'), '2');   // equal to the rules: no warning
    expect(screen.queryByText(/Lower than the rules set/)).not.toBeInTheDocument();
  });
});

describe('failures', () => {
  it('a stale assessment explains itself and offers to reload', async () => {
    const onDone = vi.fn();
    const review = vi.fn().mockRejectedValue(new ApiError(409, 'The assessment changed while you were reviewing. Open the latest assessment and review that one.'));
    render(<ReviewPanel {...base} api={api(review)} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm priority' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign off' }));
    expect(await screen.findByText('This assessment has changed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the latest assessment' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it('any other refusal is shown in plain words and nothing is reported as recorded', async () => {
    const onDone = vi.fn();
    const review = vi.fn().mockRejectedValue(new ApiError(403, 'Only a nurse, doctor or medical officer at this facility can review a triage assessment.'));
    render(<ReviewPanel {...base} api={api(review)} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm priority' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only a nurse, doctor or medical officer/);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('the text message after sign-off', () => {
  const signOff = async (sms: unknown, extra = {}) => {
    render(<ReviewPanel {...base} patientId="p1" {...extra} api={api(vi.fn().mockResolvedValue({ reviewId: 'r', sms }))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm priority' })); await userEvent.click(screen.getByRole('button', { name: 'Sign off' }));
  };
  it('says the patient was told, and in which language', async () => {
    await signOff({ status: 'sent', reason: null, language: 'hi' });
    expect(await screen.findByText(/told their queue status in Hindi/)).toBeInTheDocument();
  });
  it('says plainly when nothing was sent and why, and offers consent only for a missing one', async () => {
    await signOff({ status: 'skipped', reason: 'no_consent', language: 'en' });
    expect(await screen.findByText(/has not agreed to text messages/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ask for text-message consent' }));
    expect(screen.getByText(/reply STOP at any time/)).toBeInTheDocument();
  });
  it('shows nothing for a repeat, and nothing when the server sends no sms field', async () => {
    await signOff({ status: 'skipped', reason: 'duplicate', language: 'en' }); await waitFor(() => expect(screen.queryByText(/No text message/)).toBeNull());
  });
});
