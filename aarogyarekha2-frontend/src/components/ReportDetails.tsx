import { useEffect, useState } from 'react';
import { formatTime } from '../lib/format';
import type { Api, DocumentMeta, Extraction } from '../lib/types';

const AGREE: Record<string, string> = { agree: 'Two readers agree', differ: 'Readers differ', ai_only: 'AI only', ocr_only: 'Local reader only' };

/**
 * The key details read from this encounter's reports, in one place. Values are copied as the report printed them: the printed range
 * and flag are shown as printed and never judged. A row is marked until a person has verified it.
 */
export function ReportDetails({ api, encounterId, refreshKey = 0 }: { api: Api; encounterId: string; refreshKey?: number }) {
  const [reads, setReads] = useState<{ doc: DocumentMeta; x: Extraction }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const docs = (await api.documents(encounterId)).filter(d => d.status === 'clean');
        const got = await Promise.all(docs.map(async doc => ({ doc, x: await api.extraction(doc.id).catch(() => null) })));
        if (live) { setReads(got.filter((g): g is { doc: DocumentMeta; x: Extraction } => !!g.x && g.x.status === 'completed' && g.x.fields.length > 0)); setError(null); }
      } catch (e) { if (live) setError((e as Error).message); }
    })();
    return () => { live = false; };
  }, [api, encounterId, refreshKey]);

  const rows = (reads ?? []).flatMap(r => r.x.fields.map(f => ({ ...f, doc: r.doc })));
  const verified = rows.filter(r => r.verified).length;

  return (
    <section className="block" aria-label="Key details from reports">
      <div className="block__head"><h3>Key details from reports</h3>{rows.length > 0 && <span className="chip">{verified} of {rows.length} verified</span>}</div>
      <div className="block__body block__body--flush">
        {error && <p className="small" role="alert" style={{ padding: 12 }}>{error}</p>}
        {reads === null && !error && <p className="small muted" role="status" style={{ padding: 12 }}>Loading…</p>}
        {reads && reads.length === 0 && !error && <p className="small muted" style={{ padding: 12 }}>No report has been read yet. Upload a report and press Read results below.</p>}
        {rows.length > 0 && (
          <>
            <p className="tiny muted" style={{ padding: '8px 12px 0' }}>Copied from the report as printed. Not interpreted. A row marked "Not verified" has not been checked by a person: do not rely on it yet.</p>
            <table className="table">
              <thead><tr><th>Test</th><th className="num">Value</th><th>Printed range</th><th>Printed flag</th><th>Status</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id} style={r.verified ? undefined : { opacity: 0.8 }}>
                  <td><strong>{r.name.replace(/_/g, ' ')}</strong>{reads && reads.length > 1 && <div className="tiny muted">{r.doc.filename ?? 'Report'} · {formatTime(r.doc.createdAt)}</div>}</td>
                  <td className="num">{r.valueNum ?? r.valueText} {r.unit}</td>
                  <td>{r.referenceRange ?? <span className="muted">none printed</span>}</td>
                  <td>{r.printedFlag ?? <span className="muted">none printed</span>}</td>
                  <td>{r.verified ? <span className="chip chip--ok">Verified</span> : <span className="chip chip--warn">Not verified</span>}{r.agreement && <div className="tiny muted">{AGREE[r.agreement]}</div>}</td>
                </tr>))}</tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}
