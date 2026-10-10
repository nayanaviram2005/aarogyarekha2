import { useEffect, useState } from 'react';
import type { Api, RecordContext } from '../lib/types';
import { Banner } from './Provenance';

export function RecordContextPanel({ api, encounterId, refreshKey = 0 }: { api: Api; encounterId: string; refreshKey?: number }) {
  const [ctx, setCtx] = useState<RecordContext | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.recordContext(encounterId).then(c => { if (live) { setCtx(c); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, encounterId, refreshKey]);

  if (failed) return <p className="tiny muted">The uploaded records could not be loaded.</p>;
  if (!ctx || ctx.summary.documents === 0) return null;
  const s = ctx.summary;
  const unchecked = s.rows - s.verified;
  return (
    <section className="block" aria-label="Records on file">
      <div className="block__head"><h3>Records on file</h3><span className="chip">{s.documents} uploaded</span></div>
      <div className="block__body">
        {s.rows === 0
          ? <p className="small">{s.documents === 1 ? 'The uploaded record has' : 'The uploaded records have'} not been read yet, or no test results were found in {s.documents === 1 ? 'it' : 'them'}. Open "Reports read and timeline" below to read or check {s.documents === 1 ? 'it' : 'them'}.</p>
          : (
            <>
              <p className="small">{s.rows} test result{s.rows === 1 ? '' : 's'} read from {s.read} record{s.read === 1 ? '' : 's'}. {s.flagged === 0 ? 'None are marked outside the printed range.' : `${s.flagged} marked outside the printed range by the lab:`}</p>
              {s.lines.length > 0 && <ul className="small">{s.lines.map(l => <li key={l}>{l}</li>)}</ul>}
              {unchecked > 0 && <Banner kind="warn">{unchecked} result{unchecked === 1 ? ' has' : 's have'} not been checked by a person. Check them against the report before relying on them. The triage engine only uses checked results.</Banner>}
            </>
          )}
        {s.notRead > 0 && s.rows > 0 && <p className="tiny muted">{s.notRead} record{s.notRead === 1 ? ' was' : 's were'} not readable (for example a photo that is too dark). Open it to check by eye.</p>}
        {(s.gaps ?? []).length > 0 && (
          <div role="group" aria-label="What the records cannot tell you yet">
            <h4 className="small strong" style={{ margin: '8px 0 4px' }}>What the records cannot tell you yet</h4>
            <ul className="small">{(s.gaps ?? []).map(g => <li key={g.code + g.text}>{g.text}</li>)}</ul>
          </div>
        )}
        <p className="tiny muted">Copied from the reports as printed. This is not a diagnosis and does not change the priority by itself.</p>
      </div>
    </section>
  );
}
