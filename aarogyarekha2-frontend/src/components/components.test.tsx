import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpControl } from './FollowUpControl';
import { draftReady, submitDrafts, type Draft } from '../lib/answerDrafts';
import { UrgencyPlate } from './Plate';
import { Provenance } from './Provenance';
import type { Api } from '../lib/types';

const fakeApi = (over: Partial<Api> = {}): Api => ({
  saveInputs: vi.fn().mockResolvedValue({ ok: true }), addVital: vi.fn().mockResolvedValue({ id: 'v' }), ...over,
} as unknown as Api);

describe('UrgencyPlate', () => {
  it('names the tier in words and exposes it to screen readers', () => {
    render(<UrgencyPlate tier={1} />);
    expect(screen.getByRole('img', { name: 'Urgency: Immediate, tier 1' })).toBeInTheDocument();
    expect(screen.getByText('Immediate')).toBeInTheDocument();
  });
  it('uses a different SHAPE for every tier, so urgency never depends on colour alone', () => {
    const shapes = [1, 2, 3, 4].map(t => { const { container, unmount } = render(<UrgencyPlate tier={t} />); const s = container.querySelector('svg')!.innerHTML; unmount(); return s; });
    expect(new Set(shapes).size).toBe(4);
  });
  it('shows a dashed "not assessed" plate when there is no assessment, or the tier is not 1 to 4', () => {
    const { rerender } = render(<UrgencyPlate tier={null} assessed={false} />);
    expect(screen.getByRole('img', { name: 'Urgency: not assessed yet' })).toBeInTheDocument();
    rerender(<UrgencyPlate tier={9} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
  });
});

describe('Provenance', () => {
  it('says "Draft, not reviewed" until someone has signed it', () => {
    render(<Provenance label="Triage assessment">content</Provenance>);
    expect(screen.getByText('Draft, not reviewed')).toBeInTheDocument();
    expect(screen.getByLabelText('Triage assessment')).toHaveClass('prov--draft');
  });
  it('names the reviewer once signed', () => {
    render(<Provenance reviewedBy="Dr A. Rao" reviewedAt="06 Oct, 14:02" label="x">content</Provenance>);
    expect(screen.getByText(/Reviewed by Dr A. Rao, 06 Oct, 14:02/)).toBeInTheDocument();
    expect(screen.getByLabelText('x')).toHaveClass('prov--reviewed');
    expect(screen.queryByText('Draft, not reviewed')).not.toBeInTheDocument();
  });
});

describe('FollowUpControl', () => {
  // A small stand-in for the page: it keeps the chosen answers, as the page does, and never saves anything.
  function Harness({ fieldCode, question = 'q', ...rest }: { fieldCode: string; question?: string; potentialTier?: 1 | 2 | 3 | 4 | null; disabled?: boolean; checks?: string | null; initial?: Draft; spy?: (d: Draft | null) => void }) {
    const [d, setD] = useState<Draft | undefined>(rest.initial);
    return <ul><FollowUpControl fieldCode={fieldCode} question={question} rank={1} potentialTier={rest.potentialTier ?? null} disabled={rest.disabled} checks={rest.checks} draft={d} onDraft={x => { rest.spy?.(x); setD(x ?? undefined); }} /></ul>;
  }

  it('choosing Yes or No marks that button (it stays highlighted), and choosing it again takes it back', async () => {
    const spy = vi.fn(); render(<Harness fieldCode="sign.central_cyanosis" question="Are the lips blue?" spy={spy} />);
    const yes = screen.getByRole('button', { name: 'Yes' }), no = screen.getByRole('button', { name: 'No' });
    expect(yes).toHaveAttribute('aria-pressed', 'false'); expect(no).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(no); expect(no).toHaveAttribute('aria-pressed', 'true'); expect(yes).toHaveAttribute('aria-pressed', 'false'); expect(spy).toHaveBeenLastCalledWith({ kind: 'bool', value: false });
    await userEvent.click(yes); expect(yes).toHaveAttribute('aria-pressed', 'true'); expect(no).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(yes); expect(yes).toHaveAttribute('aria-pressed', 'false'); expect(spy).toHaveBeenLastCalledWith(null);
  });
  it('Yes and No are marked for styling: green with a tick, red with a cross', () => {
    render(<Harness fieldCode="sign.shock_signs" />);
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('data-answer', 'yes'); expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('data-answer', 'no');
  });
  it('the oxygen and pregnancy questions work the same way', async () => {
    const { unmount } = render(<Harness fieldCode="vital.oxygen" question="On oxygen?" />);
    await userEvent.click(screen.getByRole('button', { name: 'Yes' })); expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true'); unmount();
    render(<Harness fieldCode="context.pregnancy_status" question="Pregnant?" />);
    await userEvent.click(screen.getByRole('button', { name: 'No' })); expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('a measurement is typed in place: no Save button, and the draft carries the typed text', async () => {
    const spy = vi.fn(); render(<Harness fieldCode="vital.spo2_pct" question="Record SpO2" spy={spy} />);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/SpO2/), '94'); expect(spy).toHaveBeenLastCalledWith({ kind: 'nums', value: { spo2_pct: '94' } });
    await userEvent.clear(screen.getByLabelText(/SpO2/)); expect(spy).toHaveBeenLastCalledWith(null);
  });
  it('text that is not a number is marked invalid', async () => {
    render(<Harness fieldCode="vital.spo2_pct" question="Record SpO2" />); await userEvent.type(screen.getByLabelText(/SpO2/), 'abc');
    expect(screen.getByLabelText(/SpO2/)).toHaveAttribute('aria-invalid', 'true');
  });
  it('blood pressure has two boxes and keeps both in one draft', async () => {
    const spy = vi.fn(); render(<Harness fieldCode="vital.bp_pregnancy" question="Record BP" spy={spy} />);
    await userEvent.type(screen.getByLabelText(/Systolic/), '150'); await userEvent.type(screen.getByLabelText(/Diastolic/), '95');
    expect(spy).toHaveBeenLastCalledWith({ kind: 'nums', value: { bp_systolic_mmhg: '150', bp_diastolic_mmhg: '95' } });
  });
  it('the alertness question is a list, and choosing one is a draft', async () => {
    const spy = vi.fn(); render(<Harness fieldCode="vital.consciousness" question="How responsive?" spy={spy} />);
    await userEvent.selectOptions(screen.getByLabelText('How responsive?'), 'voice'); expect(spy).toHaveBeenLastCalledWith({ kind: 'level', value: 'voice' });
  });
  it('says how far the answer could move the priority, in words, and shows what a reworded question checks', () => {
    render(<Harness fieldCode="sign.shock_signs" question="Do the hands feel cold?" potentialTier={2} checks="Signs of shock" />);
    expect(screen.getByText('Could change the priority to very urgent.')).toBeInTheDocument(); expect(screen.getByText('Checks: Signs of shock')).toBeInTheDocument();
  });
  it('age is not editable here: it explains where to change it and offers no input', () => {
    render(<Harness fieldCode="context.age" question="What is the age?" />);
    expect(screen.getByText(/taken from the patient record/i)).toBeInTheDocument(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('controls are disabled when the encounter can no longer be edited', () => {
    render(<Harness fieldCode="sign.shock_signs" disabled />);
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
  });
});

describe('submitting the chosen answers together', () => {
  const api = () => ({ saveInputs: vi.fn().mockResolvedValue({}), addVital: vi.fn().mockResolvedValue({ id: 'v' }) }) as unknown as Api & { saveInputs: ReturnType<typeof vi.fn>; addVital: ReturnType<typeof vi.fn> };
  const d = (value: boolean): Draft => ({ kind: 'bool', value });
  it('one call for all the yes/no and level answers, then each measurement', async () => {
    const a = api();
    const n = await submitDrafts(a, 'e1', { 'sign.shock_signs': d(false), 'sign.central_cyanosis': d(true), 'vital.oxygen': d(false), 'context.pregnancy_status': d(true), 'vital.consciousness': { kind: 'level', value: 'alert' },
      'vital.bp_pregnancy': { kind: 'nums', value: { bp_systolic_mmhg: '150', bp_diastolic_mmhg: '95' } }, 'vital.spo2_pct': { kind: 'nums', value: { spo2_pct: '94' } } });
    expect(n).toBe(7); expect(a.saveInputs).toHaveBeenCalledTimes(1);
    expect(a.saveInputs).toHaveBeenCalledWith('e1', { signs: { shock_signs: false, central_cyanosis: true }, onSupplementalOxygen: false, pregnant: true, consciousness: 'alert' });
    expect(a.addVital.mock.calls.map(c => c[1])).toEqual([{ kind: 'bp_systolic_mmhg', value: 150 }, { kind: 'bp_diastolic_mmhg', value: 95 }, { kind: 'spo2_pct', value: 94 }]);
  });
  it('an incomplete blood pressure or a non-number is left out, and nothing at all means no calls', async () => {
    const a = api();
    expect(await submitDrafts(a, 'e1', { 'vital.bp_pregnancy': { kind: 'nums', value: { bp_systolic_mmhg: '150' } }, 'vital.spo2_pct': { kind: 'nums', value: { spo2_pct: 'abc' } } })).toBe(0);
    expect(a.saveInputs).not.toHaveBeenCalled(); expect(a.addVital).not.toHaveBeenCalled();
  });
  it('only measurements: no input call; only inputs: no vital call', async () => {
    const a = api(); await submitDrafts(a, 'e1', { 'vital.spo2_pct': { kind: 'nums', value: { spo2_pct: '94' } } }); expect(a.saveInputs).not.toHaveBeenCalled(); expect(a.addVital).toHaveBeenCalledTimes(1);
    const b = api(); await submitDrafts(b, 'e1', { 'sign.shock_signs': d(true) }); expect(b.addVital).not.toHaveBeenCalled(); expect(b.saveInputs).toHaveBeenCalledTimes(1);
  });
  it('a failure is thrown so the page can show the server\'s message, and later steps do not run', async () => {
    const a = api(); a.saveInputs.mockRejectedValue(new Error('You are not allowed to do this at this facility.'));
    await expect(submitDrafts(a, 'e1', { 'sign.shock_signs': d(true), 'vital.spo2_pct': { kind: 'nums', value: { spo2_pct: '94' } } })).rejects.toThrow('not allowed'); expect(a.addVital).not.toHaveBeenCalled();
  });
  it('draftReady needs every number of a measurement', () => {
    expect(draftReady('vital.bp_pregnancy', { kind: 'nums', value: { bp_systolic_mmhg: '150', bp_diastolic_mmhg: '' } })).toBe(false);
    expect(draftReady('vital.bp_pregnancy', { kind: 'nums', value: { bp_systolic_mmhg: '150', bp_diastolic_mmhg: '95' } })).toBe(true); expect(draftReady('sign.x', undefined)).toBe(false);
  });
});
