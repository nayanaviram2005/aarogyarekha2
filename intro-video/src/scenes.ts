// Timing and copy for the whole intro. Edit here; the scene code does not change. All patients are invented.
import type { Tier } from './tokens';

export const SCENES = [
  { id: 'problem', seconds: 4, caption: 'Forty people are waiting. Who should be seen first?' },
  { id: 'records', seconds: 7, caption: 'Scans patient records efficiently.' },
  { id: 'rules', seconds: 6, caption: 'Transparent, rule-based triage.' },
  { id: 'queue', seconds: 6, caption: 'Doesn’t ignore missing details.' },
  { id: 'decision', seconds: 5, caption: 'A nurse or doctor signs off every decision.' },
  { id: 'close', seconds: 3, caption: 'AarogyaRekha: From a crowded queue to a clear order.', note: 'Prototype. Not for use with real patients.' },
] as const;

export const TOTAL_SECONDS = SCENES.reduce((n, s) => n + s.seconds, 0);

export interface Patient { ref: string; who: string; complaint: string; tier: Tier }

/** In order of arrival. */
export const PATIENTS: Patient[] = [
  { ref: '0409', who: '31 y, female', complaint: 'Cough and sore throat for four days', tier: 3 },
  { ref: '0411', who: '44 y, male', complaint: 'Routine blood pressure check', tier: 4 },
  { ref: '0415', who: '3 y, female', complaint: 'Fever for two days, drinking poorly', tier: 2 },
  { ref: '0412', who: '58 y, male', complaint: 'Chest pain with sweating, started this morning', tier: 1 },
];

export const RECORD = {
  title: 'Complete blood count',
  form: { name: 'Asha Rao', age: '27', sex: 'Female' },
  rows: [
    { test: 'Haemoglobin', value: '9.1 g/dL', flag: 'printed LOW' },
    { test: 'WBC count', value: '11,200 /cumm', flag: 'printed HIGH' },
    { test: 'Platelets', value: '2.4 lakh/cumm', flag: '' },
  ],
  agree: 'Two readers agree',
} as const;

export const RULES = {
  question: 'Chest pain with sweating?',
  reason: 'Danger-sign rule: chest pain with sweating',
  patient: 'Patient 0412 · 58 y, male',
} as const;

export const DECISION = {
  rulesSet: 'The rules set Immediate.',
  confirm: 'Confirm priority',
  signed: 'Signed off',
  by: 'Doctor · 10:42',
  languages: ['English', 'हिन्दी', 'ଓଡ଼ିଆ'],
  languageNote: 'The patient is told in their language.',
} as const;
