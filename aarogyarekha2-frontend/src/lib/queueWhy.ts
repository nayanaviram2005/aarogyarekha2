import type { QueueEntry } from './types';

export function whyText(e: Pick<QueueEntry, 'order' | 'assessed' | 'vulnerable'>, tierName: (tier: number) => string): string | null {
  const o = e.order; if (!o) return null;
  const behind = `Behind #${o.position - 1}`;
  const moved = o.promoted ? ` Moved up from ${tierName(4)} after waiting ${o.waitedMin} min.` : '';
  switch (o.why) {
    case 'first': return `#1: ${tierName(o.effectiveTier)}${e.assessed ? '' : ', not assessed yet'}${e.vulnerable ? ', young child, older adult or pregnant' : ''}.${moved}`;
    case 'tier': return `#${o.position} of ${o.of}. ${behind}: that patient has a more urgent priority level.${moved}`;
    case 'unassessed': return `#${o.position} of ${o.of}. ${behind}: same level, and that patient is not assessed yet (not-assessed patients go first).${moved}`;
    case 'vulnerable': return `#${o.position} of ${o.of}. ${behind}: same level, and that patient is a young child, older adult or pregnant.${moved}`;
    default: return `#${o.position} of ${o.of}. ${behind}: same level, and that patient has waited longer.${moved}`;
  }
}
