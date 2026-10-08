import type { Api, InputsPatch } from './types';

/**
 * Answers to follow-up questions are collected on screen first and saved together when the reviewer presses Submit. Nothing is sent
 * while answering, so the reviewer can change their mind and the questions do not jump around under their hands.
 */
export type Draft =
  | { kind: 'bool'; value: boolean }
  | { kind: 'level'; value: string }
  | { kind: 'nums'; value: Record<string, string> };

export const VITAL_FIELDS: Record<string, { kinds: { kind: string; label: string; unit: string }[] }> = {
  'vital.resp_rate_pm': { kinds: [{ kind: 'resp_rate_pm', label: 'Breaths per minute', unit: '/min' }] },
  'vital.spo2_pct': { kinds: [{ kind: 'spo2_pct', label: 'SpO2', unit: '%' }] },
  'vital.pulse_bpm': { kinds: [{ kind: 'pulse_bpm', label: 'Beats per minute', unit: '/min' }] },
  'vital.temperature_c': { kinds: [{ kind: 'temperature_c', label: 'Temperature', unit: '°C' }] },
  'vital.bp_systolic_mmhg': { kinds: [{ kind: 'bp_systolic_mmhg', label: 'Systolic', unit: 'mmHg' }, { kind: 'bp_diastolic_mmhg', label: 'Diastolic', unit: 'mmHg' }] },
  'vital.bp_pregnancy': { kinds: [{ kind: 'bp_systolic_mmhg', label: 'Systolic', unit: 'mmHg' }, { kind: 'bp_diastolic_mmhg', label: 'Diastolic', unit: 'mmHg' }] },
};

const isNumber = (s: string | undefined) => (s ?? '').trim() !== '' && Number.isFinite(Number(s));

/** A draft counts only when it is complete: a yes/no or a level was chosen, or every number of a measurement was typed. */
export function draftReady(fieldCode: string, d: Draft | undefined): boolean {
  if (!d) return false;
  if (d.kind === 'bool' || d.kind === 'level') return true;
  const fields = VITAL_FIELDS[fieldCode]?.kinds; if (!fields) return false;
  return fields.every(f => isNumber(d.value[f.kind]));
}

export interface Submission { inputs: InputsPatch; vitals: { kind: string; value: number }[]; count: number }

export function buildSubmission(drafts: Record<string, Draft>): Submission {
  const inputs: InputsPatch = {}; const vitals: Submission['vitals'] = []; let count = 0;
  for (const [code, d] of Object.entries(drafts)) {
    if (!draftReady(code, d)) continue;
    count++;
    if (code.startsWith('sign.') && d.kind === 'bool') inputs.signs = { ...(inputs.signs ?? {}), [code.slice(5)]: d.value };
    else if (code === 'vital.oxygen' && d.kind === 'bool') inputs.onSupplementalOxygen = d.value;
    else if (code === 'context.pregnancy_status' && d.kind === 'bool') inputs.pregnant = d.value;
    else if (code === 'vital.consciousness' && d.kind === 'level') inputs.consciousness = d.value as InputsPatch['consciousness'];
    else if (d.kind === 'nums') for (const f of VITAL_FIELDS[code]?.kinds ?? []) vitals.push({ kind: f.kind, value: Number(d.value[f.kind]) });
  }
  return { inputs, vitals, count };
}

/** Saves everything at once: one call for the yes/no and level answers, then each measurement. Throws on the first failure. */
export async function submitDrafts(api: Api, encounterId: string, drafts: Record<string, Draft>): Promise<number> {
  const s = buildSubmission(drafts);
  if (Object.keys(s.inputs).length > 0) await api.saveInputs(encounterId, s.inputs);
  for (const v of s.vitals) await api.addVital(encounterId, v);
  return s.count;
}
