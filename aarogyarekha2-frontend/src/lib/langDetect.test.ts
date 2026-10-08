import { describe, expect, it } from 'vitest';
import { GLOSSARY, glossaryMatches } from './glossary';
import { detectLanguage, languageSuggestion } from './langDetect';

describe('detectLanguage', () => {
  it('Devanagari is Hindi, Odia script is Odia, plain English is English', () => {
    expect(detectLanguage('तीन दिन से बुखार और खांसी').lang).toBe('hi'); expect(detectLanguage('ତିନି ଦିନ ଧରି ଜ୍ୱର ଓ କାଶ').lang).toBe('or'); expect(detectLanguage('fever and cough for three days').lang).toBe('en');
  });
  it('Hindi typed in English letters is recognised as Hindi and flagged as such', () => {
    expect(detectLanguage('bukhar teen din se hai')).toMatchObject({ lang: 'hi', romanizedHindi: true }); expect(detectLanguage('pet mein dard')).toMatchObject({ lang: 'hi', romanizedHindi: true });
  });
  it('ordinary English that happens to contain "sir" or "pet" is not called Hindi', () => {
    expect(detectLanguage('thank you sir').lang).toBe('en'); expect(detectLanguage('the child has a pet dog').lang).toBe('en'); expect(detectLanguage('headache and sore throat').lang).toBe('en');
  });
  it('too little text is unknown; digits and symbols alone are unknown', () => { expect(detectLanguage('a').lang).toBe('unknown'); expect(detectLanguage('123 !!').lang).toBe('unknown'); expect(detectLanguage('').lang).toBe('unknown'); });
  it('mixed scripts are flagged, and the main one wins', () => {
    const d = detectLanguage('बुखार fever और खांसी cough'); expect(d.mixed).toBe(true); expect(['hi', 'en']).toContain(d.lang);
    expect(detectLanguage('बुखार तीन दिन से है and fever').lang).toBe('hi');
  });
});

describe('languageSuggestion', () => {
  it('suggests nothing when the text matches the chosen language', () => { expect(languageSuggestion('तीन दिन से बुखार', 'hi')).toBeNull(); expect(languageSuggestion('fever for three days', 'en')).toBeNull(); });
  it('suggests the detected language when it differs, in plain words', () => {
    expect(languageSuggestion('तीन दिन से बुखार', 'en')).toEqual({ lang: 'hi', message: 'This looks like Hindi. The language is set to English.' });
    expect(languageSuggestion('bukhar teen din se', 'en')?.message).toContain('typed in English letters');
  });
  it('stays quiet for very short or unclear text', () => { expect(languageSuggestion('ok', 'hi')).toBeNull(); expect(languageSuggestion('12345', 'hi')).toBeNull(); });
});

describe('glossary', () => {
  it('maps Hindi, Odia and romanised words to one plain English term', () => {
    expect(glossaryMatches('तीन दिन से बुखार और खांसी')).toEqual(['fever', 'cough']); expect(glossaryMatches('ଜ୍ୱର ଓ ବାନ୍ତି')).toEqual(['fever', 'vomiting']); expect(glossaryMatches('bukhar aur ulti')).toEqual(['fever', 'vomiting']);
  });
  it('matches Latin words as whole words, so "dast" does not match inside "dastar"', () => { expect(glossaryMatches('dastar')).toEqual([]); expect(glossaryMatches('dast ho rahe hain')).toEqual(['loose motions']); });
  it('lists each term once and gives nothing for plain English or empty text', () => { expect(glossaryMatches('bukhar bukhar बुखार')).toEqual(['fever']); expect(glossaryMatches('')).toEqual([]); expect(glossaryMatches('headache')).toEqual([]); });
  it('every entry has a term and at least one word; terms are unique; no term says what the illness is', () => {
    expect(new Set(GLOSSARY.map(g => g.term)).size).toBe(GLOSSARY.length); for (const g of GLOSSARY) { expect(g.words.length, g.term).toBeGreaterThan(0); expect(g.term).not.toMatch(/malaria|dengue|typhoid|covid|tb\b|pneumonia|infection|diabetes|cancer/i); }
  });
});
