import { EASE_INOUT } from '../tokens';
import { BTN, mid, PT } from './layout';
import { p } from './util';

type XY = [number, number];
/** The cursor leaves where it is at `dep`, arrives at `to` at `arr`, and stays there until the next move. One smooth move each, so it never jitters. */
interface Move { dep: number; arr: number; to: XY }

export const START: XY = [960, 700];

export const MOVES: Move[] = [
  // (no cursor while signing in: the form fills itself)
  // the dashboard: hover the top bar
  { dep: 7.8, arr: 9.0, to: [700, 300] },
  { dep: 9.1, arr: 9.6, to: PT.nav.scenarios },
  { dep: 10.0, arr: 10.5, to: PT.nav.referrals },
  { dep: 10.9, arr: 11.4, to: PT.nav.offline },
  { dep: 11.8, arr: 12.3, to: PT.nav.emergency },
  { dep: 12.6, arr: 13.6, to: [600, 300] },
  // the queue
  { dep: 14.0, arr: 15.8, to: PT.row(0) },
  { dep: 16.2, arr: 17.4, to: PT.row(2) },
  { dep: 17.7, arr: 18.6, to: PT.row(1) },
  // the four steps
  { dep: 21.0, arr: 22.2, to: PT.journey(0) },
  { dep: 22.3, arr: 23.0, to: PT.journey(1) },
  { dep: 23.1, arr: 23.8, to: PT.journey(2) },
  { dep: 23.9, arr: 24.6, to: PT.journey(3) },
  // consent
  { dep: 24.8, arr: 26.4, to: mid(BTN.recordConsent) },
  { dep: 27.6, arr: 29.4, to: mid(BTN.agree) },
  // complaint, then fetch the report from the desktop and drop it in
  { dep: 30.3, arr: 31.9, to: PT.complaint },
  { dep: 35.2, arr: 37.0, to: PT.fileStart },
  { dep: 37.4, arr: 40.3, to: mid(BTN.dropZone) },
  { dep: 44.8, arr: 46.4, to: mid(BTN.mic) },
  { dep: 50.0, arr: 51.8, to: mid(BTN.getPriority) },
  // the questions
  { dep: 63.2, arr: 64.8, to: mid(BTN.no(0)) },
  { dep: 65.3, arr: 66.4, to: mid(BTN.no(1)) },
  { dep: 66.9, arr: 68.0, to: mid(BTN.yes(2)) },
  { dep: 68.5, arr: 70.0, to: mid(BTN.submit) },
  // the reports
  { dep: 73.6, arr: 75.8, to: mid(BTN.confirmRow(0)) },
  { dep: 76.3, arr: 77.4, to: mid(BTN.confirmRow(1)) },
  { dep: 77.9, arr: 79.0, to: mid(BTN.confirmRow(2)) },
  // sign-off
  { dep: 80.4, arr: 82.8, to: mid(BTN.change) },
  { dep: 83.5, arr: 86.1, to: mid(BTN.cancel) },
  { dep: 86.7, arr: 88.2, to: mid(BTN.confirm) },
  // the visit and the referral
  { dep: 94.4, arr: 96.3, to: mid(BTN.callIn) },
  { dep: 105.8, arr: 107.0, to: mid(BTN.preview) },
  { dep: 107.5, arr: 109.2, to: mid(BTN.send) },
  { dep: 111.0, arr: 113.4, to: PT.queue },
  { dep: 123.0, arr: 124.4, to: [960, 700] },
];

/** The moments a click happens (a ring is drawn and the button presses). */
export const CLICKS = [19.7, 27.0, 29.7, 32.1, 46.6, 52.4, 65.0, 66.6, 68.2, 70.2, 76.0, 77.6, 79.2, 83.0, 86.4, 88.4, 96.6, 107.2, 109.4];

/** A name for each click, for the timeline. */
export const CLICK_LABELS = ['Patient row in the queue', 'Record consent', 'Patient agrees', 'Complaint field', 'Microphone', 'Get the priority', 'No, first question', 'No, second question', 'Yes, third question', 'Submit answers', 'Confirm result 1', 'Confirm result 2', 'Confirm result 3', 'Change priority', 'Cancel', 'Confirm priority', 'Call in', 'Preview referral', 'Send referral'];

/** The report is picked up from the desktop and carried to the drop zone while the cursor holds it. */
export const DRAG = { from: 37.2, to: 40.4 };

export const cursorAt = (t: number): XY => {
  let at: XY = START;
  for (const m of MOVES) {
    if (t <= m.dep) return at;
    if (t < m.arr) {
      const k = p(t, m.dep, m.arr, EASE_INOUT);
      return [at[0] + (m.to[0] - at[0]) * k, at[1] + (m.to[1] - at[1]) * k];
    }
    at = m.to;
  }
  return at;
};
