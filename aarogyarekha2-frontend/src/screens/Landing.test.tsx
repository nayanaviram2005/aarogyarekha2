import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Landing } from './Landing';

const view = () => render(<MemoryRouter><Landing /></MemoryRouter>);

describe('landing page', () => {
  it('says what the app does and does not do', () => {
    view();
    expect(screen.getByRole('heading', { level: 1, name: 'Who should be seen first.' })).toBeInTheDocument();
    expect(screen.getByText(/does not diagnose, and it does not decide treatment/)).toBeInTheDocument();
    expect(screen.getByText(/A nurse or doctor signs off every decision/)).toBeInTheDocument();
  });
  it('sign in links go to the sign-in page', () => {
    view();
    for (const a of screen.getAllByRole('link', { name: 'Sign in' })) expect(a).toHaveAttribute('href', '/sign-in');
  });
  it('is honest about its status', () => {
    view();
    expect(screen.getByText(/not for use with real patients/i)).toBeInTheDocument();
    expect(screen.getAllByText(/have not been clinically validated/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Hindi and Odia wording has not been reviewed/).length).toBeGreaterThan(0);
  });
  it('shows the sample queue as invented and all four priority plates', () => {
    view();
    expect(screen.getByText(/The patients are invented/)).toBeInTheDocument();
    for (const w of ['Immediate', 'Very urgent', 'Urgent', 'Routine']) expect(screen.getAllByRole('img', { name: new RegExp(w, 'i') }).length).toBeGreaterThan(0);
  });
  it('says the administrator cannot open patient records', () => {
    view(); expect(screen.getByText(/Cannot open patient records/)).toBeInTheDocument();
  });
});

describe('landing page bar', () => {
  it('has no brand: only Features, Contact and Sign in', () => {
    view();
    const bar = screen.getByRole('navigation', { name: 'Page' });
    expect(bar).toHaveTextContent(/^FeaturesContactSign in$/);
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features');
    expect(screen.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '#contact');
  });
  it('has a contact section that does not invent an address', () => {
    view();
    expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument();
    expect(screen.getByText(/Accounts are created by your facility administrator/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/mailto:|@[a-z]+\.[a-z]/i);
  });
});
