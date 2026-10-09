import { Link } from 'react-router-dom';
import { UrgencyPlate } from '../components/Plate';

const SHEET = [
  { ref: '0412', who: '58 y, male', note: 'Chest pain with sweating, started this morning', tier: 1, tag: 'Needs sign-off' },
  { ref: '0415', who: '3 y, female', note: 'Fever for two days, drinking poorly', tier: 2, tag: 'Needs sign-off' },
  { ref: '0409', who: '31 y, female', note: 'Cough and sore throat for four days', tier: 3, tag: 'Waiting long' },
  { ref: '0411', who: '44 y, male', note: 'Routine blood pressure check', tier: 4, tag: '' },
] as const;

const KEY_POINTS = [
  ['rules', 'Written rules, raise-only', 'Danger signs, an early-warning score and pregnancy blood pressure. A priority can go up, never down.'],
  ['record', 'Reads the records you have', 'Lab reports as PDF or photo become rows, and fill in the registration form.'],
  ['check', 'A person signs off', 'A nurse or doctor confirms or changes every priority, under their own name.'],
  ['lang', 'English, Hindi, Odia', 'Interface, questions, referral note and the text message a patient receives.'],
] as const;

const SETTINGS = [
  ['Outpatient desk', 'A waiting list ordered by priority.'],
  ['Health camp', 'Many people registered in one sitting.'],
  ['Campus clinic', 'Fever and common illness boards.'],
  ['Maternal follow-up', 'Pregnancy checks and reminders.'],
  ['Chronic check-in', 'Trends over repeat visits.'],
  ['Referral', 'To another facility, with the reason.'],
] as const;

const STEPS = [
  ['Check-in', 'Register the patient, or read their records to fill the form. Record consent. Enter the complaint and measurements.'],
  ['Questions', 'The danger-sign questions that fit these symptoms, most useful first. One tap each, submitted together.'],
  ['Sign-off', 'A nurse or doctor confirms the suggested priority, or changes it and says why.'],
  ['Visit', 'Call the patient in, finish the visit, or refer to another facility with the reason.'],
] as const;

const PLATES = [
  [1, 'Bring to a clinician now.'],
  [2, 'Needs a clinician very soon.'],
  [3, 'Needs a clinician soon.'],
  [4, 'Can wait for the routine queue.'],
] as const;

const ROLES = [
  ['Health worker', 'Registers patients, records consent, enters details and measurements, uploads records.'],
  ['Nurse, doctor, medical officer', 'Everything above, plus signing off priorities, confirming report results, and referrals.'],
  ['Facility administrator', 'Adds and removes people, assigns roles, reviews unusual access and the audit log. Cannot open patient records.'],
] as const;

const ROWS = [
  ['Haemoglobin', '9.1 g/dL', 'printed LOW', 'Two readers agree'],
  ['WBC count', '11,200 /cumm', 'printed HIGH', 'Readers differ'],
  ['Platelets', '2.4 lakh/cumm', '', 'Two readers agree'],
] as const;

const QUESTIONS = [
  ['Does it diagnose?', 'No. It suggests who should be seen first and shows the rule that decided it. It does not name a condition and does not advise treatment. Wording that would is blocked before it reaches the screen.'],
  ['Who decides the priority?', 'A nurse, doctor or medical officer. They confirm the suggestion or change it with a reason, and the decision carries their name. Making a patient less urgent than the rules said needs an extra confirmation.'],
  ['Can the AI lower a priority?', 'No. Every layer, including an AI suggestion, can only raise a priority. The AI answer is shown beside the rules result and never replaces it, and it is used only with the patient\'s consent.'],
  ['What is sent to outside AI services?', 'Only with the patient\'s separate consent, and only after names, phone numbers and identity numbers are removed. Every call is logged. Report images cannot be cleaned, so they need their own consent.'],
  ['Which languages does it use?', 'English, Hindi and Odia, in the interface, the complaint, the questions, the referral note and the text message a patient receives. Speech can be turned into text.'],
  ['Is it ready for real patients?', 'No. It is a hackathon prototype. The rules come from published protocols and have not been clinically validated, and the Hindi and Odia wording has not been reviewed by a native speaker.'],
] as const;

function Icon({ kind }: { kind: (typeof KEY_POINTS)[number][0] }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true } as const;
  if (kind === 'rules') return <svg {...p}><path d="M5 6h14M5 12h14M5 18h9" /></svg>;
  if (kind === 'record') return <svg {...p}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></svg>;
  if (kind === 'check') return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
  return <svg {...p}><path d="M4 6h9M8.5 4v2M5.5 10c1.5-1 2.7-2.6 3-4M6.5 8.5c1 1.5 2.4 2.6 4 3" /><path d="m13 20 3.5-9 3.5 9M14.2 17h4.6" /></svg>;
}

export function Landing() {
  return (
    <div className="landing">
      <div className="landing__wrap">
        <nav className="landing__nav" aria-label="Page">
          <a href="#features">Features</a>
          <a href="#contact">Contact</a>
          <Link className="btn btn--primary" to="/sign-in">Sign in</Link>
        </nav>

        <section className="landing__hero" aria-labelledby="lh">
          <div className="landing__heroText">
            <h1 id="lh">Who should be seen first.</h1>
            <p className="landing__lede">A triage desk for outpatient clinics, health camps and campus health centres. It suggests a priority and shows the reason. A nurse or doctor signs off every decision.</p>
            <p className="landing__lede landing__lede--quiet">It does not diagnose, and it does not decide treatment.</p>
            <div className="landing__actions">
              <Link className="btn btn--primary btn--big" to="/sign-in">Sign in</Link>
              <a className="btn btn--big" href="#features">See how it works</a>
            </div>
          </div>
          <ul className="landing__points">
            {KEY_POINTS.map(([k, title, text]) => <li key={k}><span className="landing__icon"><Icon kind={k} /></span><div><strong>{title}</strong><p>{text}</p></div></li>)}
          </ul>
        </section>

        <section className="landing__settings" aria-labelledby="l-set">
          <h2 id="l-set">Built for the places that triage every day</h2>
          <ul>
            {SETTINGS.map(([name, text]) => <li key={name}><strong>{name}</strong><span>{text}</span></li>)}
          </ul>
        </section>

        <section id="features" className="landing__features" aria-labelledby="l-flow">
          <div className="landing__rule"><span>A PATIENT, START TO FINISH</span></div>
          <div className="landing__intro">
            <h2 id="l-flow">One desk, from check-in to sign-off.</h2>
            <p>The screen follows the work. Each step shows what to do next and who does it, and any step can be reopened if something needs to change.</p>
          </div>

          <div className="landing__card" aria-label="Sample screens with invented patients">
            <div className="landing__col">
              <div className="landing__shot">
                <div className="landing__sheet" role="table" aria-label="Sample queue">
                  <div className="landing__sheet-head" role="row"><span role="columnheader">Patient</span><span role="columnheader">Complaint</span><span role="columnheader">Priority</span></div>
                  {SHEET.map(r => (
                    <div className="landing__sheet-row" role="row" key={r.ref}>
                      <span role="cell"><strong>{r.ref}</strong><br /><span className="muted small">{r.who}</span></span>
                      <span role="cell">{r.note}{r.tag && <><br /><span className="chip">{r.tag}</span></>}</span>
                      <span role="cell"><UrgencyPlate tier={r.tier} /></span>
                    </div>
                  ))}
                </div>
              </div>
              <h3>The queue</h3>
              <p>Most urgent first, then patients not yet assessed, then the longest wait. Missing answers are marked, never read as normal.</p>
            </div>
            <div className="landing__col">
              <div className="landing__shot">
                <div className="landing__case">
                  <div className="landing__caseHead"><UrgencyPlate tier={1} large /><strong>Patient 0412</strong><span className="muted small">58 y, male</span></div>
                  <p className="small"><strong>Why:</strong> a danger-sign rule for chest pain with sweating set this level. Rules can only raise a priority.</p>
                  <ol className="landing__journey" aria-label="Steps">
                    <li className="done">Check-in</li><li className="done">Questions</li><li className="next">Sign-off<span>Next</span></li><li>Visit</li>
                  </ol>
                </div>
              </div>
              <h3>The patient</h3>
              <p>Four steps, each a button. A next-step card says what to do now and who does it.</p>
            </div>
            <div className="landing__col">
              <div className="landing__shot">
                <div className="landing__case">
                  <strong>Sign-off</strong>
                  <p className="small">The rules set <strong>Immediate</strong>. Confirm it, or change it and say why. Your name is recorded with the decision.</p>
                  <div className="landing__fakebtns" aria-hidden="true"><span className="btn btn--primary">Confirm priority</span><span className="btn">Change priority</span></div>
                  <p className="tiny muted">A lower priority than the rules set needs a separate confirmation.</p>
                </div>
              </div>
              <h3>The sign-off</h3>
              <p>One section holds the whole decision. A stale assessment is refused, so nobody signs off something they did not see.</p>
            </div>
          </div>
          <p className="landing__caption tiny muted">Sample screens. The patients are invented.</p>

          <ol className="landing__steps">
            {STEPS.map(([name, text], i) => (
              <li key={name}><span className="landing__stepno" aria-hidden="true">{i + 1}</span><strong>{name}</strong><p>{text}</p></li>
            ))}
          </ol>
        </section>

        <section className="landing__bento" aria-label="More about the app">
          <div className="landing__bentoTop">
            <article className="landing__tile">
              <h3>Records you already have</h3>
              <p>Add a lab report as a PDF or a photo. The test results become rows with the value, unit, range and the flag the lab printed, and the patient's name, age and sex fill the registration form. A second reader can check the first, and a nurse or doctor confirms each row.</p>
              <div className="landing__rows" role="table" aria-label="Sample extracted rows">
                {ROWS.map(([n, v, f, a]) => <div role="row" key={n}><strong role="cell">{n}</strong><span role="cell">{v}</span><span role="cell">{f || 'no flag'}</span><span role="cell" className="chip">{a}</span></div>)}
              </div>
              <p className="tiny muted">Copied as printed. The system never decides whether a value is abnormal.</p>
            </article>
            <article className="landing__tile">
              <h3>Four priorities</h3>
              <p>Each priority has its own shape as well as a colour and a word, so it can be read without relying on colour. The same inputs always give the same answer, and the screen shows which rule decided it.</p>
              <ul className="landing__plates">
                {PLATES.map(([tier, text]) => <li key={tier}><UrgencyPlate tier={tier} /><span>{text}</span></li>)}
              </ul>
            </article>
          </div>
          <div className="landing__bentoBottom">
            <article className="landing__tile">
              <h3>Languages</h3>
              <p>English, Hindi and Odia in the interface, the complaint, the questions, the referral note and the text message a patient receives after sign-off. Speech can be turned into text. Notes can be kept on the computer when the connection drops, and a low-data mode is available.</p>
            </article>
            <article className="landing__tile">
              <h3>Who can do what</h3>
              <dl className="landing__roles">
                {ROLES.map(([role, text]) => <div key={role}><dt>{role}</dt><dd>{text}</dd></div>)}
              </dl>
            </article>
            <article className="landing__tile">
              <h3>Patient privacy</h3>
              <ul className="landing__list">
                <li>Nothing is saved, read by an outside AI service, shared or texted without the patient's consent. The server checks it, not just the screen.</li>
                <li>Names and phone numbers are removed before any text goes to an outside AI service, and every such call is logged.</li>
                <li>Every record opened is logged first. The log is chained, so an edited entry shows up when an administrator checks it.</li>
                <li>Facilities see only their own patients.</li>
              </ul>
            </article>
          </div>
        </section>

        <section className="landing__limits" aria-labelledby="l-lim">
          <h2 id="l-lim">Status</h2>
          <p>This is a hackathon prototype. It is not for use with real patients.</p>
          <ul className="landing__list">
            <li>The triage rules are transcribed from published protocols and have not been clinically validated.</li>
            <li>The Hindi and Odia wording has not been reviewed by a native speaker.</li>
            <li>Text messages to patients are off until a facility sets up its own sending account.</li>
          </ul>
        </section>

        <section className="landing__faq" aria-labelledby="l-faq">
          <div className="landing__faqHead">
            <h2 id="l-faq">Questions clinicians ask</h2>
            <p>Short answers about what the app does and does not do.</p>
          </div>
          <div className="landing__faqList">
            {QUESTIONS.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </section>

        <section id="contact" className="landing__faq landing__contact" aria-labelledby="l-contact">
          <div className="landing__faqHead">
            <h2 id="l-contact">Contact</h2>
          </div>
          <div className="landing__faqList">
            <p>Accounts are created by your facility administrator. If you do not have one, ask them to add you.</p>
            <p>Questions about this prototype go to the BPUT Hackathon 2026 project team.</p>
          </div>
        </section>

        <footer className="landing__foot">
          <span>Organises information for review. Does not diagnose or advise treatment.</span>
          <Link className="btn" to="/sign-in">Sign in</Link>
        </footer>
      </div>
    </div>
  );
}
