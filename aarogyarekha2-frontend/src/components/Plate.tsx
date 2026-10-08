import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { isTier } from '../lib/format';

/** Each tier has its own SHAPE as well as a colour and a word, so urgency never depends on colour alone. */
const SHAPE: Record<1 | 2 | 3 | 4, ReactNode> = {
  1: <rect x="1" y="1" width="10" height="10" />,                       // square
  2: <polygon points="6,1 11,11 1,11" />,                               // triangle
  3: <circle cx="6" cy="6" r="5" />,                                    // circle
  4: <rect x="0" y="4" width="12" height="4" />,                        // bar
};

export function UrgencyPlate({ tier, assessed = true, large = false }: { tier: number | null; assessed?: boolean; large?: boolean }) {
  const { t } = useI18n();
  if (!assessed || !isTier(tier)) {
    return (
      <span className={`plate plate--none${large ? ' plate--large' : ''}`} role="img" aria-label={t('tier.noneAria')}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" /></svg>
        {t('tier.none')}
      </span>
    );
  }
  const word = t(`tier.${tier}`);
  return (
    <span className={`plate plate--${tier}${large ? ' plate--large' : ''}`} role="img" aria-label={`${t('tier.aria')}: ${word}, ${t('tier.n')} ${tier}`}>
      <svg viewBox="0 0 12 12" aria-hidden="true">{SHAPE[tier]}</svg>
      {word}
    </span>
  );
}
