import type { EncounterSummary } from './types';

export interface TemplateField { key: string; label: string; hint?: string; options?: string[] }
export interface ChecklistItem { key: string; label: string; source: 'note' | 'vital' }

export const TEMPLATES: Record<string, { fields: TemplateField[]; vitals: { kinds: string[]; label: string }[] }> = {
  campus_fever: {
    fields: [
      { key: 'place', label: 'Hostel or department', hint: 'Where the person stays or studies' },
      { key: 'contacts', label: 'Others unwell with fever in the same place', options: ['None known', 'One or two', 'Several'] },
      { key: 'travel', label: 'Travel or visitors in the last 2 weeks', options: ['No', 'Yes'] },
    ],
    vitals: [{ kinds: ['temperature_c'], label: 'Temperature' }],
  },
  occupational: {
    fields: [
      { key: 'workplace', label: 'Workplace and the work done there' },
      { key: 'exposure', label: 'Exposure at work', hint: 'For example heat, dust, chemicals, noise, injury, long hours' },
      { key: 'ppe', label: 'Protective equipment used', options: ['Yes', 'No', 'Partly'] },
      { key: 'shift', label: 'Shift or hours worked today' },
    ],
    vitals: [],
  },
  maternal_followup: {
    fields: [
      { key: 'weeks', label: 'Weeks of pregnancy' },
      { key: 'anc', label: 'Antenatal visit number' },
    ],
    vitals: [{ kinds: ['bp_systolic_mmhg', 'bp_diastolic_mmhg'], label: 'Blood pressure' }, { kinds: ['weight_kg'], label: 'Weight' }],
  },
  chronic_checkin: {
    fields: [
      { key: 'conditions', label: 'Long-term conditions known' },
      { key: 'adherence', label: 'Taking medicines as prescribed', options: ['Yes', 'Sometimes', 'No'] },
      { key: 'missed', label: 'Times medicine was missed in the last week' },
    ],
    vitals: [{ kinds: ['bp_systolic_mmhg', 'bp_diastolic_mmhg'], label: 'Blood pressure' }, { kinds: ['blood_glucose_mgdl'], label: 'Blood sugar' }],
  },
};

const noteText = (s: EncounterSummary) => s.symptoms.map(x => x.text_original.toLowerCase());
export const noteFor = (f: TemplateField, answer: string) => `${f.label}: ${answer.trim()}`;

export interface ChecklistRow { key: string; label: string; source: 'note' | 'vital'; done: boolean; field?: TemplateField }

export function scenarioChecklist(scenario: string, s: EncounterSummary): ChecklistRow[] {
  const t = TEMPLATES[scenario]; if (!t) return [];
  const notes = noteText(s); const kinds = new Set(s.vitals.map(v => v.kind));
  return [
    ...t.fields.map((f): ChecklistRow => ({ key: f.key, label: f.label, source: 'note', done: notes.some(n => n.startsWith(f.label.toLowerCase() + ':')), field: f })),
    ...t.vitals.map((v): ChecklistRow => ({ key: v.kinds.join('+'), label: v.label, source: 'vital', done: v.kinds.every(k => kinds.has(k)) })),
  ];
}

export const hasTemplate = (scenario: string) => !!TEMPLATES[scenario];
