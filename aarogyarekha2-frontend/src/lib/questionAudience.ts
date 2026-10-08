/**
 * Who should ask which follow-up question. A health worker can ask what they can see or hear; a few questions need a nurse or doctor
 * to look. This only changes ORDER and a label on this screen. Every question still counts the same, and a health worker can still
 * answer any of them.
 */
export const NEEDS_CLINICIAN = new Set([
  'sign.shock_signs', 'sign.severe_fluid_loss_signs', 'sign.central_cyanosis', 'sign.severe_pallor', 'sign.severe_visible_wasting', 'sign.very_high_fever_child',
  'sign.severe_respiratory_distress', 'sign.stiff_neck_with_fever', 'vital.consciousness',
]);

export type Audience = 'health_worker' | 'clinician';
export const audienceOf = (role: string | null | undefined): Audience => (role === 'health_worker' || !role ? 'health_worker' : 'clinician');

export interface QItem { fieldCode: string | null; potentialTier: number | null; i: number }

/** Clinicians: as ranked (most urgent potential first). Health workers: the same ranking, but questions they can ask by looking or asking come before ones that need a clinician. */
export function orderForAudience<T extends QItem>(items: T[], audience: Audience): T[] {
  const base = [...items].sort((x, y) => (x.potentialTier ?? 9) - (y.potentialTier ?? 9) || x.i - y.i);
  if (audience === 'clinician') return base;
  const needs = (x: T) => (x.fieldCode && NEEDS_CLINICIAN.has(x.fieldCode) ? 1 : 0);
  return base.sort((x, y) => needs(x) - needs(y) || (x.potentialTier ?? 9) - (y.potentialTier ?? 9) || x.i - y.i);
}

export const needsClinician = (fieldCode: string | null) => !!fieldCode && NEEDS_CLINICIAN.has(fieldCode);
