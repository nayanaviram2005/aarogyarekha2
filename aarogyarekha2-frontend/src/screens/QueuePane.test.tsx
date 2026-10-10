import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '../lib/types';
import { I18nProvider } from '../i18n/I18n';

const h = vi.hoisted(() => ({ entries: [] as unknown[], api: null as unknown }));
vi.mock('./queueContext', () => ({ useQueue: () => ({ entries: h.entries, loading: false, error: null, generatedAt: null, refresh: vi.fn() }) }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ api: h.api }) }));
vi.mock('./meContext', () => ({ useMe: () => ({ displayName: 'Nurse', memberships: [] }) }));
vi.mock('../components/QueueFlow', () => ({ QueueCounts: () => null, DoneToday: () => null }));
import { QueuePane } from './QueuePane';

const e = (over: Partial<QueueEntry> = {}): QueueEntry => ({ encounterId: 'e1', patient: { id: 'p', public_ref: 'AR-1', full_name: 'Asha Rao', sex: 'female', birth_date: null, age_years_reported: 34, preferred_language: 'en' }, scenario: 'opd_queue', chiefComplaint: 'Fever', chiefComplaintTranslated: null, assessed: true, urgencyCode: 'yellow', tier: 3, potentialTier: null, missingCount: 0, winningLabel: null, vulnerable: false, queueStatus: 'waiting', waitingSince: new Date().toISOString(), assessmentVersion: 1, engineTier: 3, reviewed: false, ...over });
const view = () => render(<I18nProvider><MemoryRouter><QueuePane /></MemoryRouter></I18nProvider>);

beforeEach(() => {
  h.api = { documentFile: vi.fn().mockResolvedValue({ blob: new Blob(['x']), filename: 'f.png' }) };
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

describe('files on the queue', () => {
  it('shows each patient’s uploaded files as links at the right of their case', async () => {
    h.entries = [e({ documents: [{ id: 'd1', name: 'cbc-report.png', mimeType: 'image/png', kind: 'lab_report' }, { id: 'd2', name: 'discharge.pdf', mimeType: 'application/pdf', kind: 'discharge_summary' }] })];
    view();
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open file cbc-report.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open file discharge.pdf' })).toBeInTheDocument();
  });

  it('opens the file without opening the patient', async () => {
    h.entries = [e({ documents: [{ id: 'd1', name: 'cbc-report.png', mimeType: 'image/png', kind: 'lab_report' }] })];
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Open file cbc-report.png' }));
    expect((h.api as { documentFile: ReturnType<typeof vi.fn> }).documentFile).toHaveBeenCalledWith('d1');
    expect(await screen.findByRole('dialog', { name: 'Uploaded image' })).toBeInTheDocument();
  });

  it('the file links are not inside the row button, so the row stays a valid single button', () => {
    h.entries = [e({ documents: [{ id: 'd1', name: 'cbc-report.png', mimeType: 'image/png', kind: 'lab_report' }] })];
    view();
    const row = screen.getByRole('button', { name: /Asha Rao/ });
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('shows nothing extra for a patient with no files', () => {
    h.entries = [e({ documents: [] }), e({ encounterId: 'e2', documents: undefined })];
    view();
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });
});
