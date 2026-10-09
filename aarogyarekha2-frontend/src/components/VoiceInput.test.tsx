import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';
import { VoiceInput } from './VoiceInput';

const rec = vi.hoisted(() => ({ canRecord: vi.fn(() => true), start: vi.fn(), cancel: vi.fn() }));
vi.mock('../lib/recorder', () => ({ canRecord: () => rec.canRecord(), startRecording: () => rec.start() }));

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
const ok = { text: 'bukhar teen din se', language: 'hi', provider: 'gemini', model: 'm', machineTranscript: true as const };
const api = (transcribe: unknown, extra: Record<string, unknown> = {}) => ({ transcribe, addSymptom: vi.fn().mockResolvedValue({ id: 's' }), recordConsent: vi.fn().mockResolvedValue({ id: 'c' }), ...extra }) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const view = (a: Api, over: Partial<{ defaultLanguage: string; onSaved: () => void }> = {}) => render(<VoiceInput api={a} encounterId="e1" patientId="p1" defaultLanguage="hi" onSaved={() => {}} {...over} />);
const recordAndStop = async () => { await userEvent.click(screen.getByRole('button', { name: 'Record' })); await userEvent.click(await screen.findByRole('button', { name: 'Stop and convert' })); };

beforeEach(() => { rec.canRecord.mockReturnValue(true); rec.start.mockReset().mockResolvedValue({ stop: async () => blob, cancel: rec.cancel }); rec.cancel.mockReset(); });

describe('VoiceInput', () => {
  it('says the recording is not kept and the text is an unchecked machine transcript', () => {
    view(api(vi.fn()));
    expect(screen.getByText(/not kept/)).toBeInTheDocument(); expect(screen.getByText(/machine transcript, not checked/)).toBeInTheDocument();
  });
  it('defaults the spoken language to the encounter language', () => {
    view(api(vi.fn()));
    expect(screen.getByLabelText('Spoken language')).toHaveValue('hi');
  });
  it('a browser that cannot record says so and shows no record button', () => {
    rec.canRecord.mockReturnValue(false);
    view(api(vi.fn()));
    expect(screen.getByText(/not available in this browser/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
  });
  it('a blocked microphone shows the reason and lets the user type instead', async () => {
    rec.start.mockRejectedValue(new Error('The microphone could not be used. Allow microphone access for this site, or type instead.'));
    view(api(vi.fn()));
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('microphone could not be used');
  });
  it('records, converts, shows an editable draft, and saves only what the person confirms', async () => {
    const onSaved = vi.fn(); const a = api(vi.fn().mockResolvedValue(ok));
    view(a, { onSaved });
    await recordAndStop();
    const box = await screen.findByLabelText(/Machine transcript, not reviewed/);
    expect(box).toHaveValue('bukhar teen din se');
    expect(a.transcribe).toHaveBeenCalledWith('e1', blob, 'hi');
    expect(a.addSymptom).not.toHaveBeenCalled();
    await userEvent.clear(box); await userEvent.type(box, 'bukhar aur khansi');
    await userEvent.click(screen.getByRole('button', { name: 'Save as symptom' }));
    await waitFor(() => expect(a.addSymptom).toHaveBeenCalledWith('e1', { text: 'bukhar aur khansi', lang: 'hi' }));
    expect(onSaved).toHaveBeenCalled(); expect(await screen.findByText('Symptom saved.')).toBeInTheDocument();
  });
  it('discard throws the draft away without saving', async () => {
    const a = api(vi.fn().mockResolvedValue(ok));
    view(a); await recordAndStop();
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(screen.queryByLabelText(/Machine transcript/)).not.toBeInTheDocument(); expect(a.addSymptom).not.toHaveBeenCalled();
  });
  it('an empty draft cannot be saved', async () => {
    view(api(vi.fn().mockResolvedValue(ok))); await recordAndStop();
    await userEvent.clear(await screen.findByLabelText(/Machine transcript/));
    expect(screen.getByRole('button', { name: 'Save as symptom' })).toBeDisabled();
  });
  it('without the patient\'s consent it asks for it, then sends the SAME recording again by itself', async () => {
    const transcribe = vi.fn().mockRejectedValueOnce(new ApiError(403, 'The patient has not consented to an outside AI service hearing their voice. Record that consent first, or type the complaint.')).mockResolvedValue(ok);
    const a = api(transcribe);
    view(a); await recordAndStop();
    expect(await screen.findByText('Record consent to use an outside AI service')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Witness name'), 'A. Witness');
    await userEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    await waitFor(() => expect(a.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ purpose: 'external_ai_processing' })));
    expect(await screen.findByLabelText(/Machine transcript/)).toHaveValue('bukhar teen din se');
    expect(transcribe).toHaveBeenCalledTimes(2); expect(transcribe.mock.calls[1]![1]).toBe(blob);
  });
  it('other failures are shown in plain words with no consent form', async () => {
    view(api(vi.fn().mockRejectedValue(new ApiError(503, 'Voice input is not set up. Type the complaint instead.'))));
    await recordAndStop();
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up');
    expect(screen.queryByText(/Record consent/)).not.toBeInTheDocument();
  });
  it('leaving the screen mid-recording cancels the recording and releases the microphone', async () => {
    const { unmount } = view(api(vi.fn()));
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    await screen.findByRole('button', { name: 'Stop and convert' });
    unmount();
    expect(rec.cancel).toHaveBeenCalled();
  });
});
