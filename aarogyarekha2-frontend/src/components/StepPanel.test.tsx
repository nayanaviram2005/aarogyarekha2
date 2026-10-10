import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { journey, type JourneyInput } from '../lib/journey';
import { StepPanel } from './StepPanel';

const input = (o: Partial<JourneyInput> = {}): JourneyInput => ({ consent: true, status: 'submitted', hasAssessment: false, recorded: true, openQuestions: 0, signedOff: false, queueStatus: 'waiting', canReview: true, ...o });
const show = (i: JourneyInput, extra: { selected?: 'checkin' | 'questions'; reassessHint?: boolean } = {}) => {
  const onAssess = vi.fn();
  render(<MemoryRouter><StepPanel j={journey(i)} selected={extra.selected ?? 'checkin'} onSelect={() => {}} assessing={false} editable onAssess={onAssess} hasAssessment={i.hasAssessment} reassessHint={extra.reassessHint}><p>body</p></StepPanel></MemoryRouter>);
  return onAssess;
};

describe('the one place to assess', () => {
  it('before the first assessment there is exactly one Assess now, with the not-assessed status beside it', async () => {
    const onAssess = show(input());
    expect(screen.getAllByRole('button', { name: /Assess/ })).toHaveLength(1);
    expect(screen.getByText(/Not assessed yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assess now' }));
    expect(onAssess).toHaveBeenCalledTimes(1);
  });

  it('after an assessment, check-in offers a single Assess again', async () => {
    const onAssess = show(input({ hasAssessment: true, openQuestions: 2 }));
    expect(screen.queryByRole('button', { name: 'Assess now' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Assess again' }));
    expect(onAssess).toHaveBeenCalledTimes(1);
  });

  it('says answers are saved when the priority is out of date', () => {
    show(input({ hasAssessment: true, openQuestions: 2 }), { reassessHint: true });
    expect(screen.getByText(/Answers saved/)).toBeInTheDocument();
  });

  it('does not offer to assess again on other steps', () => {
    show(input({ hasAssessment: true, openQuestions: 2 }), { selected: 'questions' });
    expect(screen.queryByRole('button', { name: /Assess/ })).not.toBeInTheDocument();
  });
});
