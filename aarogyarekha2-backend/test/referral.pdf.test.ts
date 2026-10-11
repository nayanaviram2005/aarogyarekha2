import { describe, expect, it } from 'vitest';
import { buildReferralBundle, type ReferralBuildInput } from '../src/fhir/referral.js';
import { ID, sample } from './helpers/referralInput.js';
import { noteContent, renderReferralPdf, runsOf } from '../src/referral/pdf.js';
import { inspectPdf } from '../src/files/pdf.js';

const input = (over: Partial<ReferralBuildInput> = {}): ReferralBuildInput => sample({
  patient: { ...sample().patient, full_name: 'अनीता राव' },
  encounter: { ...sample().encounter, chief_complaint_original: 'सिर में तेज़ दर्द', chief_complaint_translated: 'Severe headache' },
  symptoms: [{ id: ID(30), text_original: 'ଜ୍ୱର ଓ ମୁଣ୍ଡବିଷ', text_translated: 'Fever and headache', duration_value: 2, duration_unit: 'days', severity: 5 }],
  ...over,
});
const bundle = () => buildReferralBundle(input());

describe('runsOf', () => {
  it('splits by script and keeps spaces and punctuation with the run before them', () => {
    expect(runsOf('Name अनीता राव, ଜ୍ୱର ok').map(r => [r.script, r.text])).toEqual([['latin', 'Name '], ['deva', 'अनीता राव, '], ['orya', 'ଜ୍ୱର '], ['latin', 'ok']]);
  });
  it('digits and punctuation alone are Latin; empty is empty', () => { expect(runsOf('12.5 mg').every(r => r.script === 'latin')).toBe(true); expect(runsOf('')).toEqual([]); });
});

describe('noteContent', () => {
  it('has the sections of the document, with measurements listed and the notice present', () => {
    const c = noteContent(bundle()); const titles = c.sections.map(s => s.title);
    expect(titles).toEqual(expect.arrayContaining(['Reason for referral', 'Reported complaint', 'Measurements', 'Notice'])); expect(c.sections.find(s => s.title === 'Measurements')!.lines.join(' ')).toMatch(/165/);
  });
  it('contains no phone number or street address (the document never had them)', () => { expect(JSON.stringify(noteContent(bundle()))).not.toMatch(/9999900000|Secret Lane/); });
  it('a document with no sections gives an empty list', () => { expect(noteContent({ resourceType: 'Bundle', type: 'document', entry: [] }).sections).toEqual([]); });
});

describe('renderReferralPdf', () => {
  it('makes a real PDF that passes the same safety checks as an upload, with the right text and a footer on the page', async () => {
    const pdf = await renderReferralPdf(bundle(), { sha256: 'a'.repeat(64), fromFacility: 'Seed PHC Khordha', toFacility: 'Seed District Hospital', priority: 'As soon as possible', sentAt: '2026-10-06T11:10:00Z' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const r = await inspectPdf(pdf, { readText: true }); expect(r.ok).toBe(true);
    if (r.ok) { const text = r.text.join('\n'); expect(text).toContain('Referral note'); expect(text).toContain('Reason for referral'); expect(text).toContain('Needs assessment by an obstetrician'); expect(text).toContain('Does not diagnose or advise treatment'); expect(text).toContain('aaaaaaaaaaaaaaaa'); expect(text).toContain('Seed District Hospital'); expect(text).toContain('165'); }
  });
  it('draws Hindi and Odia without losing the characters', async () => {
    const pdf = await renderReferralPdf(bundle(), { sha256: null });
    const r = await inspectPdf(pdf, { readText: true }); if (!r.ok) throw new Error('unreadable'); const text = r.text.join('\n');
    expect(text).toMatch(/[ऀ-ॿ]/); expect(text).toMatch(/[଀-୿]/);
  });
  it('a very long note runs onto more pages, each with the footer', async () => {
    const long = 'Needs assessment by an obstetrician at a higher facility. '.repeat(400);
    const pdf = await renderReferralPdf(buildReferralBundle(input({ reasonText: long })), { sha256: 'b'.repeat(64) });
    const r = await inspectPdf(pdf, { readText: true }); if (!r.ok) throw new Error('x'); expect(r.pages).toBeGreaterThan(1); expect(r.text.join('\n').match(/Does not diagnose or advise treatment/g)!.length).toBeGreaterThanOrEqual(r.pages);
  }, 60_000);
  it('a single very long word does not run off the page or crash', async () => {
    const pdf = await renderReferralPdf(buildReferralBundle(input({ reasonText: 'x'.repeat(3000) })), { sha256: null }); expect((await inspectPdf(pdf, {})).ok).toBe(true);
  });
  it('an empty document still makes a valid one-page PDF', async () => {
    const pdf = await renderReferralPdf({ resourceType: 'Bundle', type: 'document', entry: [] }, { sha256: null }); const r = await inspectPdf(pdf, {}); expect(r.ok).toBe(true); if (r.ok) expect(r.pages).toBe(1);
  });
  it('the PDF carries no script, link or attachment (safe to open)', async () => {
    const pdf = (await renderReferralPdf(bundle(), { sha256: null })).toString('latin1'); expect(pdf).not.toMatch(/\/JavaScript|\/JS\b|\/OpenAction|\/Launch|\/EmbeddedFile|\/URI/);
  });
});
