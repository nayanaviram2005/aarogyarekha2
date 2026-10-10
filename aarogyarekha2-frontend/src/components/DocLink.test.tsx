import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../lib/types';
import { DocLink } from './DocLink';

const api = (o: Record<string, unknown> = {}) => ({ documentFile: vi.fn().mockResolvedValue({ blob: new Blob(['x']), filename: 'f.png' }), ...o }) as unknown as Api & { documentFile: ReturnType<typeof vi.fn> };
const img = { id: 'd1', mimeType: 'image/png', name: 'cbc-photo.png' };
const pdf = { id: 'd2', mimeType: 'application/pdf', name: 'cbc.pdf' };

beforeEach(() => { Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }); });
afterEach(() => vi.restoreAllMocks());

describe('DocLink', () => {
  it('shows the file name as a link, and opens a photo from the signed-in session', async () => {
    const a = api(); render(<DocLink api={a} doc={img} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open file cbc-photo.png' }));
    expect(a.documentFile).toHaveBeenCalledWith('d1');
    expect(await screen.findByRole('dialog', { name: 'Uploaded image' })).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a PDF in a new tab without giving the new page access to this one', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const a = api(); render(<DocLink api={a} doc={pdf} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open file cbc.pdf' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:x', '_blank', 'noopener'));
  });

  it('does not open the row it sits in when it is clicked', async () => {
    const row = vi.fn(); const a = api();
    render(<div onClick={row}><DocLink api={a} doc={img} /></div>);
    await userEvent.click(screen.getByRole('button', { name: 'Open file cbc-photo.png' }));
    expect(row).not.toHaveBeenCalled();
  });

  it('says why when the file cannot be opened', async () => {
    const a = api({ documentFile: vi.fn().mockRejectedValue(new Error('No such document, or you do not have access.')) });
    render(<DocLink api={a} doc={img} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open file cbc-photo.png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No such document');
  });

  it('can be a plain button for the reports list', () => {
    render(<><DocLink api={api()} doc={img} variant="button" /><DocLink api={api()} doc={pdf} variant="button" /></>);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });
});
