import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import type { DecisionLogEntry } from '../lib/types';
import { DecisionTable } from './DecisionTable';

const rs = { name: 'aarogyarekha-layered', version: '0.1.2', status: 'approved' };
const log: DecisionLogEntry[] = [
  { layer: 'floor', ruleId: 'ETAT-E2', tier: 1, detail: 'Severe breathing difficulty', source: 'WHO ETAT emergency signs', why: 'Marked Yes for: "Is the patient struggling severely to breathe?"' },
  { layer: 'external', ruleId: 'EXT-ai_second_opinion', tier: 2, detail: 'Extended check of the case details', source: 'Triage engine extended check', why: 'The extended check read the case and suggested this level.' },
  { layer: 'default', ruleId: 'DEFAULT', tier: 4, detail: 'No urgency signal found' },
];

describe('DecisionTable', () => {
  it('shows each rule with an info button that explains it and how it relates to this patient', async () => {
    render(<DecisionTable log={log} ruleSet={rs} />);
    await userEvent.click(screen.getByRole('button', { name: 'About rule ETAT-E2' }));
    expect(screen.getByText('WHO ETAT emergency signs')).toBeInTheDocument();
    expect(screen.getByText(/Marked Yes for: "Is the patient struggling severely to breathe\?"/)).toBeInTheDocument();
    expect(screen.getByText(/A danger sign\. When it is answered Yes/)).toBeInTheDocument();
  });

  it('shows one explanation at a time and closes it again', async () => {
    render(<DecisionTable log={log} ruleSet={rs} />);
    const first = screen.getByRole('button', { name: 'About rule ETAT-E2' });
    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'About rule DEFAULT' }));
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Marked Yes for/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'About rule DEFAULT' }));
    expect(screen.queryByText(/None of the checks/)).not.toBeInTheDocument();
  });

  it('presents the extended check as the triage engine, never as an AI', async () => {
    const { container } = render(<DecisionTable log={log} ruleSet={rs} />);
    expect(screen.getByRole('button', { name: 'About rule Triage engine' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'About rule Triage engine' }));
    expect(container.textContent).not.toMatch(/ai_second_opinion|\bAI\b|opinion/i);
  });

  it('says so, and how to get the detail, for an assessment saved before the details were recorded', async () => {
    render(<DecisionTable log={log} ruleSet={rs} />);
    await userEvent.click(screen.getByRole('button', { name: 'About rule DEFAULT' }));
    expect(screen.getByText(/Not recorded for this earlier assessment/)).toBeInTheDocument();
  });

  it('has no accessibility violations, open or closed', async () => {
    const { container } = render(<DecisionTable log={log} ruleSet={rs} />);
    const opts = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
    expect((await axe.run(container, opts)).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'About rule ETAT-E2' }));
    expect((await axe.run(container, opts)).violations).toEqual([]);
  });
});
