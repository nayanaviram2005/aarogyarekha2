import { describe, expect, it } from 'vitest';
import type { PatientBrief } from '../src/deps.js';
import { normName, possibleDuplicates } from '../src/intake/duplicates.js';

const NOW = new Date('2026-10-07T00:00:00Z');
const p = (over: Partial<PatientBrief> = {}): PatientBrief => ({ id: 'x', public_ref: 'AR-1', full_name: 'Anita Rao', sex: 'female', birth_date: null, age_years_reported: 30, preferred_language: 'hi', ...over });

describe('normName', () => {
  it('ignores case, dots, hyphens and extra spaces', () => {
    expect(normName('  A.  RAO-Kumar ')).toBe('a rao kumar'); expect(normName('Anita   Rao')).toBe('anita rao');
  });
  it('keeps Hindi and Odia names intact', () => {
    expect(normName('अनीता राव')).toBe('अनीता राव'); expect(normName('ଅନୀତା ରାଓ')).toBe('ଅନୀତା ରାଓ');
  });
});

describe('possibleDuplicates', () => {
  it('same name and same date of birth is a duplicate; a different date of birth is not', () => {
    const e = [p({ birth_date: '1996-03-02', age_years_reported: null })];
    expect(possibleDuplicates(e, { fullName: 'anita rao', sex: 'female', birthDate: '1996-03-02' }, NOW)).toHaveLength(1);
    expect(possibleDuplicates(e, { fullName: 'Anita Rao', sex: 'female', birthDate: '1990-01-01' }, NOW)).toHaveLength(0);
  });
  it('without dates, ages one year apart still match (people round differently); five years apart do not', () => {
    expect(possibleDuplicates([p({ age_years_reported: 30 })], { fullName: 'Anita Rao', sex: 'female', ageYears: 31 }, NOW)).toHaveLength(1);
    expect(possibleDuplicates([p({ age_years_reported: 30 })], { fullName: 'Anita Rao', sex: 'female', ageYears: 35 }, NOW)).toHaveLength(0);
  });
  it('works out age from a stored birth date when the new person only has an age', () => {
    expect(possibleDuplicates([p({ birth_date: '1996-03-02', age_years_reported: null })], { fullName: 'Anita Rao', sex: 'female', ageYears: 30 }, NOW)).toHaveLength(1);
  });
  it('a different name is never a duplicate; a different known sex is not; unknown sex still matches', () => {
    expect(possibleDuplicates([p()], { fullName: 'Anita Rani', sex: 'female', ageYears: 30 }, NOW)).toHaveLength(0);
    expect(possibleDuplicates([p()], { fullName: 'Anita Rao', sex: 'male', ageYears: 30 }, NOW)).toHaveLength(0);
    expect(possibleDuplicates([p()], { fullName: 'Anita Rao', sex: 'unknown', ageYears: 30 }, NOW)).toHaveLength(1);
  });
  it('when there is not enough to tell people apart it asks rather than assuming they differ', () => {
    expect(possibleDuplicates([p({ age_years_reported: null })], { fullName: 'Anita Rao', sex: 'female' }, NOW)).toHaveLength(1);
  });
  it('returns all the matches', () => {
    expect(possibleDuplicates([p({ id: 'a' }), p({ id: 'b', age_years_reported: 29 }), p({ id: 'c', full_name: 'Someone Else' })], { fullName: 'Anita Rao', sex: 'female', ageYears: 30 }, NOW).map(x => x.id)).toEqual(['a', 'b']);
  });
});
