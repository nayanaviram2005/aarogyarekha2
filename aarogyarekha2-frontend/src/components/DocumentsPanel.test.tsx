import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { Api, DocumentMeta, ExtractedField, Extraction } from '../lib/types';
import { DocumentsPanel } from './DocumentsPanel';

const doc = (over: Partial<DocumentMeta> = {}): DocumentMeta => ({ id: 'd1', encounterId: 'e1', kind: 'lab_report', mimeType: 'application/pdf', sizeBytes: 20480, filename: 'cbc.pdf', status: 'clean', createdAt: '2026-10-06T10:00:00Z', ...over });
const field = (over: Partial<ExtractedField> = {}): ExtractedField => ({ id: 'f1', name: 'haemoglobin', printedLine: 'Haemoglobin 9.1 g/dL 12.0 - 15.5 L', valueText: '9.1', valueNum: 9.1, unit: 'g/dL', referenceRange: '12.0 - 15.5', printedFlag: 'low', confidence: 0.91, verified: false, verifiedAt: null, ...over });
const extraction = (fields: ExtractedField[] = [field()], over: Partial<Extraction> = {}): Extraction => ({ id: 'x1', documentId: 'd1', engine: 'pdf-text-layer', status: 'completed', language: null, averageConfidence: 0.9, error: null, createdAt: '2026-10-06T10:05:00Z', fields, ...over });

const fakeApi = (over: Record<string, unknown> = {}) => ({
  documents: vi.fn().mockResolvedValue([]), uploadDocument: vi.fn().mockResolvedValue({ id: 'd1', metadataBytesRemoved: 0 }), documentFile: vi.fn().mockResolvedValue({ blob: new Blob(['x']), filename: 'f.png' }),
  extractDocument: vi.fn().mockResolvedValue(extraction()), extraction: vi.fn().mockResolvedValue(null), verifyField: vi.fn().mockResolvedValue({ ok: true }), addVital: vi.fn().mockResolvedValue({ id: 'v' }), ...over,
}) as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
const file = (name: string, type: string, bytes = 100) => new File([new Uint8Array(bytes)], name, { type });
const pick = async (f: File) => userEvent.upload(screen.getByLabelText('Choose a report or photo'), f, { applyAccept: false });

describe('uploading', () => {
  it('is hidden when the encounter cannot be edited', async () => {
    render(<DocumentsPanel api={fakeApi()} encounterId="e1" editable={false} />);
    expect(await screen.findByText(/Files cannot be added/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a report or photo')).not.toBeInTheDocument();
  });
  it('refuses the wrong file type and a file that is too large before contacting the server', async () => {
    const api = fakeApi();
    render(<DocumentsPanel api={api} encounterId="e1" editable />);
    await screen.findByText(/No reports or photos uploaded yet/);
    await pick(file('virus.exe', 'application/x-msdownload')); await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only PDF, JPEG and PNG files are accepted.');
    await pick(file('big.pdf', 'application/pdf', 11 * 1024 * 1024)); await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('larger than 10 MB');
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });
  it('asks for a file first', async () => {
    render(<DocumentsPanel api={fakeApi()} encounterId="e1" editable />);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a file first.');
  });
  it('uploads with the chosen kind, says when hidden photo details were removed, and refreshes the list', async () => {
    const api = fakeApi({ uploadDocument: vi.fn().mockResolvedValue({ id: 'd1', metadataBytesRemoved: 2048 }) });
    render(<DocumentsPanel api={api} encounterId="e1" editable />);
    await screen.findByText(/No reports or photos uploaded yet/);
    await userEvent.selectOptions(screen.getByLabelText('What is it'), 'photo');
    const f = file('IMG_1.jpg', 'image/jpeg'); await pick(f);
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(api.uploadDocument).toHaveBeenCalledWith('e1', f, 'photo'));
    expect(await screen.findByText(/Hidden details in the photo \(such as location\) were removed/)).toBeInTheDocument();
    await waitFor(() => expect(api.documents).toHaveBeenCalledTimes(2));
  });
  it('shows the server\'s plain reason when a file is refused', async () => {
    const api = fakeApi({ uploadDocument: vi.fn().mockRejectedValue(new ApiError(400, 'This PDF contains active content, so it was not accepted.')) });
    render(<DocumentsPanel api={api} encounterId="e1" editable />);
    await screen.findByText(/No reports or photos uploaded yet/);
    await pick(file('a.pdf', 'application/pdf')); await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('active content');
  });
  it('says that photos are cleaned of location and camera details', async () => {
    render(<DocumentsPanel api={fakeApi()} encounterId="e1" editable />);
    expect(await screen.findByText(/cleaned of location and camera details/)).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('shows what was uploaded and whether it was accepted; an unaccepted file has no actions', async () => {
    render(<DocumentsPanel api={fakeApi({ documents: vi.fn().mockResolvedValue([doc(), doc({ id: 'd2', filename: 'bad.pdf', status: 'failed' })]) })} encounterId="e1" editable />);
    expect(await screen.findByText('cbc.pdf')).toBeInTheDocument();
    expect(screen.getByText('Checked')).toBeInTheDocument();
    expect(screen.getByText('Not accepted')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Read results' })).toHaveLength(1);
  });
  it('a PDF is downloaded and an image opens in a viewer that can be closed', async () => {
    const api = fakeApi({ documents: vi.fn().mockResolvedValue([doc(), doc({ id: 'd2', filename: 'photo.png', mimeType: 'image/png' })]) });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    render(<DocumentsPanel api={api} encounterId="e1" editable />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }));
    await waitFor(() => expect(api.documentFile).toHaveBeenCalledWith('d1'));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('dialog', { name: 'Uploaded image' })).toBeInTheDocument();
    expect(screen.getByAltText('Uploaded report')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('reading results and verifying rows', () => {
  const setup = (over: Record<string, unknown> = {}, editable = true) => {
    const api = fakeApi({ documents: vi.fn().mockResolvedValue([doc()]), ...over });
    render(<DocumentsPanel api={api} encounterId="e1" editable={editable} />);
    return api;
  };
  it('reads in the chosen language and shows the rows as copied, with a clear "not interpreted" notice', async () => {
    const api = setup();
    await userEvent.selectOptions(await screen.findByLabelText('Language of the report'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Read results' }));
    await waitFor(() => expect(api.extractDocument).toHaveBeenCalledWith('d1', 'hi'));
    expect(await screen.findByText(/not interpreted/)).toBeInTheDocument();
    expect(screen.getByText('haemoglobin')).toBeInTheDocument();
    expect(screen.getByText('12.0 - 15.5')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();
  });
  it('a printed flag is shown as printed and never judged: no colour classes for abnormal', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
    const row = (await screen.findByText('haemoglobin')).closest('tr')!;
    expect(row.querySelector('.plate, .chip--warn, [class*="urg"]')).toBeNull();
  });
  it('marks a low-confidence row so it is checked carefully', async () => {
    setup({ extractDocument: vi.fn().mockResolvedValue(extraction([field({ confidence: 0.5 })])) });
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
    expect(await screen.findByText('Check this row carefully')).toBeInTheDocument();
  });
  it('confirming sends the value and unit as edited by the person', async () => {
    const api = setup({ extraction: vi.fn().mockResolvedValue(extraction([field({ verified: true, verifiedAt: '2026-10-06T11:00:00Z' })])) });
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
    const v = await screen.findByLabelText('Value for haemoglobin');
    await userEvent.clear(v); await userEvent.type(v, '9.4');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.verifyField).toHaveBeenCalledWith('d1', 'f1', { valueNum: 9.4, unit: 'g/dL' }));
    expect(await screen.findByText(/^Verified/)).toBeInTheDocument();
  });
  it('an empty value cannot be confirmed, and a refusal is shown in words', async () => {
    const api = setup({ verifyField: vi.fn().mockRejectedValue(new ApiError(403, 'You are not allowed to confirm results at this facility.')) });
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
    const v = await screen.findByLabelText('Value for haemoglobin');
    await userEvent.clear(v);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.type(v, '9.1'); await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await within(screen.getByRole('table')).findByRole('alert')).toHaveTextContent('not allowed to confirm');
    expect(api.verifyField).toHaveBeenCalled();
  });
  it('"Use as measurement" appears only for a VERIFIED temperature, pulse or SpO2 row and adds that kind', async () => {
    const rows = [field({ id: 'f1', name: 'temperature', valueNum: 38.4, unit: 'C', verified: true, verifiedAt: '2026-10-06T11:00:00Z' }), field({ id: 'f2', name: 'pulse', valueNum: 90, unit: '/min', verified: false }), field({ id: 'f3', name: 'haemoglobin', verified: true, verifiedAt: '2026-10-06T11:00:00Z' })];
    const onM = vi.fn(); const api = fakeApi({ documents: vi.fn().mockResolvedValue([doc()]), extractDocument: vi.fn().mockResolvedValue(extraction(rows)) });
    render(<DocumentsPanel api={api} encounterId="e1" editable onMeasurementAdded={onM} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
    const btns = await screen.findAllByRole('button', { name: 'Use as measurement' });
    expect(btns).toHaveLength(1);                                                         // not pulse (unverified), not haemoglobin (not a measurement)
    await userEvent.click(btns[0]!);
    await waitFor(() => expect(api.addVital).toHaveBeenCalledWith('e1', { kind: 'temperature_c', value: 38.4 }));
    expect(onM).toHaveBeenCalled();
  });
  it('a failed reading explains why and offers no rows', async () => {
    setup({ extractDocument: vi.fn().mockResolvedValue(extraction([], { status: 'failed', error: 'This PDF is a scan with no text in it. Upload a clear photo of each page instead.' })) });
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
    expect(await screen.findByText(/Upload a clear photo of each page/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('when the server cannot read it, the message is shown and nothing breaks', async () => {
    setup({ extractDocument: vi.fn().mockRejectedValue(new ApiError(422, 'No test results were found in this document.')) });
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No test results were found');
  });
  it('without edit rights the rows are read-only and cannot be confirmed', async () => {
    setup({ extraction: vi.fn().mockResolvedValue(extraction()) }, false);
    await userEvent.click(await screen.findByRole('button', { name: 'Show results' }));
    expect(await screen.findByText('haemoglobin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Value for haemoglobin')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read results' })).not.toBeInTheDocument();
  });
  it('shows a helpful message when nothing has been read yet', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Show results' }));
    expect(await screen.findByText(/No results read yet/)).toBeInTheDocument();
  });
});

describe('second reader', () => {
  const run = async (fields: ExtractedField[]) => {
    const api = fakeApi({ documents: vi.fn().mockResolvedValue([doc()]), extractDocument: vi.fn().mockResolvedValue(extraction(fields)) });
    render(<DocumentsPanel api={api} encounterId="e1" editable />);
    await userEvent.click(await screen.findByRole('button', { name: 'Read results' }));
  };
  it('shows when two readers agree, and still asks for a person to confirm', async () => {
    await run([field({ agreement: 'agree', secondRead: '9.1' })]);
    expect(await screen.findByText('Two readers agree')).toBeInTheDocument(); expect(screen.getByText('Not verified')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
  it('flags a difference and shows what the AI read', async () => {
    await run([field({ agreement: 'differ', secondRead: '19.1' })]);
    expect(await screen.findByText('Readers differ')).toBeInTheDocument(); expect(screen.getByText(/AI model read 19\.1/)).toBeInTheDocument();
  });
  it('a row only the AI found says to check it against the report', async () => {
    await run([field({ agreement: 'ai_only', secondRead: '7.2' })]);
    expect(await screen.findByText('AI only')).toBeInTheDocument(); expect(screen.getByText(/Check it against the report/)).toBeInTheDocument();
  });
  it('rows with no second read show nothing extra', async () => {
    await run([field()]); await screen.findByText('Not verified');
    for (const t of ['Two readers agree', 'Readers differ', 'AI only', 'Local reader only']) expect(screen.queryByText(t)).toBeNull();
  });
});
