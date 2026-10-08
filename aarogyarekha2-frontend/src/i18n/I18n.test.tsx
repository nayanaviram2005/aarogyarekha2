import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { UrgencyPlate } from '../components/Plate';
import { I18nProvider, LanguageSwitcher, translate, useI18n } from './I18n';
import { DICTS } from './strings';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('dictionaries', () => {
  it('Hindi and Odia have every key English has, none empty, with the same {placeholders}', () => {
    for (const lang of ['hi', 'or'] as const) for (const [k, en] of Object.entries(DICTS.en)) {
      const v = (DICTS[lang] as Record<string, string>)[k];
      expect(v, `${lang}:${k}`).toBeTruthy();
      expect(placeholders(v!), `${lang}:${k}`).toBe(placeholders(en));
    }
  });
  it('Hindi and Odia text is actually in their own script, apart from the product name', () => {
    for (const k of ['tier.1', 'queue.title', 'signin.submit', 'shell.legal'] as const) {
      expect(DICTS.hi[k]).toMatch(/[ऀ-ॿ]/); expect(DICTS.or[k]).toMatch(/[଀-୿]/);
    }
  });
  it('the non-diagnostic notice is present in every language', () => {
    for (const l of ['en', 'hi', 'or'] as const) { expect(DICTS[l]['shell.legal'].length).toBeGreaterThan(30); expect(DICTS[l]['signin.foot'].length).toBeGreaterThan(30); }
  });
});

describe('translate', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'queue.waiting', { n: 3 })).toBe('3 waiting');
    expect(translate('hi', 'queue.waiting', { n: 3 })).toBe('3 प्रतीक्षा में');
  });
  it('leaves an unknown placeholder visible rather than printing "undefined"', () => {
    expect(translate('en', 'queue.couldBe', { tier: 'urgent' })).toBe('Could be urgent · {n} still needed');
  });
  it('falls back to English, then to the key, never blank', () => {
    const saved = DICTS.hi['tier.1']; (DICTS.hi as Record<string, string>)['tier.1'] = '';
    try { expect(translate('hi', 'tier.1')).toBe('Immediate'); }
    finally { (DICTS.hi as Record<string, string>)['tier.1'] = saved; }
    expect(translate('en', 'nope' as never)).toBe('nope');
  });
});

function Probe() { const { t } = useI18n(); return <p>{t('queue.title')}</p>; }

describe('provider and switcher', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.lang = ''; });
  it('works with no provider, in English', () => {
    render(<Probe />); expect(screen.getByText('Queue')).toBeInTheDocument();
  });
  it('switching changes the text, the page language, and is remembered', async () => {
    const { unmount } = render(<I18nProvider><LanguageSwitcher /><Probe /></I18nProvider>);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'or');
    expect(screen.getByText('ଧାଡ଼ି')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('or');
    unmount();
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText('ଧାଡ଼ି')).toBeInTheDocument();
  });
  it('ignores a junk stored value', () => {
    localStorage.setItem('aarogyarekha.ui-language', 'xx');
    render(<I18nProvider><Probe /></I18nProvider>); expect(screen.getByText('Queue')).toBeInTheDocument();
  });
  it('the urgency plate keeps its shape and tier number in every language', async () => {
    localStorage.setItem('aarogyarekha.ui-language', 'hi');
    render(<I18nProvider><UrgencyPlate tier={1} /></I18nProvider>);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'तात्कालिकता: तत्काल, स्तर 1');
  });
});
