import { glossaryMatches } from '../lib/glossary';
import { languageSuggestion } from '../lib/langDetect';

/** Two small helps under what was typed: a language suggestion, and everyday words matched to plain English. Neither changes anything on its own. */
export function TextHints({ text, language, onPickLanguage }: { text: string; language: string; onPickLanguage?: (l: 'en' | 'hi' | 'or') => void }) {
  const sug = onPickLanguage ? languageSuggestion(text, language) : null;
  const terms = glossaryMatches(text);
  if (!sug && terms.length === 0) return null;
  return (
    <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sug && <p role="status">{sug.message} <button type="button" className="btn btn--small" onClick={() => onPickLanguage!(sug.lang)}>Use {{ en: 'English', hi: 'Hindi', or: 'Odia' }[sug.lang]}</button></p>}
      {terms.length > 0 && <p className="tiny muted" aria-label="Common terms">Common words found: {terms.map(t => <span key={t} className="chip" style={{ marginRight: 4 }}>{t}</span>)} A word lookup only. It is not a diagnosis.</p>}
    </div>
  );
}
