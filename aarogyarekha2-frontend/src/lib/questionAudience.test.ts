import { describe, expect, it } from 'vitest';
import { QUESTION_LANGS, questionCodes, questionIn } from '../i18n/questions';
import { audienceOf, needsClinician, orderForAudience, NEEDS_CLINICIAN } from './questionAudience';

const q = (code: string, p: number | null, i: number) => ({ fieldCode: code, potentialTier: p, i });
const codes = (xs: { fieldCode: string | null }[]) => xs.map(x => x.fieldCode);

describe('orderForAudience', () => {
  const items = [q('sign.shock_signs', 1, 0), q('sign.lethargic', 2, 1), q('sign.vomits_everything', 2, 2), q('vital.pulse_bpm', null, 3), q('sign.central_cyanosis', 1, 4)];
  it('clinicians get the plain ranking: most urgent potential first, then as listed', () => {
    expect(codes(orderForAudience(items, 'clinician'))).toEqual(['sign.shock_signs', 'sign.central_cyanosis', 'sign.lethargic', 'sign.vomits_everything', 'vital.pulse_bpm']);
  });
  it('health workers get what they can ask first, then the ones that need a clinician, each group still ranked', () => {
    expect(codes(orderForAudience(items, 'health_worker'))).toEqual(['sign.lethargic', 'sign.vomits_everything', 'vital.pulse_bpm', 'sign.shock_signs', 'sign.central_cyanosis']);
  });
  it('never drops or duplicates a question, and does not change the input', () => {
    const copy = [...items]; for (const a of ['clinician', 'health_worker'] as const) expect(orderForAudience(items, a)).toHaveLength(items.length); expect(items).toEqual(copy);
  });
  it('a question with no code counts as askable by anyone', () => { expect(codes(orderForAudience([q('sign.shock_signs', 1, 0), { fieldCode: null, potentialTier: 3, i: 1 }], 'health_worker'))).toEqual([null, 'sign.shock_signs']); });
});

describe('roles', () => {
  it('health workers and unknown roles are the health-worker audience; nurses, doctors and officers are clinicians', () => {
    expect(audienceOf('health_worker')).toBe('health_worker'); expect(audienceOf(undefined)).toBe('health_worker'); expect(audienceOf(null)).toBe('health_worker');
    for (const r of ['nurse', 'doctor', 'medical_officer', 'facility_admin']) expect(audienceOf(r)).toBe('clinician');
  });
  it('needsClinician matches the list', () => { for (const c of NEEDS_CLINICIAN) expect(needsClinician(c)).toBe(true); expect(needsClinician('sign.lethargic')).toBe(false); expect(needsClinician(null)).toBe(false); });
});

describe('question translations', () => {
  it('every rule sign question has Hindi and Odia text, each in its own script', () => {
    for (const c of questionCodes()) { expect(questionIn(c, 'hi'), c).toMatch(/[\u0900-\u097F]/); expect(questionIn(c, 'or'), c).toMatch(/[\u0B00-\u0B7F]/); }
  });
  it('English asks for nothing (the original is shown anyway); unknown codes give nothing', () => { expect(questionIn('sign.lethargic', 'en')).toBeNull(); expect(questionIn('sign.unknown', 'hi')).toBeNull(); });
  it('no Bengali or other look-alike script slipped into the Odia text', () => { for (const c of questionCodes()) expect(questionIn(c, 'or'), c).not.toMatch(/[\u0980-\u09FF\u0900-\u097F]/); });
  it('offers the three languages', () => { expect(QUESTION_LANGS.map(l => l.code)).toEqual(['en', 'hi', 'or']); });
});
