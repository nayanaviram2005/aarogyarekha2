import { describe, expect, it } from 'vitest';
import { applyIdentity } from './recordsIntake';

const blank = { fullName: '', sex: 'unknown' as const, age: '', birthDate: '', phone: '' };
describe('filling the form from the records', () => {
  it('fills only what is empty and never overwrites what staff typed', () => {
    expect(applyIdentity({ ...blank, fullName: 'Typed Name' }, { fullName: 'Read Name', ageYears: 27, sex: 'female', phone: '9876543210' })).toMatchObject({ fullName: 'Typed Name', age: '27', sex: 'female', phone: '9876543210' });
  });
  it('prefers a birth date over an age and does not set both', () => {
    const d = applyIdentity(blank, { birthDate: '1971-03-12', ageYears: 54 }); expect(d.birthDate).toBe('1971-03-12'); expect(d.age).toBe('');
  });
  it('a later record never replaces a detail an earlier one already gave', () => {
    const a = applyIdentity(blank, { fullName: 'First' }); expect(applyIdentity(a, { fullName: 'Second', ageYears: 30 })).toMatchObject({ fullName: 'First', age: '30' });
  });
  it('whole years only', () => { expect(applyIdentity(blank, { ageYears: 0.67 }).age).toBe('0'); });
});
