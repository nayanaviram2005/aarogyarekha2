import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RecordFile } from '../lib/recordsIntake';
import type { Api, RecordIdentity } from '../lib/types';
import { RecordsPicker } from './RecordsPicker';

function Host({ api, onIdentity }: { api: Api; onIdentity: (i: RecordIdentity) => void }) {
  const [files, setFiles] = useState<RecordFile[]>([]);
  return <RecordsPicker api={api} files={files} setFiles={setFiles} language="en" onIdentity={onIdentity} />;
}
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

describe('adding records at intake', () => {
  it('reads each file, shows how many results were found, and passes up who it seems to be about', async () => {
    const readRecord = vi.fn().mockResolvedValue({ identity: { fullName: 'Asha Rao', ageYears: 27 }, rows: 5, readable: true, note: null, averageConfidence: 0.9 });
    const onIdentity = vi.fn();
    render(<Host api={{ readRecord } as unknown as Api} onIdentity={onIdentity} />);
    await userEvent.upload(screen.getByLabelText(/Patient records/), pdf('cbc.pdf'));
    expect(await screen.findByText(/5 test results found/)).toBeInTheDocument();
    expect(onIdentity).toHaveBeenCalledWith({ fullName: 'Asha Rao', ageYears: 27 });
    expect(readRecord).toHaveBeenCalledWith(expect.any(File), 'en', false);
  });
  it('asks for the patient\'s agreement before a photo goes to the outside AI reader, then reads it', async () => {
    const readRecord = vi.fn()
      .mockResolvedValueOnce({ identity: {}, rows: 0, readable: false, note: 'Reading a photo needs the patient’s separate consent.', averageConfidence: null, needsAiConsent: true })
      .mockResolvedValueOnce({ identity: { fullName: 'Asha Rao' }, rows: 3, readable: true, note: null, averageConfidence: null, readBy: 'ai' });
    const onIdentity = vi.fn();
    render(<Host api={{ readRecord } as unknown as Api} onIdentity={onIdentity} />);
    await userEvent.upload(screen.getByLabelText(/Patient records/), new File(['x'], 'photo.png', { type: 'image/png' }));
    await userEvent.click(await screen.findByRole('button', { name: /Patient agrees: read the photo/ }));
    expect(await screen.findByText(/3 test results found/)).toBeInTheDocument();
    expect(readRecord).toHaveBeenLastCalledWith(expect.any(File), 'en', true);
    expect(onIdentity).toHaveBeenCalledWith({ fullName: 'Asha Rao' });
  });
  it('says plainly when a record cannot be read, and lets it be removed', async () => {
    const readRecord = vi.fn().mockResolvedValue({ identity: {}, rows: 0, readable: false, note: 'This PDF is a scan with no text in it.', averageConfidence: null });
    render(<Host api={{ readRecord } as unknown as Api} onIdentity={() => {}} />);
    await userEvent.upload(screen.getByLabelText(/Patient records/), pdf('scan.pdf'));
    expect(await screen.findByText(/Could not be read · This PDF is a scan/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('scan.pdf')).toBeNull());
  });
  it('shows the server\'s refusal for a file that is not safe, without stopping the others', async () => {
    const readRecord = vi.fn().mockRejectedValueOnce(new Error('This kind of file is not accepted.')).mockResolvedValue({ identity: {}, rows: 2, readable: true, note: null, averageConfidence: 1 });
    render(<Host api={{ readRecord } as unknown as Api} onIdentity={() => {}} />);
    await userEvent.upload(screen.getByLabelText(/Patient records/), [pdf('bad.pdf'), pdf('good.pdf')]);
    expect(await screen.findByText(/Failed · This kind of file is not accepted/)).toBeInTheDocument();
    expect(await screen.findByText(/2 test results found/)).toBeInTheDocument();
  });
});
