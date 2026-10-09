import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FollowUpControl } from './FollowUpControl';
import { NoticeBars } from './HackathonBar';

let status = 'signedIn';
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status }) }));
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><NoticeBars /></MemoryRouter>);

describe('the two moving notices share one Pause control', () => {
  it('shows both notices with a single Pause button that stops and restarts both', async () => {
    status = 'signedIn'; const { container } = at('/');
    expect(screen.getByRole('note', { name: 'Prototype notice' })).toBeInTheDocument(); expect(screen.getByRole('note', { name: 'Speed notice' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Pause|Play/ })).toHaveLength(1);
    const wrap = container.querySelector('.bars')!; expect(wrap).toHaveAttribute('data-paused', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' })); expect(wrap).toHaveAttribute('data-paused', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Play' })); expect(wrap).toHaveAttribute('data-paused', 'false');
  });
  it('leaves the speed notice out over the sign-in page, where the box above the card says it', () => {
    status = 'signedOut'; at('/sign-in');
    expect(screen.getByRole('note', { name: 'Prototype notice' })).toBeInTheDocument(); expect(screen.queryByRole('note', { name: 'Speed notice' })).toBeNull();
  });
});

describe('question effect line', () => {
  const base = { fieldCode: 'sign.airway', question: 'Is the airway blocked?', rank: 1, potentialTier: 2 as const, onDraft: () => {} };
  it('says what a Yes could change by default, and can leave it out when the list says it once', () => {
    const { rerender } = render(<ol><FollowUpControl {...base} /></ol>);
    expect(screen.getByText(/Could change the priority to very urgent/)).toBeInTheDocument();
    rerender(<ol><FollowUpControl {...base} showEffect={false} /></ol>);
    expect(screen.queryByText(/Could change the priority/)).toBeNull();
  });
});
