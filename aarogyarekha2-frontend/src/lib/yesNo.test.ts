import { describe, expect, it } from 'vitest';
import { pickVoice } from './speech';
import { parseYesNo } from './yesNo';

describe('understanding a spoken yes or no', () => {
  it.each([
    ['Yes', 'yes'], ['yeah, he is', 'yes'], ['Yes!', 'yes'], ['haan', 'yes'], ['Haan ji', 'yes'], ['हाँ', 'yes'], ['हां, है', 'yes'], ['जी', 'yes'], ['ହଁ', 'yes'], ['ଅଛି', 'yes'],
    ['No', 'no'], ['no.', 'no'], ['nope', 'no'], ['not at all', 'no'], ['nahi', 'no'], ['नहीं', 'no'], ['ji nahi', 'no'], ['ना', 'no'], ['ନା', 'no'], ['ନାହିଁ', 'no'],
  ] as const)('%s means %s', (said, want) => { expect(parseYesNo(said)).toBe(want); });
  it.each(['', '   ', 'maybe', 'I do not know', "don't know", 'पता नहीं', 'pata nahi', 'yes and no', 'haan nahi', 'the fever started yesterday', 'blue'])('%j is not understood, so the person is asked again', said => { expect(parseYesNo(said)).toBeNull(); });
});

describe('choosing a spoken voice', () => {
  const v = (lang: string) => ({ lang, name: lang });
  it('prefers the Indian voice, then others of the language, and is null when the device has none', () => {
    expect(pickVoice([v('en-US'), v('en-IN')], 'en')).toEqual(v('en-IN'));
    expect(pickVoice([v('hi_IN')], 'hi')).toEqual(v('hi_IN'));
    expect(pickVoice([v('en-US'), v('hi-IN')], 'or')).toBeNull();
    expect(pickVoice([v('or-IN')], 'or')).toEqual(v('or-IN'));
    expect(pickVoice([v('hi-XX')], 'hi')).toEqual(v('hi-XX'));
    expect(pickVoice([], 'en')).toBeNull();
  });
});
