import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Api, RecordContext } from '../lib/types';
import { RecordContextPanel } from './RecordContextPanel';

const ctx = (over: Partial<RecordContext['summary']> = {}): RecordContext => ({
  summary: { documents: 1, read: 1, notRead: 0, rows: 3, verified: 1, flagged: 1, lines: ['Haemoglobin 9.1 g/dL (printed LOW)'], ...over }, documents: [],
});
const view = (c: RecordContext | Error) => render(<RecordContextPanel api={{ recordContext: vi.fn().mockImplementation(async () => { if (c instanceof Error) throw c; return c; }) } as unknown as Api} encounterId="e1" />);

describe('records on file', () => {
  it('shows what the lab flagged, as printed, and does not nag about rows no person has checked', async () => {
    view(ctx());
    expect(await screen.findByText('Records on file')).toBeInTheDocument();
    expect(screen.getByText(/Haemoglobin 9.1 g\/dL \(printed LOW/)).toBeInTheDocument();
    expect(screen.queryByText(/not been checked by a person/)).not.toBeInTheDocument();
    expect(screen.queryByText(/only uses checked results/)).not.toBeInTheDocument();
    expect(screen.getByText(/not a diagnosis/)).toBeInTheDocument();
  });
  it('shows nothing when no record was uploaded', async () => {
    const { container } = view(ctx({ documents: 0, rows: 0, lines: [] }));
    await new Promise(r => setTimeout(r, 20)); expect(container).toBeEmptyDOMElement();
  });
  it('says so when a record is there but nothing was read from it', async () => {
    view(ctx({ rows: 0, read: 0, notRead: 1, flagged: 0, lines: [], verified: 0 }));
    expect(await screen.findByText(/not been read yet/)).toBeInTheDocument();
  });
  it('says plainly when the records could not be loaded', async () => {
    view(new Error('down')); expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });
});
