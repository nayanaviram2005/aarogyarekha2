import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DICTS, LANGS, type Key, type Lang } from './strings';

type Vars = Record<string, string | number>;
interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (key: Key, vars?: Vars) => string }

const STORE = 'aarogyarekha.ui-language';           // a screen-language preference only; no patient data
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'hi' || v === 'or';

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const raw = DICTS[lang][key] || DICTS.en[key] || key;       // never show a blank: fall back to English, then the key
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
}

// Works without a provider (English), so a component can be rendered on its own.
const I18nContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v) });
export const useI18n = () => useContext(I18nContext);

function initial(): Lang {
  try { const s = localStorage.getItem(STORE); if (isLang(s)) return s; } catch { /* storage blocked */ }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem(STORE, l); } catch { /* storage blocked */ } }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Plain select that switches the screen language. Each language is named in its own script. */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span className="lang-switch__label">{t('lang.label')}</span>
      <select className="select" value={lang} onChange={e => setLang(e.target.value as Lang)} aria-label="Language / भाषा / ଭାଷା">
        {LANGS.map(l => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
