import { describe, expect, it } from 'vitest';
import { parseIdentity } from '../src/ocr/identity.js';

const cases: [string, string, object][] = [
  ['simple', 'CITY LAB\nPatient Name: Mrs. Asha Rao   Age: 27 Y   Sex: F\nMobile: 98765 43210', { fullName: 'Asha Rao', ageYears: 27, sex: 'female', phone: '9876543210' }],
  ['age/sex slash', 'Name : RAVI DAS\nAge/Sex : 54 Y / M\nDOB: 12/03/1971', { fullName: 'RAVI DAS', ageYears: 54, sex: 'male', birthDate: '1971-03-12' }],
  ['lab header with doctor and lab name', 'SRL DIAGNOSTICS\nRef. By: Dr. Mehta\nName: MR. SURESH KUMAR PATRA\nAge / Gender: 45 Years / Male\nSample Collected: 12/10/2026', { fullName: 'SURESH KUMAR PATRA', ageYears: 45, sex: 'male' }],
  ['bracket style', 'Patient: ANITA SAHU (F/32Y)\nReg No 8841', { fullName: 'ANITA SAHU', ageYears: 32, sex: 'female' }],
  ['years first', 'Name: Lipika Nayak    27 Years / Female    UHID: 22331', { fullName: 'Lipika Nayak', ageYears: 27, sex: 'female' }],
  ['infant', 'Patient: Baby Meera\nAge: 8 months  Gender: Female', { fullName: 'Meera', ageYears: 0.67, sex: 'female' }],
  ['pipes', 'Patient Name: PRIYA MOHANTY | Age: 29 | Sex: Female', { fullName: 'PRIYA MOHANTY', ageYears: 29, sex: 'female' }],
  ['name mid-line before another column', 'SOME LABS Name : Mrs. Rekha Jena Collected On : 12/10/2026 09:15 AM\nAge/Gender : 27 Yrs 5 Mon 2 Days /Female Referred By : Dr. Das', { fullName: 'Rekha Jena', ageYears: 27, sex: 'female' }],
  ['age in months and days only', 'Patient Name : Baby Riya   Collected : 01/10/2026\nAge/Gender : 8 Months 3 Days / Female', { fullName: 'Riya', ageYears: 0.67, sex: 'female' }],
  ['name beside doctor line', 'Referred By: Dr. Sahoo\nPatient Name : Gopal Behera\nAge : 61 Y', { fullName: 'Gopal Behera', ageYears: 61 }],
];
describe('who a report is about', () => {
  for (const [label, text, want] of cases) it(label, () => expect(parseIdentity(text)).toMatchObject(want));
  it('the hospital or lab name is never taken as the patient', () => {
    expect(parseIdentity('Hospital Name: City General Hospital\nLab Name: Apollo Diagnostics').fullName).toBeUndefined();
    expect(parseIdentity('Doctor Name: Dr. Rao\nPatient Name: Asha Rao').fullName).toBe('Asha Rao');
  });
  it('finds nothing in text that is not about a person, and never invents a date or a number', () => {
    expect(parseIdentity('Haemoglobin 9.1 g/dL 12.0 - 15.5 L')).toEqual({});
    expect(parseIdentity('DOB: 31/02/1990').birthDate).toBeUndefined();
    expect(parseIdentity('DOB: 01/01/2999').birthDate).toBeUndefined();
    expect(parseIdentity('Phone: 12345').phone).toBeUndefined();
    expect(parseIdentity('Age: 340').ageYears).toBeUndefined();
  });
});
