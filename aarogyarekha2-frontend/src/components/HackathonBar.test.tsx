import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HACKATHON_MESSAGE, RULES_CLINICALLY_VALIDATED, SHOW_HACKATHON_BAR } from '../config';
import { HackathonBar } from './HackathonBar';

describe('hackathon bar', () => {
  it('is on, and the rules are recorded as NOT clinically validated, until someone changes that on purpose', () => {
    expect(SHOW_HACKATHON_BAR).toBe(true);
    expect(RULES_CLINICALLY_VALIDATED).toBe(false);
  });
  it('says what a visitor must know: hackathon, synthetic data, rules not validated, not for real patients, non-diagnostic', () => {
    for (const phrase of ['HACKATHON PROTOTYPE', 'Synthetic data only', 'NOT been clinically validated', 'Not for use with real patients', 'Does not diagnose or advise treatment'])
      expect(HACKATHON_MESSAGE).toContain(phrase);
  });
  it('is announced once to screen readers: the repeated sliding copy is hidden from them', () => {
    const { container } = render(<HackathonBar />);
    expect(screen.getByRole('note', { name: 'Prototype notice' })).toBeInTheDocument();
    const copies = container.querySelectorAll('.hbar__text');
    expect(copies).toHaveLength(2);
    expect(copies[0]).not.toHaveAttribute('aria-hidden');
    expect(copies[1]).toHaveAttribute('aria-hidden', 'true');
  });
  it('can be paused and resumed, because moving text must be stoppable', async () => {
    const { container } = render(<HackathonBar />);
    const bar = container.querySelector('.hbar')!;
    expect(bar).toHaveAttribute('data-paused', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(bar).toHaveAttribute('data-paused', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(bar).toHaveAttribute('data-paused', 'false');
  });
});
