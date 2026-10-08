import { describe, expect, it } from 'vitest';
import { journey, stepOf, type JourneyInput } from './journey';

const base: JourneyInput = { consent: true, status: 'submitted', hasAssessment: false, recorded: true, openQuestions: 0, signedOff: false, queueStatus: null, canReview: true };
const j = (o: Partial<JourneyInput> = {}) => journey({ ...base, ...o });
const states = (x: ReturnType<typeof journey>) => x.steps.map(s => `${s.key}:${s.state}`).join(' ');

describe('journey: what to do next, in order', () => {
  it('there is no "priority" step: the draft priority is a result, not a place to go', () => {
    expect(j().steps.map(s => s.key)).toEqual(['checkin', 'questions', 'signoff', 'visit']);
  });
  it('no consent: record consent first', () => {
    const x = j({ consent: false }); expect(x.next).toBe('consent'); expect(x.recommended).toBe('checkin'); expect(states(x)).toBe('checkin:current questions:todo signoff:todo visit:todo');
  });
  it('consent but not yet assessed: assess (or add details first when nothing is recorded)', () => {
    expect(j().next).toBe('assess'); expect(j().title).toMatch(/draft priority/i);
    expect(j({ recorded: false }).title).toMatch(/Add what the patient says/);
  });
  it('assessed with open questions: answer them, the questions step is current', () => {
    const x = j({ hasAssessment: true, openQuestions: 5 }); expect(x.next).toBe('answer'); expect(x.title).toBe('Answer 5 questions'); expect(states(x)).toBe('checkin:done questions:current signoff:todo visit:todo');
    expect(j({ hasAssessment: true, openQuestions: 1 }).title).toBe('Answer 1 question');
  });
  it('questions done: a nurse or doctor signs off; anyone else waits for them', () => {
    const a = j({ hasAssessment: true }); expect(a.next).toBe('signoff'); expect(a.owner).toBe('nurse_or_doctor'); expect(states(a)).toBe('checkin:done questions:done signoff:current visit:todo');
    const b = j({ hasAssessment: true, canReview: false }); expect(b.next).toBe('wait_signoff'); expect(b.recommended).toBe('signoff'); expect(b.title).toMatch(/Waiting for a nurse or doctor/);
  });
  it('signed off: call the patient in, then finish the visit', () => {
    const a = j({ hasAssessment: true, signedOff: true, queueStatus: 'waiting' }); expect(a.next).toBe('call_in'); expect(states(a)).toBe('checkin:done questions:done signoff:done visit:current');
    const b = j({ hasAssessment: true, signedOff: true, queueStatus: 'in_review', status: 'in_review' }); expect(b.next).toBe('complete'); expect(b.steps[3]!.note).toBe('In review');
  });
  it('open questions do not block sign-off elsewhere: they only change what is recommended first', () => {
    expect(j({ hasAssessment: true, openQuestions: 3, signedOff: true, queueStatus: 'waiting' }).next).toBe('answer');
  });
  it('closed or referred: everything is done and nothing is recommended', () => {
    for (const status of ['closed', 'referred']) { const x = j({ status, hasAssessment: true, signedOff: true }); expect(x.next).toBe('finished'); expect(x.recommended).toBeNull(); expect(x.steps.every(s => s.state === 'done')).toBe(true); }
    expect(j({ status: 'referred' }).title).toBe('Referred'); expect(j({ status: 'closed' }).title).toBe('Visit completed');
  });
  it('a consent not yet known (null) does not block', () => { expect(j({ consent: null }).next).toBe('assess'); });
  it('exactly one step is recommended (current) unless the patient is finished', () => {
    for (const o of [{}, { consent: false }, { hasAssessment: true, openQuestions: 2 }, { hasAssessment: true }, { hasAssessment: true, signedOff: true }, { hasAssessment: true, signedOff: true, queueStatus: 'in_review' }])
      expect(j(o).steps.filter(s => s.state === 'current')).toHaveLength(1);
    expect(j({ status: 'closed' }).steps.filter(s => s.state === 'current')).toHaveLength(0);
  });
  it('every action belongs to a step', () => {
    expect([stepOf('consent'), stepOf('assess'), stepOf('answer'), stepOf('signoff'), stepOf('wait_signoff'), stepOf('call_in'), stepOf('complete')]).toEqual(['checkin', 'checkin', 'questions', 'signoff', 'signoff', 'visit', 'visit']);
  });
});
