import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AiOpinionView } from '../lib/types';
import { AiOpinion } from './AiOpinion';

const o = (over: Partial<AiOpinionView> = {}): AiOpinionView => ({ tier: 2, reason: 'A young child who will not drink should be seen soon.', provider: 'claude', model: 'm', machineGenerated: true, rulesTier: 4, relation: 'raised', ...over });

describe('AiOpinion', () => {
  it('shows both tiers, the reason, and says it is machine output that can only raise', () => {
    render(<AiOpinion opinion={o()} />);
    expect(screen.getByText('A young child who will not drink should be seen soon.')).toBeInTheDocument(); expect(screen.getByText(/saw more urgency than the rules/)).toBeInTheDocument();
    expect(screen.getByText(/Not reviewed/)).toBeInTheDocument(); expect(screen.getByText(/never lower it/)).toBeInTheDocument();
  });
  it('when the AI says lower, it says the rules result was kept', () => { render(<AiOpinion opinion={o({ tier: 4, rulesTier: 2, relation: 'lower' })} />); expect(screen.getByText(/rules result was kept/)).toBeInTheDocument(); });
  it('agreement is stated plainly', () => { render(<AiOpinion opinion={o({ tier: 2, rulesTier: 2, relation: 'agrees' })} />); expect(screen.getByText('The AI model agrees with the rules.')).toBeInTheDocument(); });
});
