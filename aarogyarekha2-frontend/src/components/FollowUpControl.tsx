import { CONSCIOUSNESS, TIER_WORD, isTier } from '../lib/format';
import { VITAL_FIELDS, type Draft } from '../lib/answerDrafts';
import type { Tier } from '../lib/types';

interface Props {
  fieldCode: string; question: string; rank: number; potentialTier: Tier | null; disabled?: boolean;
  /** What the answer is recorded against, in the rules' own short words (so a reworded question can never hide what is being checked). */
  checks?: string | null;
  /** The answer typed or chosen so far. It is only kept on screen until the reviewer presses Submit. */
  draft?: Draft; onDraft: (d: Draft | null) => void;
  /** The same question in the patient's language, for reading aloud. */ translated?: string | null; translatedLang?: 'en' | 'hi' | 'or';
  /** A health worker should leave this one for a nurse or doctor. */ needsClinician?: boolean;
}

/** One follow-up question with the right way to answer it. Choosing an answer only marks it on screen; the reviewer submits all answers together. */
export function FollowUpControl({ fieldCode, question, checks, rank, potentialTier, disabled, draft, onDraft, translated, translatedLang, needsClinician }: Props) {
  const yes = draft?.kind === 'bool' ? draft.value : undefined;
  const pick = (v: boolean) => onDraft(yes === v ? null : { kind: 'bool', value: v });         // pressing the chosen answer again takes it back

  let control: React.ReactNode;
  if (fieldCode.startsWith('sign.') || fieldCode === 'vital.oxygen' || fieldCode === 'context.pregnancy_status') {
    control = <YesNo disabled={disabled} onPick={pick} label={question} value={yes} />;
  } else if (fieldCode === 'vital.consciousness') {
    control = (
      <select className="select" style={{ maxWidth: 280 }} aria-label={question} disabled={disabled} value={draft?.kind === 'level' ? draft.value : ''}
        onChange={e => onDraft(e.target.value ? { kind: 'level', value: e.target.value } : null)}>
        <option value="" disabled>Choose…</option>
        {CONSCIOUSNESS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    );
  } else if (VITAL_FIELDS[fieldCode]) {
    const fields = VITAL_FIELDS[fieldCode]!.kinds;
    const nums = draft?.kind === 'nums' ? draft.value : {};
    const set = (kind: string, v: string) => { const next = { ...nums, [kind]: v }; onDraft(Object.values(next).every(x => x === '') ? null : { kind: 'nums', value: next }); };
    control = (
      <div className="row">
        {fields.map(f => (
          <div className="field" key={f.kind} style={{ flex: '0 1 150px' }}>
            <label htmlFor={`${fieldCode}-${f.kind}`}>{f.label} ({f.unit})</label>
            <input id={`${fieldCode}-${f.kind}`} className="input input--num" inputMode="decimal" value={nums[f.kind] ?? ''} disabled={disabled}
              onChange={e => set(f.kind, e.target.value)} aria-invalid={(nums[f.kind] ?? '') !== '' && !Number.isFinite(Number(nums[f.kind]))} />
          </div>
        ))}
      </div>
    );
  } else {
    control = <p className="small muted">This is taken from the patient record. Ask the registration desk to update it, then assess again.</p>;
  }

  return (
    <li className="q">
      <span className="q__rank" aria-label={`Question ${rank}`}>{rank}</span>
      <div>
        <p className="q__text" id={`q-${fieldCode}`}>{question}</p>
        {checks && checks.toLowerCase() !== question.toLowerCase() && <p className="tiny muted">Checks: {checks}</p>}
        {translated && <p className="q__text" lang={translatedLang} style={{ fontWeight: 500 }}>{translated}</p>}
        {needsClinician && <p className="tiny muted">A nurse or doctor should check this one.</p>}
        {control}
        {isTier(potentialTier) && <p className="q__could">Could change the priority to {TIER_WORD[potentialTier].toLowerCase()}.</p>}
      </div>
    </li>
  );
}

export function YesNo({ onPick, disabled, label, value }: { onPick: (v: boolean) => void; disabled?: boolean; label: string; value?: boolean }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      <button type="button" data-answer="yes" disabled={disabled} aria-pressed={value === true} onClick={() => onPick(true)}>Yes</button>
      <button type="button" data-answer="no" disabled={disabled} aria-pressed={value === false} onClick={() => onPick(false)}>No</button>
    </div>
  );
}
