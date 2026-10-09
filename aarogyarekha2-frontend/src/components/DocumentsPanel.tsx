import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Api, DocumentKind, DocumentMeta, ExtractedField, Extraction, OcrLanguage } from '../lib/types';
import { formatTime, languageLabel } from '../lib/format';
import { compressImage } from '../lib/compress';
import { useLowData } from '../lib/lowBandwidth';
import { Banner } from './Provenance';

export const KIND_LABEL: Record<DocumentKind, string> = {
  lab_report: 'Lab report', prescription: 'Prescription', discharge_summary: 'Discharge summary', imaging_report: 'Imaging report',
  vaccination_record: 'Vaccination record', referral_letter: 'Referral letter', photo: 'Photo', other: 'Other',
};
export const MAX_MB = 10;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const VITAL_FOR_TEST: Record<string, string> = { temperature: 'temperature_c', pulse: 'pulse_bpm', spo2: 'spo2_pct' };
const LANGS: OcrLanguage[] = ['en', 'hi', 'or'];

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const labelOf = (name: string) => name.replace(/_/g, ' ');

interface Props { api: Api; encounterId: string; editable: boolean; onMeasurementAdded?: () => void; onReadingChanged?: () => void }

export function DocumentsPanel({ api, encounterId, editable, onMeasurementAdded, onReadingChanged }: Props) {
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<DocumentKind>('lab_report');
  const [lowData] = useLowData();
  const [notice, setNotice] = useState<string | null>(null);
  const [photoWarnings, setPhotoWarnings] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Extraction | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [lang, setLang] = useState<OcrLanguage>('en');
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setDocs(await api.documents(encounterId)); setError(null); } catch (e) { setError(e as Error); setDocs(d => d ?? []); }
  }, [api, encounterId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    setNotice(null); setPhotoWarnings([]);
    if (!f) { setError(new Error('Choose a file first.')); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setError(new Error(`The file is larger than ${MAX_MB} MB.`)); return; }
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) { setError(new Error('Only PDF, JPEG and PNG files are accepted.')); return; }
    setUploading(true); setError(null);
    try {
      const small = await compressImage(f, lowData);
      const r = await api.uploadDocument(encounterId, small, kind);
      setPhotoWarnings((r.quality?.warnings ?? []).map(w => w.text));
      setNotice(r.metadataBytesRemoved > 0 ? 'Uploaded. Hidden details in the photo (such as location) were removed before it was stored.' : 'Uploaded and checked.');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) { setError(err as Error); } finally { setUploading(false); }
  }

  async function show(d: DocumentMeta) {
    setOpen(o => (o === d.id ? null : d.id));
    if (results[d.id] === undefined) { try { setResults(r => ({ ...r, [d.id]: null })); const x = await api.extraction(d.id); setResults(r => ({ ...r, [d.id]: x })); } catch (e) { setError(e as Error); } }
  }
  async function read(d: DocumentMeta) {
    setBusy(d.id); setError(null); setOpen(d.id);
    try { const x = await api.extractDocument(d.id, lang); setResults(r => ({ ...r, [d.id]: x })); onReadingChanged?.(); }
    catch (e) { setError(e as Error); } finally { setBusy(null); }
  }
  async function openFile(d: DocumentMeta) {
    setBusy(d.id); setError(null);
    try {
      const f = await api.documentFile(d.id);
      if (d.mimeType === 'application/pdf') {
        const url = URL.createObjectURL(f.blob); const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } else setImage({ url: URL.createObjectURL(f.blob), name: d.filename ?? KIND_LABEL[d.kind] });
    } catch (e) { setError(e as Error); } finally { setBusy(null); }
  }

  return (
    <section className="block" aria-label="Reports and photos">
      <div className="block__head"><h3>Reports and photos</h3>{docs && <span className="chip">{docs.length}</span>}</div>
      <div className="block__body">
        {error && <Banner kind="error" title="Not completed">{error.message} <span className="small">You can also type the values in under Add a measurement.</span></Banner>}
        {notice && <Banner kind="info">{notice}</Banner>}
        {photoWarnings.length > 0 && <Banner kind="warn" title="This picture may be hard to read"><ul>{photoWarnings.map(w => <li key={w}>{w}</li>)}</ul>It was saved. You can upload a better one too.</Banner>}

        {editable ? (
          <form onSubmit={upload} className="row" aria-label="Upload a report" noValidate>
            <div className="field" style={{ flex: '2 1 220px' }}>
              <label htmlFor="doc-file">Choose a report or photo</label>
              <input id="doc-file" ref={fileRef} className="input" type="file" accept={ACCEPT} disabled={uploading} />
              <span className="hint">PDF, JPEG or PNG, up to {MAX_MB} MB. Photos are cleaned of location and camera details before they are stored.</span>
            </div>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="doc-kind">What is it</label>
              <select id="doc-kind" className="select" value={kind} onChange={e => setKind(e.target.value as DocumentKind)} disabled={uploading}>
                {(Object.keys(KIND_LABEL) as DocumentKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <button className="btn btn--primary" type="submit" disabled={uploading}>{uploading ? 'Checking and uploading…' : 'Upload'}</button>
          </form>
        ) : <p className="small muted">Files cannot be added to this encounter.</p>}

        {docs && docs.length === 0 && <p className="small muted">No reports or photos uploaded yet.</p>}
        <ul>
          {(docs ?? []).map(d => (
            <li key={d.id} style={{ borderTop: '1px solid var(--rule)', padding: '12px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong>{d.filename ?? KIND_LABEL[d.kind]}</strong>
                <span className="small muted">{KIND_LABEL[d.kind]} · {size(d.sizeBytes)} · {formatTime(d.createdAt)}</span>
                <span className={`chip ${d.status === 'clean' ? 'chip--ok' : 'chip--warn'}`}>{d.status === 'clean' ? 'Checked' : 'Not accepted'}</span>
              </div>
              {d.status === 'clean' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                  <button className="btn btn--small" disabled={busy === d.id} onClick={() => void openFile(d)}>{d.mimeType === 'application/pdf' ? 'Download' : 'Open'}</button>
                  <button className="btn btn--small" aria-expanded={open === d.id} onClick={() => void show(d)}>{open === d.id ? 'Hide results' : 'Show results'}</button>
                  {editable && (
                    <>
                      <select aria-label="Language of the report" className="select" style={{ width: 'auto', minHeight: 32 }} value={lang} onChange={e => setLang(e.target.value as OcrLanguage)}>
                        {LANGS.map(l => <option key={l} value={l}>{languageLabel(l)}</option>)}
                      </select>
                      <button className="btn btn--small btn--primary" disabled={busy === d.id} onClick={() => void read(d)}>{busy === d.id ? 'Reading…' : 'Read results'}</button>
                    </>
                  )}
                </div>
              )}
              {open === d.id && <Results api={api} doc={d} data={results[d.id]} editable={editable}
                onChanged={async () => { const x = await api.extraction(d.id).catch(() => null); setResults(r => ({ ...r, [d.id]: x })); onReadingChanged?.(); }}
                onMeasurement={onMeasurementAdded} />}
            </li>
          ))}
        </ul>
      </div>
      {image && (
        <div className="note-overlay" role="dialog" aria-modal="true" aria-label="Uploaded image">
          <div className="note-toolbar"><strong>{image.name}</strong><span className="grow" /><button className="btn btn--small btn--primary" onClick={() => setImage(null)} autoFocus>Close</button></div>
          <div style={{ flex: 1, overflow: 'auto', display: 'grid', placeItems: 'center', padding: 16 }}><img src={image.url} alt="Uploaded report" style={{ maxWidth: '100%', height: 'auto' }} /></div>
        </div>
      )}
    </section>
  );
}

function Results({ api, doc, data, editable, onChanged, onMeasurement }: { api: Api; doc: DocumentMeta; data: Extraction | null | undefined; editable: boolean; onChanged: () => Promise<void>; onMeasurement?: () => void }) {
  if (data === undefined || data === null) return <p className="small muted" style={{ marginTop: 8 }}>{data === null ? 'No results read yet. Choose the language and press Read results.' : 'Loading…'}</p>;
  if (data.status === 'failed') return <Banner kind="warn" title="Could not read this file">{data.error ?? 'Try a clearer photo.'}</Banner>;
  return (
    <div style={{ marginTop: 8 }}>
      <p className="small muted" style={{ marginBottom: 8 }}>Copied from the report, not interpreted. Compare each row with the original, then confirm it. Read by {data.engine}.</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Test</th><th className="num">Value</th><th>Reference (as printed)</th><th>Printed flag</th><th>Confirm</th></tr></thead>
          <tbody>{data.fields.map(f => <Row key={f.id} api={api} docId={doc.id} f={f} editable={editable} onChanged={onChanged} onMeasurement={onMeasurement} encounterId={doc.encounterId} />)}</tbody>
        </table>
      </div>
    </div>
  );
}

const AGREEMENT_TEXT: Record<NonNullable<ExtractedField['agreement']>, { chip: string; text: (v: string | null) => string; warn: boolean }> = {
  agree: { chip: 'Two readers agree', text: () => 'The local reader and the AI model read the same number.', warn: false },
  differ: { chip: 'Readers differ', text: v => `The AI model read ${v ?? 'a different value'}. Check the original report.`, warn: true },
  ai_only: { chip: 'AI only', text: v => `Only the AI model found this row (value read: ${v ?? 'unclear'}). Check it against the report.`, warn: true },
  ocr_only: { chip: 'Local reader only', text: () => 'The AI model did not read this row.', warn: false },
};
function SecondRead({ f }: { f: ExtractedField }) {
  if (!f.agreement) return null;
  const a = AGREEMENT_TEXT[f.agreement];
  return <div className="tiny" style={{ marginTop: 4 }}><span className={a.warn ? 'chip chip--warn' : 'chip'}>{a.chip}</span> <span className="muted">{a.text(f.secondRead ?? null)}</span></div>;
}

function Row({ api, docId, f, editable, onChanged, onMeasurement, encounterId }: { api: Api; docId: string; f: ExtractedField; editable: boolean; onChanged: () => Promise<void>; onMeasurement?: () => void; encounterId: string | null }) {
  const [val, setVal] = useState(f.valueNum != null ? String(f.valueNum) : f.valueText ?? '');
  const [unit, setUnit] = useState(f.unit ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const vital = VITAL_FOR_TEST[f.name];
  const low = (f.confidence ?? 1) < 0.7;
  const num = Number(val);
  const valid = val.trim() !== '' && (Number.isFinite(num) || !/^\s*[-+]?[\d.,]+\s*$/.test(val));

  async function confirm() {
    setBusy(true); setErr(null);
    try { await api.verifyField(docId, f.id, Number.isFinite(num) && val.trim() !== '' ? { valueNum: num, unit: unit.trim() || null } : { valueText: val.trim(), unit: unit.trim() || null }); await onChanged(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function useAsMeasurement() {
    if (!vital || !encounterId || !Number.isFinite(num)) return;
    setBusy(true); setErr(null);
    try { await api.addVital(encounterId, { kind: vital, value: num }); onMeasurement?.(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <tr>
      <td>
        <strong>{labelOf(f.name)}</strong>
        <div className="tiny muted" title="The line as printed">{f.printedLine}</div>
        {low && <span className="chip chip--warn">Check this row carefully</span>}
        <SecondRead f={f} />
      </td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        {editable ? (
          <>
            <input aria-label={`Value for ${labelOf(f.name)}`} className="input input--num" style={{ width: 90, minHeight: 32 }} value={val} onChange={e => setVal(e.target.value)} />{' '}
            <input aria-label={`Unit for ${labelOf(f.name)}`} className="input" style={{ width: 80, minHeight: 32, display: 'inline-block' }} value={unit} onChange={e => setUnit(e.target.value)} />
          </>
        ) : <>{f.valueNum ?? f.valueText} {f.unit}</>}
      </td>
      <td>{f.referenceRange ?? <span className="muted">none printed</span>}</td>
      <td>{f.printedFlag ?? <span className="muted">none printed</span>}</td>
      <td>
        {f.verified ? <span className="chip chip--ok">Verified {formatTime(f.verifiedAt)}</span> : <span className="chip">Not verified</span>}
        {editable && <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="btn btn--small" disabled={busy || !valid} onClick={() => void confirm()}>{f.verified ? 'Confirm again' : 'Confirm'}</button>
          {f.verified && vital && <button className="btn btn--small btn--quiet" disabled={busy} onClick={() => void useAsMeasurement()}>Use as measurement</button>}
        </div>}
        {err && <div role="alert" className="small" style={{ color: 'var(--urg-red)', fontWeight: 500 }}>{err}</div>}
      </td>
    </tr>
  );
}
