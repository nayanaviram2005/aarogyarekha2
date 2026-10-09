import { describe, expect, it } from 'vitest';
import { cleanQuestion, getAiOpinion, type Candidate } from '../src/ai/triageOpinion.js';
import { buildFollowUps } from '../src/intake/followups.js';
import { RULESET_PROPOSED as PROP } from '../src/triage/ruleset.proposed.js';
import type { TriageInput } from '../src/triage/types.js';

const input: TriageInput = { ageYears: 34, pregnant: false, vitals: { temperature_c: 36.8 }, signs: {} };
const cands: Candidate[] = [
  { code: 'shock_signs', label: 'Signs of shock', question: 'Are the hands and feet cold with a weak, fast pulse?', must: true },
  { code: 'persistent_vomiting', label: 'Vomiting that keeps happening', question: 'Does the vomiting keep happening?' },
  { code: 'mental_health_crisis', label: 'Severe distress', question: 'Is the patient in severe distress?' },
];
const gen = (reply: unknown) => async () => ({ text: JSON.stringify(reply), provider: 'mock' as const, model: 'm' });
const run = (reply: unknown) => getAiOpinion(gen(reply), input, { complaint: 'stomach pain', symptoms: [] }, 'male', {}, cands);

describe('cleanQuestion', () => {
  it('keeps one short plain question', () => { expect(cleanQuestion('  Has the stomach pain spread to the back?  ')).toBe('Has the stomach pain spread to the back?'); });
  it('rejects questions put to the patient in the first or second person, so the rule text (third person) is used instead', () => {
    for (const bad of ['Is your airway blocked?', 'Are you struggling to breathe?', 'Do I feel dizzy?', 'Have we seen blood in the vomit?', 'Is my chest tight?', 'Are your lips blue?']) expect(cleanQuestion(bad), bad).toBeNull();
    expect(cleanQuestion('Is the patient struggling to breathe?')).toBe('Is the patient struggling to breathe?');
  });
  it('rejects statements, run-ons, tokens, links, long digit runs, and diagnosing or advising wording', () => {
    for (const bad of ['Is it appendicitis?', 'Start antibiotics now?', 'Has the pain spread to the back', 'Is it bad? Is it spreading?', 'Is [[NAME_1]] vomiting?', 'Is it at http://x.y?', 'Call 9876543210 now?', 'Why?', 'x'.repeat(250) + '?'])
      expect(cleanQuestion(bad), bad).toBeNull();
  });
});

describe('the model words the questions', () => {
  it('keeps wording only for codes that were offered, and never lets it pick an always-asked code as an "ask"', async () => {
    const r = await run({ tier: 3, reason: 'Needs to be seen soon.', ask: ['persistent_vomiting', 'shock_signs', 'made_up'], questions: [
      { code: 'persistent_vomiting', text: 'Has the vomiting been going on all day?' }, { code: 'shock_signs', text: 'Do the hands and feet feel cold, with a weak and fast pulse?' }, { code: 'made_up', text: 'Is this invented?' }] });
    expect(r.opinion!.ask).toEqual(['persistent_vomiting']); expect(Object.keys(r.opinion!.phrasing).sort()).toEqual(['persistent_vomiting', 'shock_signs']);
  });
  it('drops bad wording but keeps the rest of the opinion', async () => {
    const r = await run({ tier: 3, reason: 'Needs to be seen soon.', ask: ['persistent_vomiting'], questions: [{ code: 'persistent_vomiting', text: 'This is gastroenteritis, start treatment' }] });
    expect(r.opinion!.phrasing).toEqual({}); expect(r.opinion!.ask).toEqual(['persistent_vomiting']);
  });
  it('the prompt carries the plain question and says the meaning must not change', async () => {
    let user = ''; let system = '';
    await getAiOpinion(async r => { user = r.user; system = r.system; return { text: JSON.stringify({ tier: 4, reason: 'Routine.' }), provider: 'mock', model: 'm' }; }, input, { complaint: 'stomach pain', symptoms: [] }, 'male', {}, cands);
    expect(user).toContain('Always asked'); expect(user).toContain('plain question: Does the vomiting keep happening?'); expect(system).toMatch(/SAME meaning/);
  });
  it('follow-ups use the wording when there is some and the rule text when there is not', () => {
    const missing = [{ code: 'sign.persistent_vomiting', label: 'x', potentialTier: 3 as const }, { code: 'sign.shock_signs', label: 'y', potentialTier: 2 as const }];
    const f = buildFollowUps(missing, PROP, undefined, { persistent_vomiting: 'Has the vomiting been going on all day?' });
    expect(f.find(x => x.fieldCode === 'sign.persistent_vomiting')).toMatchObject({ question: 'Has the vomiting been going on all day?', wording: 'ai' });
    expect(f.find(x => x.fieldCode === 'sign.shock_signs')).toMatchObject({ wording: 'rules' });
  });
});
