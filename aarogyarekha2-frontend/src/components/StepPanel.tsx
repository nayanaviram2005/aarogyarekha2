import { Link } from 'react-router-dom';
import { STEP_LABEL, type Journey, type StepKey } from '../lib/journey';

const PLAIN_TITLE: Record<StepKey, string> = { checkin: 'Check-in: what was recorded', questions: 'Questions', signoff: 'Sign-off', visit: 'Visit and referral' };
const PLAIN_DETAIL: Record<StepKey, string> = {
  checkin: 'Change or add what the patient says, a measurement or a report. Assess again afterwards to update the priority.',
  questions: 'Answers can be changed here. The patient is assessed again when you submit.',
  signoff: 'Confirm the draft priority, or change it with a reason.',
  visit: 'Call the patient in, finish the visit, or send a referral.',
};

export function StepPanel({ j, selected, onSelect, assessing, editable, onAssess, children }: {
  j: Journey; selected: StepKey; onSelect: (k: StepKey) => void; assessing: boolean; editable: boolean; onAssess: () => void; children: React.ReactNode;
}) {
  const here = j.recommended === selected;
  const state = j.steps.find(s => s.key === selected)?.state;
  const eyebrow = j.next === 'finished' ? 'Finished' : here ? (j.owner === 'nurse_or_doctor' ? 'Next step · nurse or doctor' : 'Next step') : `${STEP_LABEL[selected]}${state === 'done' ? ' · done' : ''}`;
  return (
    <section className={`nextstep nextstep--${here ? j.next : 'other'}`} aria-label={`${STEP_LABEL[selected]} step`}>
      <p className="nextstep__eyebrow">{eyebrow}</p>
      <h3 className="nextstep__title">{here || j.next === 'finished' ? j.title : PLAIN_TITLE[selected]}</h3>
      <p className="nextstep__detail small">{here || j.next === 'finished' ? j.detail : PLAIN_DETAIL[selected]}</p>
      {!here && j.recommended && j.next !== 'finished' && (
        <p className="small" style={{ margin: 0 }}>The next step is <button type="button" className="linklike" onClick={() => onSelect(j.recommended!)}>{j.title}</button></p>
      )}
      {here && j.next === 'assess' && (
        <div className="nextstep__actions"><button type="button" className="btn btn--primary btn--big" onClick={onAssess} disabled={assessing || !editable}>{assessing ? 'Assessing…' : 'Assess now'}</button></div>
      )}
      {j.next === 'finished' && (
        <div className="nextstep__actions"><Link className="btn btn--primary btn--big" to="/intake">New patient</Link><Link className="btn" to="/">Back to the queue</Link></div>
      )}
      <div className="nextstep__body">{children}</div>
    </section>
  );
}
