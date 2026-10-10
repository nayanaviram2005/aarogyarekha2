import { Fragment, useState } from 'react';
import { TIER_WORD } from '../lib/format';
import type { DecisionLogEntry } from '../lib/types';

const WHAT: Record<string, string> = {
  floor: 'A danger sign. When it is answered Yes, it sets the lowest priority the patient can have.',
  news2: 'An early-warning score added up from the patient’s measurements (adults and teenagers).',
  paed_vitals: 'Limits for a child’s pulse, breathing rate and oxygen, set by age.',
  pregnancy_bp: 'A blood pressure limit for pregnancy.',
  external: 'The triage engine’s extended check of the case details. It can only raise the priority.',
  insufficient_data: 'Used when nothing has been measured or answered yet.',
  default: 'Used when none of the other checks found an urgent sign.',
};

export const ruleName = (l: DecisionLogEntry) => (l.ruleId.startsWith('EXT-') ? 'Triage engine' : l.ruleId);

export function DecisionTable({ log, ruleSet }: { log: DecisionLogEntry[]; ruleSet: { name: string; version: string; status: string } }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <table className="table" style={{ marginTop: 8 }}>
        <thead><tr><th>Rule</th><th>Result</th><th>Detail</th></tr></thead>
        <tbody>
          {log.map((l, i) => (
            <Fragment key={i}>
              <tr>
                <td>
                  {ruleName(l)}{' '}
                  <button type="button" className="btn btn--small btn--quiet infobtn" aria-expanded={open === i} aria-controls={`rule-info-${i}`} aria-label={`About rule ${ruleName(l)}`} onClick={() => setOpen(o => (o === i ? null : i))}>i</button>
                </td>
                <td>{TIER_WORD[l.tier]}</td>
                <td>{l.detail}</td>
              </tr>
              {open === i && (
                <tr id={`rule-info-${i}`}>
                  <td colSpan={3} className="ruleinfo">
                    <dl>
                      <dt>What this rule checks</dt><dd>{WHAT[l.layer] ?? l.detail}</dd>
                      <dt>In this patient’s case</dt><dd>{l.why ?? l.detail}</dd>
                      <dt>Where it comes from</dt><dd>{l.source ?? 'Not recorded for this earlier assessment. Assess again to see it.'}</dd>
                      <dt>Result</dt><dd>{TIER_WORD[l.tier]}</dd>
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="tiny muted" style={{ marginTop: 8 }}>The most urgent result wins. Rules: {ruleSet.name} {ruleSet.version} ({ruleSet.status}).</p>
    </>
  );
}
