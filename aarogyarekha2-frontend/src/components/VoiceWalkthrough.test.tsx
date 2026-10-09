import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api } from '../lib/types';

const h = vi.hoisted(() => ({ speak: vi.fn(), stop: vi.fn(), start: vi.fn(), canRecord: vi.fn() }));
vi.mock('../lib/speech', () => ({ speak: h.speak, stopSpeaking: h.stop }));
vi.mock('../lib/recorder', () => ({ canRecord: h.canRecord, startRecording: h.start }));
vi.mock('../screens/meContext', () => ({ useMe: () => ({ displayName: 'Nurse A' }) }));
import { VoiceWalkthrough, type WalkQuestion } from './VoiceWalkthrough';

const qs: WalkQuestion[] = [
  { code: 'sign.airway', text: l => (l === 'hi' ? 'क्या साँस रुकी है?' : 'Is the airway blocked?') },
  { code: 'sign.cyanosis', text: () => 'Are the lips blue or grey?' },
];
const mkApi = (transcribe = vi.fn().mockResolvedValue({ text: 'haan', language: 'hi', provider: 'gemini', model: 'm', machineTranscript: true })) => ({ transcribe, recordConsent: vi.fn().mockResolvedValue({ id: 'c' }) }) as unknown as Api & { transcribe: typeof transcribe };
const setup = (api = mkApi(), lang = 'en') => {
  const onAnswer = vi.fn();
  render(<VoiceWalkthrough api={api} encounterId="e1" patientId="p1" defaultLanguage={lang} questions={qs} onAnswer={onAnswer} />);
  return { api, onAnswer };
};
beforeEach(() => {
  h.speak.mockReset().mockResolvedValue('spoken'); h.stop.mockReset(); h.canRecord.mockReset().mockReturnValue(true);
  h.start.mockReset().mockResolvedValue({ stop: async () => new Blob(['a']), cancel: vi.fn() });
});

describe('voice walkthrough', () => {
  it('offers the button, then reads the first question aloud and shows it', async () => {
    setup(); await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' }));
    expect(screen.getByText('Is the airway blocked?')).toBeInTheDocument(); expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    await waitFor(() => expect(h.speak).toHaveBeenCalledWith('Is the airway blocked?', 'en'));
  });
  it('is disabled when there are no questions to ask', () => {
    render(<VoiceWalkthrough api={mkApi()} encounterId="e1" patientId="p1" defaultLanguage="en" questions={[]} onAnswer={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ask by voice' })).toBeDisabled();
  });
  it('tapping Yes or No records the answer as a draft and moves on, then finishes with what to do next', async () => {
    const { onAnswer } = setup(); await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes' })); expect(onAnswer).toHaveBeenLastCalledWith('sign.airway', true);
    expect(screen.getByText('Are the lips blue or grey?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'No' })); expect(onAnswer).toHaveBeenLastCalledWith('sign.cyanosis', false);
    expect(screen.getByRole('status')).toHaveTextContent('2 answers chosen'); expect(screen.getByRole('status')).toHaveTextContent('press Submit answers');
  });
  it('a spoken answer is heard, shown, and only used when the person confirms it', async () => {
    const { api, onAnswer } = setup(); await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' }));
    await userEvent.click(screen.getByRole('button', { name: 'Answer by voice' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop listening' }));
    expect(await screen.findByText(/Heard “haan”/)).toBeInTheDocument();
    expect(api.transcribe).toHaveBeenCalledWith('e1', expect.any(Blob), 'en'); expect(onAnswer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Use Yes' })); expect(onAnswer).toHaveBeenCalledWith('sign.airway', true);
  });
  it('when the answer cannot be understood it says so and takes nothing', async () => {
    const { onAnswer } = setup(mkApi(vi.fn().mockResolvedValue({ text: 'maybe', language: 'en', provider: 'g', model: 'm', machineTranscript: true })));
    await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' })); await userEvent.click(screen.getByRole('button', { name: 'Answer by voice' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop listening' }));
    expect(await screen.findByText(/Could not tell yes or no from “maybe”/)).toBeInTheDocument(); expect(onAnswer).not.toHaveBeenCalled();
  });
  it('without the patient\'s agreement to an outside speech service it asks for it, in a pop-up, and tries again', async () => {
    const transcribe = vi.fn().mockRejectedValueOnce(new ApiError(403, 'The patient has not consented to an outside AI service hearing their voice. Record that consent first.')).mockResolvedValue({ text: 'nahi', language: 'hi', provider: 'g', model: 'm', machineTranscript: true });
    const { api } = setup(mkApi(transcribe)); await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' })); await userEvent.click(screen.getByRole('button', { name: 'Answer by voice' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop listening' }));
    expect(await screen.findByRole('heading', { name: 'Consent to use an outside AI service' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Patient agrees' }));
    await waitFor(() => expect(api.recordConsent).toHaveBeenCalledWith('p1', expect.objectContaining({ purpose: 'external_ai_processing' })));
    expect(await screen.findByText(/Heard “nahi”, taken as/)).toBeInTheDocument(); expect(transcribe).toHaveBeenCalledTimes(2);
  });
  it('says plainly when the device has no spoken voice for the language, and still works by tapping', async () => {
    h.speak.mockResolvedValue('no_voice'); const { onAnswer } = setup(mkApi(), 'or');
    await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' }));
    expect(await screen.findByText(/no spoken voice for Odia/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes' })); expect(onAnswer).toHaveBeenCalledWith('sign.airway', true);
  });
  it('hides the voice-answer button when the browser cannot record, and can go back and skip', async () => {
    h.canRecord.mockReturnValue(false); setup(); await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' }));
    expect(screen.queryByRole('button', { name: 'Answer by voice' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' })); expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' })); expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
  });
  it('uses the question in the chosen language and can be closed', async () => {
    setup(mkApi(), 'hi'); await userEvent.click(screen.getByRole('button', { name: 'Ask by voice' }));
    expect(screen.getByText('क्या साँस रुकी है?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' })); expect(screen.getByRole('button', { name: 'Ask by voice' })).toBeInTheDocument();
  });
});
