import { describe, expect, it } from 'vitest';
import { assertClean, nameVariants, PiiLeak, redact, restore } from '../src/ai/redact.js';

describe('names we hold are removed, in any script', () => {
  const known = { names: ['Anita Rao', 'ସୁଧାଂଶୁ ମହାପାତ୍ର', 'राम कुमार'] };
  it('full name and each part, case-insensitively, longest first', () => {
    const r = redact('My name is anita rao. ANITA has fever. Rao family lives here.', known);
    expect(r.text).not.toMatch(/anita|rao/i);
    expect(r.counts.name).toBeGreaterThanOrEqual(3);
  });
  it('Odia and Devanagari names', () => {
    expect(redact('ରୋଗୀ ସୁଧାଂଶୁ ମହାପାତ୍ରଙ୍କୁ ଜ୍ୱର', known).text).not.toContain('ସୁଧାଂଶୁ ମହାପାତ୍ର');
    expect(redact('मरीज़ राम कुमार को बुखार है', known).text).not.toContain('राम');
  });
  it('does not damage longer words that merely contain a name', () => {
    expect(redact('Ramesh and Ramanujan', { names: ['Ram'] }).text).toBe('Ramesh and Ramanujan');
  });
  it('can put the names back after a round trip, when the placeholders survive', () => {
    const r = redact('Anita Rao has cough', known);
    expect(r.text).toMatch(/\[\[NAME_\d+\]\]/);
    expect(restore(r.text, r.names)).toBe('Anita Rao has cough');
  });
  it('known identifiers (MRN, ABHA) are removed wherever they appear', () => {
    expect(redact('Record SEED-MRN-A-001 and 91-1234-5678-9012', { identifiers: ['SEED-MRN-A-001'] }).text).toBe('Record [ID] and [ID]');
  });
  it('nameVariants ignores empty and single-letter parts', () => { expect(nameVariants(['A B Rao', '', null, undefined])).toEqual(['A B Rao', 'Rao']); });
});

describe('shapes we recognise even when we do not know the value', () => {
  it.each([
    ['call me on 9876543210', '[PHONE]'], ['phone +91 98765 43210', '[PHONE]'], ['whatsapp 98765-43210', '[PHONE]'], ['mail a.b@example.co.in now', '[EMAIL]'],
    ['aadhaar 1234 5678 9012', '[ID]'], ['ABHA 91-1234-5678-9012', '[ID]'], ['pin 752001', '[PIN]'], ['born 12/03/1994', '[DATE]'], ['on 2026-10-06', '[DATE]'],
    ['seen on 6 Oct 2026', '[DATE]'], ['see https://x.example/a?b=1', '[URL]'], ['saw Dr. Mehta yesterday', '[PERSON]'], ['Mrs Devi Kumari came', '[PERSON]'], ['Smt. Lakshmi', '[PERSON]'],
  ])('%s', (input, token) => { expect(redact(input).text).toContain(token); });
  it('leaves ordinary clinical text alone', () => {
    const t = 'Fever for 3 days, cough, temperature 38.6 C, pulse 104 per minute, no vomiting.';
    expect(redact(t).text).toBe(t);
  });
  it('does not treat a short lab value as a phone number or pin', () => { expect(redact('Haemoglobin 9.1 g/dL, WBC 11200, glucose 98').text).toBe('Haemoglobin 9.1 g/dL, WBC 11200, glucose 98'); });
  it('counts what it removed, without keeping the values', () => {
    const r = redact('Call 9876543210 or a@b.com');
    expect(r.counts).toMatchObject({ phone: 1, email: 1 });
    expect(JSON.stringify(r.counts)).not.toContain('9876');
  });
});

describe('assertClean: the last gate', () => {
  const known = { names: ['Anita Rao'], identifiers: ['AR-0001'] };
  it('passes text that has been redacted', () => {
    const r = redact('Anita Rao, 9876543210, AR-0001, Dr. Mehta, 752001, born 12/03/1994: fever', known);
    expect(() => assertClean(r.text, known)).not.toThrow();
  });
  it('blocks a known name, a known identifier and each recognised pattern', () => {
    expect(() => assertClean('Anita has fever', known)).toThrow(PiiLeak);
    expect(() => assertClean('record AR-0001', known)).toThrow(PiiLeak);
    for (const t of ['call 9876543210', 'mail a@b.com', 'pin 752001', 'on 12/03/1994', 'ID 1234 5678 9012', 'saw Dr. Mehta', 'visit https://x.example']) expect(() => assertClean(t)).toThrow(PiiLeak);
  });
  it('the error does not repeat the personal detail', () => {
    try { assertClean('Anita Rao 9876543210', known); expect.unreachable(); } catch (e) { expect((e as PiiLeak).message).not.toMatch(/Anita|9876/); expect((e as PiiLeak).why).not.toMatch(/Anita|9876/); }
  });
  it('is not fooled by being called twice (regex state)', () => {
    for (let i = 0; i < 3; i++) { expect(() => assertClean('plain text')).not.toThrow(); expect(() => assertClean('call 9876543210')).toThrow(); }
  });
  it('returns the text unchanged when clean', () => { expect(assertClean('fever and cough')).toBe('fever and cough'); });
});
