/**
 * Where a patient is in the triage-desk journey, and the one thing to do next. Pure: built only from facts the screen already has.
 *
 *   1 Check-in   consent, what the patient says, measurements, and the system's draft priority
 *   2 Questions  the danger-sign questions that fit this patient
 *   3 Sign-off   a nurse or doctor confirms or changes the priority
 *   4 Visit      call in, then treated / sent home / referred
 * The draft priority is a RESULT shown on the page, not a step of its own.
 */
export type StepKey = 'checkin' | 'questions' | 'signoff' | 'visit';
export type StepState = 'done' | 'current' | 'todo';
export type NextAction = 'consent' | 'assess' | 'answer' | 'signoff' | 'wait_signoff' | 'call_in' | 'complete' | 'finished';

export interface JourneyInput {
  consent: boolean | null;               // null = not known yet
  status: string;                        // encounter status
  hasAssessment: boolean;
  recorded: boolean;                     // at least one symptom, measurement or complaint
  openQuestions: number;
  signedOff: boolean;                    // the CURRENT assessment has been reviewed
  queueStatus: string | null;
  canReview: boolean;
}
export interface JourneyStep { key: StepKey; label: string; state: StepState; note: string }
export interface Journey { steps: JourneyStep[]; next: NextAction; title: string; detail: string; owner: 'anyone' | 'nurse_or_doctor'; /** The step the next action belongs to (null when finished). */ recommended: StepKey | null }

/** The step an action belongs to. */
export const stepOf = (n: NextAction): StepKey => (n === 'consent' || n === 'assess' ? 'checkin' : n === 'answer' ? 'questions' : n === 'signoff' || n === 'wait_signoff' ? 'signoff' : 'visit');

export const STEP_LABEL: Record<StepKey, string> = { checkin: 'Check-in', questions: 'Questions', signoff: 'Sign-off', visit: 'Visit' };

export function journey(i: JourneyInput): Journey {
  const finished = i.status === 'closed' || i.status === 'referred';
  const noConsent = i.consent === false;

  let next: NextAction; let title: string; let detail: string; let owner: Journey['owner'] = 'anyone';
  if (finished) { next = 'finished'; title = i.status === 'referred' ? 'Referred' : 'Visit completed'; detail = 'This patient has left the queue.'; }
  else if (noConsent) { next = 'consent'; title = 'Record the patient\'s consent'; detail = 'Read the notice to the patient first. Nothing can be saved or assessed before this.'; }
  else if (!i.hasAssessment) { next = 'assess'; title = i.recorded ? 'Get the draft priority' : 'Add what the patient says or a measurement, then assess'; detail = 'The system sets a draft priority in a few seconds. A nurse or doctor confirms it.'; }
  else if (i.openQuestions > 0) { next = 'answer'; title = `Answer ${i.openQuestions} question${i.openQuestions === 1 ? '' : 's'}`; detail = 'Only questions that fit this patient. Choose an answer for each, then submit them together.'; }
  else if (!i.signedOff) {
    if (i.canReview) { next = 'signoff'; title = 'Review and sign off the priority'; detail = 'Confirm the draft, or change it with a reason.'; owner = 'nurse_or_doctor'; }
    else { next = 'wait_signoff'; title = 'Waiting for a nurse or doctor to sign off'; detail = 'The draft priority is set and the patient is in the queue. Nothing more is needed from you.'; owner = 'nurse_or_doctor'; }
  }
  else if (i.queueStatus === 'in_review') { next = 'complete'; title = 'Finish the visit'; detail = 'Choose how the visit ended, or send a referral.'; }
  else { next = 'call_in'; title = 'Call the patient in'; detail = 'The priority is signed off. Call the patient in when they are next.'; }

  const checkinDone = !noConsent && i.hasAssessment;
  const qDone = i.hasAssessment && i.openQuestions === 0;
  const keys: StepKey[] = ['checkin', 'questions', 'signoff', 'visit'];
  const recommended = finished ? null : stepOf(next);
  const done = (k: StepKey): boolean => finished || (k === 'checkin' ? checkinDone : k === 'questions' ? qDone : k === 'signoff' ? i.signedOff : false);
  const notes: Record<StepKey, string> = {
    checkin: noConsent ? 'Consent needed' : i.hasAssessment ? 'Recorded' : 'Add details',
    questions: !i.hasAssessment ? '' : i.openQuestions > 0 ? `${i.openQuestions} open` : 'Answered',
    signoff: i.signedOff ? 'Signed' : i.hasAssessment ? 'Needed' : '',
    visit: finished ? (i.status === 'referred' ? 'Referred' : 'Completed') : i.queueStatus === 'in_review' ? 'In review' : i.signedOff ? 'Waiting' : '',
  };
  const steps = keys.map((k): JourneyStep => ({ key: k, label: STEP_LABEL[k], note: notes[k], state: k === recommended ? 'current' : done(k) ? 'done' : 'todo' }));
  return { steps, next, title, detail, owner, recommended };
}
