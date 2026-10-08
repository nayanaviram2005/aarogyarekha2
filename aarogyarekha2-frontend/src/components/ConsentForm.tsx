import { useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from './Modal';
import type { Api, ConsentInput } from '../lib/types';
import { Banner } from './Provenance';
import { useMe } from '../screens/meContext';

// DRAFT wording. It must be reviewed (legal and clinical) before use with real patients.
export const NOTICE_VERSION = 'notice-v0-draft';
export const NOTICE_TEXT =
  'We are recording your symptoms and health readings so the health team can decide who needs to be seen first. ' +
  'A nurse or doctor reviews every result. This system does not diagnose or decide your treatment. ' +
  'Only staff at this facility can see your record, and every view is logged. You can withdraw your consent at any time.';

export const SHARING_NOTICE_VERSION = 'sharing-notice-v0-draft';
export const sharingNoticeText = (facility: string | null) =>
  `With your permission we will send a summary of your record to ${facility ?? 'the receiving facility'} so they can see you. ` +
  'The summary has your name, age, symptoms, measurements and the priority our reviewers set. It does not include your phone number or street address. ' +
  'Only that facility receives it, and every time it is sent or opened is logged. You can say no, and you can withdraw this permission at any time.';

export const AI_NOTICE_VERSION = 'outside-ai-notice-v0-draft';
export const AI_NOTICE_TEXT =
  'With your permission, what you told us may be sent to an outside computer service to be translated into English for the nurse. ' +
  'Before it is sent we remove your name, phone number and other personal details. The service does not make decisions about your care. ' +
  'A person always reads the result. You can say no. Then your words are read in the original language. You can change your mind at any time.';

export const REMINDER_NOTICE_VERSION = 'reminders-notice-v0-draft';
export const REMINDER_NOTICE_TEXT =
  'With your permission the facility will send you a short reminder before your next visit, by SMS, WhatsApp, a call or in the app. ' +
  'The reminder says only the facility name and the date. It does not say why you are being seen. You can say no, and you can stop reminders at any time.';

export const STATUS_NOTICE_VERSION = 'status-messages-notice-v0-draft';
export const STATUS_NOTICE_TEXT =
  'With your permission we will send a text message to your phone to tell you your place in the queue, in your language. ' +
  'It uses only your first name and your queue status. It does not say why you are being seen. You can say no, and you can reply STOP at any time to stop the messages.';

/** `dialog` shows it as a pop-up over the page (for a prompt that interrupts work); `onCancel` lets the person close it without recording anything. */
export function ConsentForm({ api, patientId, onRecorded, purpose = 'care_triage', facilityName = null, dialog = false, onCancel, intro }: { api: Api; patientId: string; onRecorded: () => void; purpose?: 'care_triage' | 'referral_sharing' | 'external_ai_processing' | 'reminders' | 'status_messages'; facilityName?: string | null; dialog?: boolean; onCancel?: () => void; intro?: ReactNode }) {
  const sharing = purpose === 'referral_sharing';
  const ai = purpose === 'external_ai_processing';
  const remind = purpose === 'reminders';
  const texts = purpose === 'status_messages';
  const noticeVersion = texts ? STATUS_NOTICE_VERSION : remind ? REMINDER_NOTICE_VERSION : ai ? AI_NOTICE_VERSION : sharing ? SHARING_NOTICE_VERSION : NOTICE_VERSION;
  const noticeText = texts ? STATUS_NOTICE_TEXT : remind ? REMINDER_NOTICE_TEXT : ai ? AI_NOTICE_TEXT : sharing ? sharingNoticeText(facilityName) : NOTICE_TEXT;
  const [method, setMethod] = useState<ConsentInput['method']>('verbal_witnessed');
  const [givenBy, setGivenBy] = useState<ConsentInput['givenBy']>('self');
  const [witness, setWitness] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsWitness = method === 'verbal_witnessed';
  // The common case in one tap: the patient agrees out loud and the person recording it is the witness. Other ways stay one click away.
  const staff = useMe()?.displayName?.trim() || null;
  const [full, setFull] = useState(false);
  async function quickAgree() {
    if (!staff) return;
    setBusy(true); setError(null);
    try { await api.recordConsent(patientId, { purpose, givenBy: 'self', method: 'verbal_witnessed', noticeVersion, witnessName: staff }); onRecorded(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (needsWitness && !witness.trim()) { setError('Enter the name of the witness.'); return; }
    setBusy(true); setError(null);
    try {
      await api.recordConsent(patientId, { purpose, givenBy, method, noticeVersion, ...(needsWitness ? { witnessName: witness.trim() } : {}) });
      onRecorded();
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  const wrap = (n: ReactNode) => (dialog ? <Modal label={texts ? 'Consent for text messages' : remind ? 'Consent for reminders' : ai ? 'Consent to use an outside AI service' : sharing ? 'Consent to share this referral' : 'Consent for triage'} onClose={onCancel}>{n}</Modal> : n);
  if (staff && !full) {
    return wrap(
      <section className="block" aria-label="Consent">
        <div className="block__head"><h3>{texts ? 'Consent for text messages' : remind ? 'Consent for reminders' : ai ? 'Consent to use an outside AI service' : sharing ? 'Consent to share this referral' : 'Consent for triage'}</h3></div>
        <div className="block__body">
          {intro}
          <p className="small">Read this to the patient, or their guardian.</p>
          <blockquote style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--rule-strong)', background: 'var(--paper)' }}>{noticeText}</blockquote>
          <p className="tiny muted">Draft wording ({noticeVersion}). Have it reviewed before use with real patients.</p>
          {error && <Banner kind="error">{error}</Banner>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary btn--big" disabled={busy} onClick={() => void quickAgree()}>{busy ? 'Recording…' : 'Patient agrees'}</button>
            <span className="small muted">Recorded as spoken consent from the patient, witnessed by {staff}.</span>
          </div>
          <p className="tiny"><button type="button" className="linklike" onClick={() => setFull(true)}>A guardian, a paper form, or someone else witnessed it</button></p>
        </div>
      </section>
    );
  }

  return wrap(
    <form className="block" onSubmit={submit} noValidate>
      <div className="block__head"><h3>{texts ? 'Record consent for text messages' : remind ? 'Record consent for reminders' : ai ? 'Record consent to use an outside AI service' : sharing ? 'Record consent to share this referral' : 'Record consent for triage'}</h3></div>
      <div className="block__body">
          {intro}
        <p className="small">Read this to the patient, or their guardian, before recording consent.</p>
        <blockquote style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--rule-strong)', background: 'var(--paper)' }}>{noticeText}</blockquote>
        <p className="tiny muted">Draft wording ({noticeVersion}). Have it reviewed before use with real patients.</p>
        {error && <Banner kind="error">{error}</Banner>}
        <div className="row">
          <div className="field">
            <label htmlFor="c-by">Consent given by</label>
            <select id="c-by" className="select" value={givenBy} onChange={e => setGivenBy(e.target.value as ConsentInput['givenBy'])}>
              <option value="self">The patient</option><option value="guardian">A guardian</option><option value="representative">A representative</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-method">How it was given</label>
            <select id="c-method" className="select" value={method} onChange={e => setMethod(e.target.value as ConsentInput['method'])}>
              <option value="verbal_witnessed">Spoken, with a witness</option><option value="paper">On paper</option><option value="digital">On screen</option>
            </select>
          </div>
        </div>
        {needsWitness && (
          <div className="field">
            <label htmlFor="c-witness">Witness name</label>
            <input id="c-witness" className="input" value={witness} onChange={e => setWitness(e.target.value)} maxLength={120} />
          </div>
        )}
        <div><button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record consent'}</button></div>
      </div>
    </form>
  );
}
