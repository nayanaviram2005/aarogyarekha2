import type { AiOpinionView } from '../lib/types';

export function AiOpinion({ opinion }: { opinion: AiOpinionView }) {
  return (
    <div aria-label="Triage engine output">
      <h4>Triage engine output</h4>
      <p>{opinion.reason}</p>
      {opinion.relation === 'raised' && <p className="small">The engine found more urgency than the basic checks alone, so the priority was raised.</p>}
      {opinion.relation === 'lower' && <p className="small">The engine suggested a lower priority. The higher result was kept. Only a reviewer can lower it.</p>}
      <p className="tiny muted">Machine-generated and not reviewed. It suggests how soon, not what is wrong. It can raise the priority but never lower it.</p>
    </div>
  );
}
