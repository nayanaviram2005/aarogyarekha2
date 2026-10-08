import { useRef } from 'react';
import { KIND_LABEL } from './DocumentsPanel';
import { MAX_FILES, type RecordFile } from '../lib/recordsIntake';
import type { Api, DocumentKind, OcrLanguage, RecordIdentity } from '../lib/types';

let counter = 0;
const STATE: Record<RecordFile['state'], string> = { reading: 'Reading…', read: 'Read', unreadable: 'Could not be read', failed: 'Failed' };

/**
 * Add a patient's records (lab reports, discharge summaries, prescriptions) during intake. Each one is read here and what it says about the
 * person is passed up to fill the form. Nothing is stored until the visit is created; then the files are attached to it.
 */
export function RecordsPicker({ api, files, setFiles, language, onIdentity, disabled = false }: {
  api: Api; files: RecordFile[]; setFiles: (f: (cur: RecordFile[]) => RecordFile[]) => void; language: string; onIdentity?: (i: RecordIdentity) => void; disabled?: boolean;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const patch = (key: string, p: Partial<RecordFile>) => setFiles(fs => fs.map(f => (f.key === key ? { ...f, ...p } : f)));

  async function add(list: FileList | null) {
    if (!list) return;
    const room = Math.max(0, MAX_FILES - files.length);
    const added: RecordFile[] = Array.from(list).slice(0, room).map(file => ({ key: `rf${++counter}`, file, kind: 'lab_report' as DocumentKind, state: 'reading' as const }));
    if (added.length === 0) return;
    setFiles(fs => [...fs, ...added]);
    for (const f of added) {
      try {
        const r = await api.readRecord(f.file, language as OcrLanguage);
        patch(f.key, { state: r.readable ? 'read' : 'unreadable', note: r.note ?? undefined, rows: r.rows });
        if (onIdentity && Object.keys(r.identity).length > 0) onIdentity(r.identity);
      } catch (e) { patch(f.key, { state: 'failed', note: (e as Error).message }); }
    }
  }

  return (
    <div className="field">
      <label htmlFor="rec-files">Patient records (optional)</label>
      <input id="rec-files" ref={pick} className="input" type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={disabled || files.length >= MAX_FILES}
        onChange={e => { void add(e.target.files); if (pick.current) pick.current.value = ''; }} />
      <span className="hint">PDF, JPEG or PNG, up to {MAX_FILES}. They are read here to fill in the details and to give the nurse the results. Nothing is saved until you save the visit.</span>
      {files.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {files.map(f => (
            <li key={f.key} className="small" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--rule)' }}>
              <strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{f.file.name}</strong>
              <select className="select" aria-label={`Kind of ${f.file.name}`} value={f.kind} disabled={disabled} onChange={e => patch(f.key, { kind: e.target.value as DocumentKind })} style={{ width: 'auto' }}>
                {(Object.keys(KIND_LABEL) as DocumentKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <span className="muted">{STATE[f.state]}{f.state === 'read' && f.rows ? ` · ${f.rows} test result${f.rows === 1 ? '' : 's'} found` : ''}{f.note ? ` · ${f.note}` : ''}</span>
              {!disabled && <button type="button" className="btn btn--small btn--quiet" onClick={() => setFiles(fs => fs.filter(x => x.key !== f.key))}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
