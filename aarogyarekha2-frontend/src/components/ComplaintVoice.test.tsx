import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';
import { ComplaintVoice } from './ComplaintVoice';

const rec = vi.hoisted(() => ({ canRecord: vi.fn(() => true), start: vi.fn(), cancel: vi.fn() }));
vi.mock('../lib/recorder', () => ({ canRecord: () => rec.canRecord(), startRecording: () => rec.start() }));

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
const ok = { text: ' bukhar teen din se ', language: 'hi', provider: 'sarvam', model: 'm', machineTranscript: true as const };
const api = (transcribe: unknown) => ({ transcribe, recordConsent: vi.fn().mockResolvedValue({ id: 'c' }) }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = (a: Api, onText = vi.fn(), language = 'hi') => { render(<ComplaintVoice api={a} patientId="p1" patientName="Lakshmi Das" language={language} onText={onText} />); return onText; };
const speak = async () => { await userEvent.click(screen.getByRole('button', { name: 'Speak the complaint' })); await userEvent.click(await screen.findByRole('button', { name: 'Stop and convert' })); };

beforeEach(() => { rec.canRecord.mockReturnValue(true); rec.start.mockReset().mockResolvedValue({ stop: async () => blob, cancel: rec.cancel }); rec.cancel.mockReset(); });

describe('ComplaintVoice', () => {
  it('sends the recording for the patient in the chosen language and hands back the trimmed text without saving anything', async () => {
    const a = api(vi.fn().mockResolvedValue(ok)); const onText = view(a);
    await speak();
    await waitFor(() => expect(onText).toHaveBeenCalledWith('bukhar teen din se'));
    expect(a.transcribe).toHaveBeenCalledWith({ patientId: 'p1' }, blob, 'hi');
    expect(await screen.findByText(/Transcript added to the complaint/)).toBeInTheDocument();
  });
  it('offers every Sarvam language plus automatic detection, and sends the one chosen', async () => {
    const a = api(vi.fn().mockResolvedValue(ok)); view(a);
    const select = screen.getByLabelText('Spoken language');
    expect(screen.getAllByRole('option')).toHaveLength(24);
    for (const name of ['Detect automatically', 'English', 'Hindi', 'Odia', 'Tamil', 'Telugu', 'Bengali', 'Konkani', 'Santali', 'Manipuri', 'Dogri']) expect(screen.getByRole('option', { name })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'ta'); await speak();
    await waitFor(() => expect(a.transcribe).toHaveBeenCalledWith({ patientId: 'p1' }, blob, 'ta'));
  });
  it('shows the live level from the microphone while recording, and not before', async () => {
    let level = 0;
    rec.start.mockResolvedValue({ stop: async () => blob, cancel: rec.cancel, level: () => level });
    view(api(vi.fn().mockResolvedValue(ok)));
    expect(screen.queryByLabelText('Live microphone level')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Speak the complaint' }));
    const meter = await screen.findByLabelText('Live microphone level');
    const bars = () => Array.from(meter.querySelectorAll<HTMLElement>('.mic-level__bar')).map(b => parseInt(b.style.height || '0', 10));
    expect(bars()).toHaveLength(32);
    await waitFor(() => expect(Math.max(...bars())).toBeLessThanOrEqual(3));
    level = 1;
    await waitFor(() => expect(Math.max(...bars())).toBe(28));
    level = 0;
    await waitFor(() => expect(bars().at(-1)).toBe(3));
  });
  it('says the recording is not kept and the text is unchecked', () => {
    view(api(vi.fn()));
    expect(screen.getByText(/not kept/)).toBeInTheDocument(); expect(screen.getByText(/not checked/)).toBeInTheDocument();
  });
  it('treats a language other than Hindi or Odia as English', async () => {
    const a = api(vi.fn().mockResolvedValue(ok)); view(a, vi.fn(), 'fr'); await speak();
    await waitFor(() => expect(a.transcribe).toHaveBeenCalledWith({ patientId: 'p1' }, blob, 'en'));
  });
  it('shows nothing in a browser that cannot record', () => {
    rec.canRecord.mockReturnValue(false);
    view(api(vi.fn()));
    expect(screen.queryByRole('button', { name: 'Speak the complaint' })).not.toBeInTheDocument();
  });
  it('an empty transcript is reported and changes nothing', async () => {
    const onText = view(api(vi.fn().mockResolvedValue({ ...ok, text: '  ' }))); await speak();
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing could be heard'); expect(onText).not.toHaveBeenCalled();
  });
  it('without consent it asks for it, then sends the same recording again by itself', async () => {
    const transcribe = vi.fn().mockRejectedValueOnce(new ApiError(403, 'The patient has not consented to an outside AI service hearing their voice. Record that consent first, or type the complaint.')).mockResolvedValue(ok);
    const a = api(transcribe); const onText = view(a); await speak();
    expect(await screen.findByText('Record consent to use an outside AI service')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Witness name'), 'A. Witness');
    await userEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    await waitFor(() => expect(a.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ purpose: 'external_ai_processing' })));
    await waitFor(() => expect(onText).toHaveBeenCalledWith('bukhar teen din se'));
    expect(transcribe).toHaveBeenCalledTimes(2); expect(transcribe.mock.calls[1]![1]).toBe(blob);
  });
  it('other failures are shown in plain words with no consent form', async () => {
    view(api(vi.fn().mockRejectedValue(new ApiError(503, 'Voice input is not set up. Type the complaint instead.')))); await speak();
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up');
    expect(screen.queryByText(/Record consent/)).not.toBeInTheDocument();
  });
});
