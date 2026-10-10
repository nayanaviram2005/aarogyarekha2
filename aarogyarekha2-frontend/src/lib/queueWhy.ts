import type { QueueEntry } from './types';

type WhyEntry = Pick<QueueEntry, 'order' | 'assessed' | 'vulnerable' | 'patient' | 'winningLabel' | 'potentialTier' | 'missingCount' | 'tier'>;
type Name = (tier: number) => string;

const YOUNG_OLD_PREGNANT = 'a young child, older adult or pregnant';

function ahead(a: WhyEntry, b: WhyEntry, tier: Name): string {
  const ao = a.order!, bo = b.order!;
  if (ao.effectiveTier !== bo.effectiveTier) return `${tier(ao.effectiveTier)} comes before ${tier(bo.effectiveTier)}`;
  if (a.assessed !== b.assessed) return a.assessed ? `${b.patient.full_name} is not assessed yet, and not-assessed patients go first` : `${a.patient.full_name} is not assessed yet, and not-assessed patients go first`;
  if (a.vulnerable !== b.vulnerable) return `${(a.vulnerable ? a : b).patient.full_name} is ${YOUNG_OLD_PREGNANT}, and those patients go first`;
  return `${a.patient.full_name} has waited longer (${ao.waitedMin} min, against ${bo.waitedMin} min)`;
}

export function whyLines(e: WhyEntry, prev: WhyEntry | null, next: WhyEntry | null, tier: Name): string[] | null {
  const o = e.order; if (!o) return null;
  const lines: string[] = [];
  const level = tier(o.effectiveTier);
  const head = e.assessed
    ? `#${o.position} of ${o.of}: ${level}${e.winningLabel ? `, because ${e.winningLabel.charAt(0).toLowerCase()}${e.winningLabel.slice(1)}` : ''}.`
    : `#${o.position} of ${o.of}: not assessed yet, so placed at ${level} until it is.`;
  lines.push(head + (o.promoted ? ` Moved up from ${tier(4)} after waiting ${o.waitedMin} min.` : ''));
  if (prev?.order) {
    const same = prev.order.effectiveTier === o.effectiveTier;
    lines.push(`Behind ${prev.patient.full_name} (${tier(prev.order.effectiveTier)})${same ? ', same level' : ''}: ${ahead(prev, e, tier)}.`);
  }
  if (next?.order) lines.push(`Ahead of ${next.patient.full_name} (${tier(next.order.effectiveTier)}): ${ahead(e, next, tier)}.`);
  if (e.assessed && e.tier != null && e.potentialTier != null && e.potentialTier < e.tier && e.missingCount > 0)
    lines.push(`Could move up to ${tier(e.potentialTier)} if ${e.missingCount === 1 ? 'the open question is' : `the ${e.missingCount} open questions are`} answered.`);
  return lines;
}
