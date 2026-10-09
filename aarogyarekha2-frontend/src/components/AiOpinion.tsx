import { TIER_WORD } from '../lib/format';
import type { AiOpinionView } from '../lib/types';

const RELATION: Record<AiOpinionView['relation'], string> = {
  agrees: 'The AI model agrees with the rules.',
  raised: 'The AI model saw more urgency than the rules did, so the priority was raised.',
  lower: 'The AI model suggested a lower priority than the rules. The rules result was kept. Only a reviewer can lower it.',
};

export function AiOpinion({ opinion }: { opinion: AiOpinionView }) {
  return (
    <div aria-label="AI second opinion">
      <h4>AI second opinion</h4>
      <p><strong>{TIER_WORD[opinion.tier]}</strong> by the AI model · {TIER_WORD[opinion.rulesTier]} by the rules</p>
      <p>{opinion.reason}</p>
      <p className="small">{RELATION[opinion.relation]}</p>
      <p className="tiny muted">Written by an outside AI model ({opinion.provider}). Not reviewed. It suggests how soon, not what is wrong. It can raise the priority but never lower it.</p>
    </div>
  );
}
