import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { journey, type JourneyInput, type StepKey } from '../lib/journey';
import { JourneyBar } from './JourneyBar';
import { StepPanel } from './StepPanel';

const base: JourneyInput = { consent: true, status: 'submitted', hasAssessment: true, recorded: true, openQuestions: 0, signedOff: false, queueStatus: 'waiting', canReview: true };
const j = (o: Partial<JourneyInput> = {}) => journey({ ...base, ...o });

describe('JourneyBar: steps you can click', () => {
  it('has four steps, no priority step, and every one is a button', () => {
    render(<JourneyBar j={j()} selected="signoff" onSelect={() => {}} />);
    expect(screen.getAllByRole('button').map(b => b.textContent?.replace(/[✓\d]/g, '').trim())).toEqual([expect.stringContaining('Check-in'), expect.stringContaining('Questions'), expect.stringContaining('Sign-off'), expect.stringContaining('Visit')]);
    expect(screen.queryByText('Priority')).toBeNull();
  });
  it('clicking a step, even a finished one, selects it so it can be changed', async () => {
    const onSelect = vi.fn(); render(<JourneyBar j={j()} selected="signoff" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Check-in/ })); expect(onSelect).toHaveBeenLastCalledWith<[StepKey]>('checkin');
    await userEvent.click(screen.getByRole('button', { name: /Questions/ })); expect(onSelect).toHaveBeenLastCalledWith<[StepKey]>('questions');
    await userEvent.click(screen.getByRole('button', { name: /Visit/ })); expect(onSelect).toHaveBeenLastCalledWith<[StepKey]>('visit');
  });
  it('the step on screen is marked current, and the recommended step carries "Next"', () => {
    render(<JourneyBar j={j()} selected="checkin" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: /Check-in/ })).toHaveAttribute('aria-current', 'step'); expect(screen.getByRole('button', { name: /Sign-off/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Next').closest('button')).toHaveTextContent('Sign-off');
  });
  it('a finished patient has every step done and no "Next"', () => {
    render(<JourneyBar j={j({ status: 'closed', signedOff: true })} selected="visit" onSelect={() => {}} />); expect(screen.queryByText('Next')).toBeNull();
  });
});

const panel = (jr: ReturnType<typeof j>, selected: StepKey, onSelect = vi.fn(), onAssess = vi.fn()) =>
  render(<MemoryRouter><StepPanel j={jr} selected={selected} onSelect={onSelect} assessing={false} editable onAssess={onAssess}><p>CONTENT</p></StepPanel></MemoryRouter>);

describe('StepPanel: the selected step in one place', () => {
  it('on the recommended step it says what to do now, and the step content sits right under it (one section)', () => {
    const { container } = panel(j(), 'signoff');
    expect(screen.getByText('Next step · nurse or doctor')).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Review and sign off the priority' })).toBeInTheDocument(); expect(screen.getByText('CONTENT')).toBeInTheDocument();
    expect(container.querySelectorAll('section')).toHaveLength(1);
  });
  it('on another step it names that step, says whether it is done, and links to the next step', async () => {
    const onSelect = vi.fn(); panel(j(), 'checkin', onSelect);
    expect(screen.getByText('Check-in · done')).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Check-in: what was recorded' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review and sign off the priority' })); expect(onSelect).toHaveBeenCalledWith('signoff');
  });
  it('when nothing is assessed yet the recommended step has the Assess button', async () => {
    const onAssess = vi.fn(); panel(j({ hasAssessment: false }), 'checkin', vi.fn(), onAssess);
    await userEvent.click(screen.getByRole('button', { name: 'Assess now' })); expect(onAssess).toHaveBeenCalled();
  });
  it('a health worker is told to wait for a nurse or doctor and gets no sign-off prompt', () => {
    panel(j({ canReview: false }), 'signoff'); expect(screen.getByRole('heading', { name: /Waiting for a nurse or doctor/ })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /sign off/i })).toBeNull();
  });
  it('a finished patient shows New patient and Back to the queue', () => {
    panel(j({ status: 'referred', signedOff: true }), 'visit'); expect(screen.getByText('Finished')).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'New patient' })).toHaveAttribute('href', '/intake'); expect(screen.getByRole('link', { name: 'Back to the queue' })).toHaveAttribute('href', '/');
  });
});
