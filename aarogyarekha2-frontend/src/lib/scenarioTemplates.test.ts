import { describe, expect, it } from 'vitest';
import { hasTemplate, noteFor, scenarioChecklist, TEMPLATES } from './scenarioTemplates';
import type { EncounterSummary } from './types';

const s = (symptoms: string[], vitalKinds: string[] = []): EncounterSummary => ({ symptoms: symptoms.map((t, i) => ({ id: String(i), text_original: t, text_translated: null, lang: null, duration_value: null, duration_unit: null, severity: null, created_at: '' })), vitals: vitalKinds.map((k, i) => ({ id: String(i), encounter_id: 'e', kind: k, value: 1, unit: 'u', measured_at: '' })) } as unknown as EncounterSummary);

describe('templates', () => {
  it('there is one for each field-based scenario and none for plain outpatient or camp', () => {
    for (const k of ['campus_fever', 'occupational', 'maternal_followup', 'chronic_checkin']) expect(hasTemplate(k)).toBe(true);
    expect(hasTemplate('opd_queue')).toBe(false); expect(hasTemplate('health_camp')).toBe(false);
  });
  it('field keys and labels are unique within a scenario (the label is how an answer is found again)', () => {
    for (const [k, t] of Object.entries(TEMPLATES)) { expect(new Set(t.fields.map(f => f.key)).size, k).toBe(t.fields.length); expect(new Set(t.fields.map(f => f.label.toLowerCase())).size, k).toBe(t.fields.length); }
  });
  it('no field contains a colon, which would break matching "Label: answer"', () => { for (const t of Object.values(TEMPLATES)) for (const f of t.fields) expect(f.label).not.toContain(':'); });
  it('never asks for or hints at a diagnosis', () => { for (const t of Object.values(TEMPLATES)) for (const f of t.fields) expect(`${f.label} ${f.hint ?? ''}`).not.toMatch(/diagnos|disease name|treatment|dose/i); });
});

describe('scenarioChecklist', () => {
  it('nothing for a scenario with no template', () => { expect(scenarioChecklist('opd_queue', s([]))).toEqual([]); });
  it('marks notes recorded when they start with the label, in any letter case; others stay open', () => {
    const rows = scenarioChecklist('occupational', s(['workplace and the work done there: stone crusher', 'Exposure at work: dust']));
    expect(rows.filter(r => r.done).map(r => r.key)).toEqual(['workplace', 'exposure']); expect(rows.filter(r => !r.done).map(r => r.key)).toEqual(['ppe', 'shift']);
  });
  it('a vital group is done only when ALL its measurements exist', () => {
    const half = scenarioChecklist('maternal_followup', s([], ['bp_systolic_mmhg'])).find(r => r.label === 'Blood pressure')!; expect(half.done).toBe(false);
    const full = scenarioChecklist('maternal_followup', s([], ['bp_systolic_mmhg', 'bp_diastolic_mmhg'])).find(r => r.label === 'Blood pressure')!; expect(full.done).toBe(true);
  });
  it('a note that merely mentions a label elsewhere does not count', () => { expect(scenarioChecklist('campus_fever', s(['no travel or visitors in the last 2 weeks'])).find(r => r.key === 'travel')!.done).toBe(false); });
  it('noteFor writes "Label: answer" and trims', () => { expect(noteFor(TEMPLATES.occupational!.fields[0]!, '  stone crusher ')).toBe('Workplace and the work done there: stone crusher'); });
});
