import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Api, DocumentMeta, ExtractedField, Extraction } from '../lib/types';
import { buildCaseSummary } from '../lib/caseSummary';
import type { EncounterSummary } from '../lib/types';
import { CaseSummary } from './CaseSummary';
import { ReportDetails } from './ReportDetails';

const doc = (o: Partial<DocumentMeta> = {}): DocumentMeta => ({ id: 'd1', encounterId: 'e1', kind: 'lab_report', mimeType: 'application/pdf', sizeBytes: 100, filename: 'cbc.pdf', status: 'clean', createdAt: '2026-10-06T10:00:00Z', ...o });
const field = (o: Partial<ExtractedField> = {}): ExtractedField => ({ id: 'f1', name: 'haemoglobin', printedLine: 'x', valueText: '9.1', valueNum: 9.1, unit: 'g/dL', referenceRange: '12.0 - 15.5', printedFlag: 'low', confidence: 0.9, verified: false, verifiedAt: null, ...o });
const ex = (fields: ExtractedField[], o: Partial<Extraction> = {}): Extraction => ({ id: 'x1', documentId: 'd1', engine: 'e', status: 'completed', language: null, averageConfidence: 0.9, error: null, createdAt: '2026-10-06T10:05:00Z', fields, ...o });
const api = (o: Record<string, unknown> = {}) => ({ documents: vi.fn().mockResolvedValue([doc()]), extraction: vi.fn().mockResolvedValue(ex([field(), field({ id: 'f2', name: 'esr', valueNum: 30, valueText: '30', unit: 'mm/hr', referenceRange: null, printedFlag: null, verified: true, verifiedAt: '2026-10-06T11:00:00Z' })])), ...o }) as unknown as Api;

describe('ReportDetails', () => {
  it('lists rows as printed, counts the verified ones, and marks unverified rows', async () => {
    render(<ReportDetails api={api()} encounterId="e1" />);
    expect(await screen.findByText('haemoglobin')).toBeInTheDocument(); expect(screen.getByText('1 of 2 verified')).toBeInTheDocument();
    expect(screen.getByText('12.0 - 15.5')).toBeInTheDocument(); expect(screen.getByText('low')).toBeInTheDocument(); expect(screen.getByText('Verified')).toBeInTheDocument(); expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByText(/Not interpreted/)).toBeInTheDocument();
  });
  it('says plainly when nothing has been read, and ignores files that were not accepted or failed to read', async () => {
    const a = api({ documents: vi.fn().mockResolvedValue([doc({ status: 'pending' as never }), doc({ id: 'd2' })]), extraction: vi.fn().mockResolvedValue(ex([], { status: 'failed' })) });
    render(<ReportDetails api={a} encounterId="e1" />);
    expect(await screen.findByText(/No report has been read yet/)).toBeInTheDocument();
  });
  it('shows a load error', async () => {
    render(<ReportDetails api={api({ documents: vi.fn().mockRejectedValue(new Error('Could not load.')) })} encounterId="e1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load.');
  });
  it('shows the second-reader note and names the file when there are several reports', async () => {
    const a = api({ documents: vi.fn().mockResolvedValue([doc(), doc({ id: 'd2', filename: 'lft.pdf' })]), extraction: vi.fn().mockResolvedValue(ex([field({ agreement: 'differ', secondRead: '19' })])) });
    render(<ReportDetails api={a} encounterId="e1" />);
    expect((await screen.findAllByText('Readers differ')).length).toBe(2); expect(screen.getByText(/lft\.pdf/)).toBeInTheDocument();
  });
});

const summary = (o: Partial<EncounterSummary> = {}): EncounterSummary => ({
  encounter: { id: 'e1', patient_id: 'p', facility_id: 'f', status: 'in_review', scenario: 'opd_queue', language: 'en', chief_complaint_original: 'Fever and cough', chief_complaint_translated: null, submitted_at: '2026-10-06T09:30:00Z', closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:00:00Z' },
  patient: {} as never, vitals: [{ id: 'v1', encounter_id: 'e1', kind: 'temperature_c', value: 38.6, unit: 'Cel', measured_at: '2026-10-06T09:10:00Z' } as never], triageContext: {}, assessment: null, followUps: [], queue: null, consentActive: true, reviews: [],
  symptoms: [
    { id: 's2', text_original: 'Cough', text_translated: null, lang: 'en', duration_value: 2, duration_unit: 'days', severity: 4, created_at: '2026-10-06T09:05:00Z' },
    { id: 's1', text_original: 'Fever', text_translated: null, lang: 'en', duration_value: 3, duration_unit: 'days', severity: 6, created_at: '2026-10-06T09:04:00Z' },
  ], ...o,
});

describe('timeline summary', () => {
  it('puts the longest-standing symptom first and gives the complaint, measurements and a draft notice', () => {
    const l = buildCaseSummary(summary()); const by = Object.fromEntries(l.map(x => [x.label, x.text]));
    expect(by['Main complaint']).toBe('Fever and cough'); expect(by['Symptoms, longest first']).toBe('Fever, 3 days, severity 6/10; Cough, 2 days, severity 4/10'); expect(by['Latest measurements']).toContain('38.6');
    expect(by['Review']).toBeUndefined();
  });
  it('after assessment it says not reviewed yet, then names the reviewer and any change', () => {
    const a = { id: 'a1', version: 1, created_at: '2026-10-06T09:40:00Z', urgency_code: 'orange' as const, note: { tier: 2, winning: { layer: 'floor', ruleId: 'R', tier: 2, detail: 'Fits in a rule' } } as never, signals: [] };
    expect(buildCaseSummary(summary({ assessment: a })).find(x => x.label === 'Review')!.text).toMatch(/Not reviewed yet/);
    const withReview = buildCaseSummary(summary({ assessment: a, reviews: [{ id: 'r1', action: 'override_urgency', assessment_id: 'a1', reviewer_id: 'u', reviewer_name: 'Dr Das', from_urgency_code: 'orange', to_urgency_code: 'red', reason: 'Looks worse', created_at: '2026-10-06T09:50:00Z' } as never] }));
    expect(withReview.find(x => x.label === 'Review')!.text).toMatch(/Dr Das changed the priority to immediate: Looks worse/); expect(withReview.find(x => x.label === 'Rules result')!.text).toContain('Very urgent');
  });
  it('counts open questions with the right plural', () => {
    expect(buildCaseSummary(summary({ followUps: [{ field_code: 'a', question_text: 'q', status: 'open', answer_text: null }] })).find(x => x.label === 'Still open')!.text).toBe('1 question to answer');
    expect(buildCaseSummary(summary({ followUps: [1, 2].map(i => ({ field_code: 'a' + i, question_text: 'q', status: 'open', answer_text: null })) })).find(x => x.label === 'Still open')!.text).toBe('2 questions to answer');
  });
  it('the section renders and says it is built from recorded facts', () => {
    render(<CaseSummary summary={summary()} />); expect(screen.getByText('Timeline summary')).toBeInTheDocument(); expect(screen.getByText(/Nothing is inferred/)).toBeInTheDocument();
  });
});
