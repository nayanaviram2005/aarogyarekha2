import { TEMPLATES } from '../lib/scenarioTemplates';

/** The extra questions for a visit type. Answers are kept by the caller and saved as ordinary notes. */
export function TemplateFields({ scenario, values, onChange, lang, disabled }: { scenario: string; values: Record<string, string>; onChange: (v: Record<string, string>) => void; lang: string; disabled?: boolean }) {
  const t = TEMPLATES[scenario]; if (!t || t.fields.length === 0) return null;
  const set = (k: string, v: string) => onChange({ ...values, [k]: v });
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={disabled} aria-label="Questions for this type of visit">
      <legend className="strong small" style={{ padding: 0, marginBottom: 8 }}>For this type of visit</legend>
      <div className="grid2">
        {t.fields.map(f => (
          <div className="field" key={f.key}>
            <label htmlFor={`tpl-${f.key}`}>{f.label}</label>
            {f.options
              ? <select id={`tpl-${f.key}`} className="select" value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}><option value="">Not asked</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
              : <input id={`tpl-${f.key}`} className="input" lang={lang} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} maxLength={300} />}
            {f.hint && <span className="tiny muted">{f.hint}</span>}
          </div>
        ))}
      </div>
      <p className="tiny muted">Saved as ordinary notes on the record. They do not change the priority.</p>
    </fieldset>
  );
}
