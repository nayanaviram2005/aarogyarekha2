import { describe, expect, it } from 'vitest';
import { buildTimeline } from './timeline';
import type { EncounterSummary } from './types';

const base = (over: Partial<EncounterSummary> = {}): EncounterSummary => ({
  encounter: { id: 'e', patient_id: 'p', facility_id: 'f', status: 'in_review', scenario: 'opd_queue', language: 'hi', chief_complaint_original: 'bukhar', chief_complaint_translated: null, submitted_at: '2026-10-06T09:30:00Z', closed_at: null, created_at: '2026-10-06T09:00:00Z', updated_at: '2026-10-06T09:30:00Z' },
  patient: {} as never, symptoms: [], vitals: [], triageContext: {}, assessment: null, followUps: [], queue: null, reviews: [], consentActive: true, ...over,
} as EncounterSummary);

describe('buildTimeline', () => {
  it('starts with the encounter and the complaint in the original language', () => {
    const t = buildTimeline(base());
    expect(t[0]).toMatchObject({ kind: 'record', text: 'Encounter opened' });
    expect(t[1]).toMatchObject({ kind: 'reported', text: 'Main complaint: bukhar', lang: 'hi' });
  });
  it('puts every recorded fact in time order whatever order the lists came in', () => {
    const t = buildTimeline(base({
      symptoms: [{ id: 's', text_original: 'cough', text_translated: null, lang: 'en', duration_value: 3, duration_unit: 'days', severity: 6, created_at: '2026-10-06T09:20:00Z' }],
      vitals: [{ id: 'v', encounter_id: 'e', kind: 'temperature_c', value: 38.6, unit: 'Cel', measured_at: '2026-10-06T09:10:00Z' }],
    }));
    expect(t.map(e => e.at)).toEqual([...t.map(e => e.at)].sort());
    expect(t.map(e => e.text)).toEqual(expect.arrayContaining(['Symptom: cough, for 3 days, severity 6 of 10', expect.stringMatching(/38\.6/)]));
    expect(t.findIndex(e => e.kind === 'measured')).toBeLessThan(t.findIndex(e => e.text.startsWith('Symptom')));
  });
  it('says "1 day", not "1 days"', () => {
    const t = buildTimeline(base({ symptoms: [{ id: 's', text_original: 'rash', text_translated: null, lang: null, duration_value: 1, duration_unit: 'days', severity: null, created_at: '2026-10-06T09:05:00Z' }] }));
    expect(t.find(e => e.text.startsWith('Symptom'))!.text).toBe('Symptom: rash, for 1 day');
  });
  it('records the rules result and each reviewer decision with names and reasons, never inventing any', () => {
    const t = buildTimeline(base({
      assessment: { id: 'a', version: 2, created_at: '2026-10-06T09:40:00Z', urgency_code: 'orange', note: {} as never, signals: [] } as never,
      reviews: [
        { id: 'r1', action: 'override_urgency', assessment_id: 'a', reviewer_id: 'u', reviewer_name: 'Dr. Das', from_urgency_code: 'orange', to_urgency_code: 'red', reason: 'looks worse', created_at: '2026-10-06T09:50:00Z' },
        { id: 'r2', action: 'approve', assessment_id: 'a', reviewer_id: 'u', reviewer_name: null, from_urgency_code: null, to_urgency_code: null, reason: null, created_at: '2026-10-06T09:55:00Z' },
      ] as never,
    }));
    const texts = t.map(e => e.text);
    expect(texts).toContain('Rules assessment, version 2: Very urgent (priority 2)');
    expect(texts).toContain('Dr. Das changed priority from Very urgent (priority 2) to Immediate (priority 1). Reason: looks worse');
    expect(texts).toContain('A reviewer approved the rules result');
  });
  it('adds submitted and closed moments only when they happened', () => {
    expect(buildTimeline(base()).map(e => e.text)).toContain('Submitted for review');
    expect(buildTimeline(base()).map(e => e.text)).not.toContain('Encounter closed');
    const closed = base(); closed.encounter.closed_at = '2026-10-06T11:00:00Z';
    expect(buildTimeline(closed).at(-1)).toMatchObject({ text: 'Encounter closed' });
  });
  it('skips rows with a missing or broken time instead of crashing', () => {
    const t = buildTimeline(base({ vitals: [{ id: 'v', encounter_id: 'e', kind: 'pulse_bpm', value: 80, unit: '/min', measured_at: 'not a date' }] }));
    expect(t.some(e => e.kind === 'measured')).toBe(false);
  });
  it('keeps the order of items recorded at the very same moment', () => {
    const t = buildTimeline(base({ symptoms: ['a', 'b', 'c'].map(x => ({ id: x, text_original: x, text_translated: null, lang: null, duration_value: null, duration_unit: null, severity: null, created_at: '2026-10-06T09:05:00Z' })) }));
    expect(t.filter(e => e.text.startsWith('Symptom')).map(e => e.text)).toEqual(['Symptom: a', 'Symptom: b', 'Symptom: c']);
  });
});
