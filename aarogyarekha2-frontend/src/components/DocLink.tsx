import { useEffect, useState } from 'react';
import type { Api } from '../lib/types';

export interface DocRef { id: string; mimeType: string; name: string | null; kind?: string }

const isPdf = (d: DocRef) => d.mimeType === 'application/pdf';

export function DocLink({ api, doc, variant = 'link', text }: { api: Api; doc: DocRef; variant?: 'link' | 'button'; text?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<{ url: string; name: string } | null>(null);
  const label = doc.name ?? (isPdf(doc) ? 'Report' : 'Photo');
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  async function open() {
    setBusy(true); setError(null);
    try {
      const f = await api.documentFile(doc.id);
      if (isPdf(doc)) {
        const url = URL.createObjectURL(f.blob);
        const tab = window.open(url, '_blank', 'noopener');
        if (!tab) { const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); }
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else setImage({ url: URL.createObjectURL(f.blob), name: label });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      {variant === 'button'
        ? <button type="button" className="btn btn--small" disabled={busy} onClick={() => void open()}>{text ?? (isPdf(doc) ? 'Download' : 'Open')}</button>
        : <button type="button" className="linklike doclink" disabled={busy} aria-label={`Open file ${label}`} title={`Open ${label}`} onClick={e => { e.stopPropagation(); void open(); }}>{busy ? 'Opening…' : text ?? label}</button>}
      {error && <span role="alert" className="tiny" style={{ color: 'var(--urg-red)' }}>{error}</span>}
      {image && (
        <div className="note-overlay" role="dialog" aria-modal="true" aria-label="Uploaded image">
          <div className="note-toolbar"><strong>{image.name}</strong><span className="grow" /><button type="button" className="btn btn--small btn--primary" onClick={() => setImage(null)} autoFocus>Close</button></div>
          <div style={{ flex: 1, overflow: 'auto', display: 'grid', placeItems: 'center', padding: 16 }}><img src={image.url} alt="Uploaded report" style={{ maxWidth: '100%', height: 'auto' }} /></div>
        </div>
      )}
    </>
  );
}
