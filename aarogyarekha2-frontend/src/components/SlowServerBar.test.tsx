import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SHOW_SLOW_SERVER_NOTICE, SLOW_SERVER_MESSAGE, SLOW_SERVER_SHORT } from '../config';
import { SlowServerBar } from './HackathonBar';

let status = 'signedIn';
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status }) }));
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><SlowServerBar /></MemoryRouter>);

describe('speed warning', () => {
  it('is on, and says plainly that answers may be slow and why', () => {
    expect(SHOW_SLOW_SERVER_NOTICE).toBe(true);
    expect(SLOW_SERVER_MESSAGE).toMatch(/slow/i); for (const m of [SLOW_SERVER_MESSAGE, SLOW_SERVER_SHORT]) expect(m).toMatch(/far from you/);
  });
  it('slides across signed-in pages, announced once, and can be paused', () => {
    status = 'signedIn'; const { container } = at('/encounters/1');
    expect(screen.getByRole('note', { name: 'Speed notice' })).toBeInTheDocument();
    const copies = container.querySelectorAll('.hbar__text'); expect(copies).toHaveLength(2); expect(copies[1]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });
  it('shows on the landing page, but not over the sign-in page, which carries it above its card', () => {
    status = 'signedOut'; at('/'); expect(screen.getByRole('note', { name: 'Speed notice' })).toBeInTheDocument();
  });
  it('is left out on the sign-in page', () => {
    status = 'signedOut'; at('/anything'); expect(screen.queryByRole('note', { name: 'Speed notice' })).toBeNull();
  });
});
