import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AiOpinionView } from '../lib/types';
import { AiOpinion } from './AiOpinion';

const o = (over: Partial<AiOpinionView> = {}): AiOpinionView => ({ tier: 2, reason: 'A young child who will not drink should be seen soon.', provider: 'claude', model: 'm', machineGenerated: true, rulesTier: 4, relation: 'raised', ...over });

describe('Triage engine output', () => {
  it('shows the reason under the heading Triage engine output, and says it is machine output that can only raise', () => {
    render(<AiOpinion opinion={o()} />);
    expect(screen.getByRole('heading', { name: 'Triage engine output' })).toBeInTheDocument();
    expect(screen.getByText('A young child who will not drink should be seen soon.')).toBeInTheDocument(); expect(screen.getByText(/more urgency than the basic checks/)).toBeInTheDocument();
    expect(screen.getByText(/not reviewed/)).toBeInTheDocument(); expect(screen.getByText(/never lower it/)).toBeInTheDocument();
  });
  it('never names an AI, a model or a provider', () => {
    const { container } = render(<AiOpinion opinion={o()} />);
    expect(container.textContent).not.toMatch(/\bAI\b|model|claude|gemini|opinion/i);
  });
  it('when a lower priority was suggested, it says the higher result was kept', () => { render(<AiOpinion opinion={o({ tier: 4, rulesTier: 2, relation: 'lower' })} />); expect(screen.getByText(/higher result was kept/)).toBeInTheDocument(); });
  it('when it agrees, it adds nothing beyond the reason', () => {
    render(<AiOpinion opinion={o({ tier: 2, rulesTier: 2, relation: 'agrees' })} />);
    expect(screen.queryByText(/more urgency|higher result/)).not.toBeInTheDocument();
  });
});
