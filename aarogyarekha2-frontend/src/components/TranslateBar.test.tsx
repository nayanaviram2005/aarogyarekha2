import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';
import { TranslateBar } from './TranslateBar';

const api = (translate: unknown, extra: Record<string, unknown> = {}) => ({ translate, recordConsent: vi.fn().mockResolvedValue({ id: 'c' }), ...extra }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const ok = { translated: 2, rejected: 0, provider: 'gemini', model: 'm', machineTranslation: true };

describe('TranslateBar', () => {
  it('says what it does: machine translation, unverified, original stays, personal details removed first', () => {
    render(<TranslateBar api={api(vi.fn())} encounterId="e1" patientId="p1" onDone={() => {}} />);
    expect(screen.getByText(/Machine translation, not verified/)).toBeInTheDocument();
    expect(screen.getByText(/original stays on screen/)).toBeInTheDocument();
    expect(screen.getByText(/Names and phone numbers are removed/)).toBeInTheDocument();
  });
  it('translates, reports how many, and refreshes the screen', async () => {
    const onDone = vi.fn(); const a = api(vi.fn().mockResolvedValue(ok));
    render(<TranslateBar api={a} encounterId="e1" patientId="p1" onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: 'Translate to English' }));
    expect(await screen.findByText('Translated 2.')).toBeInTheDocument();
    expect(a.translate).toHaveBeenCalledWith('e1'); expect(onDone).toHaveBeenCalled();
  });
  it('tells the user when some items could not be translated safely', async () => {
    render(<TranslateBar api={api(vi.fn().mockResolvedValue({ ...ok, translated: 1, rejected: 2 }))} encounterId="e1" patientId="p1" onDone={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Translate to English' }));
    expect(await screen.findByText(/2 could not be translated safely and stay in the original language/)).toBeInTheDocument();
  });
it('never shows a separate AI consent form: a missing triage consent is just an error message', async () => {    const translate = vi.fn().mockRejectedValue(new ApiError(403, 'No active consent for triage is recorded for this patient. Record it first, or read the original text.'));    const a = api(translate);    render(<TranslateBar api={a} encounterId="e1" patientId="p1" onDone={() => {}} />);    await userEvent.click(screen.getByRole('button', { name: 'Translate to English' }));    expect(await screen.findByRole('alert')).toHaveTextContent('No active consent for triage');    expect(screen.queryByText(/outside AI service/)).not.toBeInTheDocument();    expect(a.recordConsent).not.toHaveBeenCalled();  });
  it('shows other failures in plain words, with no consent form', async () => {
    render(<TranslateBar api={api(vi.fn().mockRejectedValue(new ApiError(503, 'The translation service is not set up. The original text is shown.')))} encounterId="e1" patientId="p1" onDone={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Translate to English' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up');
    expect(screen.queryByText(/Record consent/)).not.toBeInTheDocument();
  });
});
