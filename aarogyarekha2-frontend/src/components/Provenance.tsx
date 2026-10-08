import type { ReactNode } from 'react';

/** Marks machine-produced content. Hatched until a qualified person signs it; solid once they have. */
export function Provenance({ reviewedBy, reviewedAt, children, label }: { reviewedBy?: string | null; reviewedAt?: string | null; children: ReactNode; label?: string }) {
  const reviewed = !!reviewedBy;
  return (
    <section className={`prov ${reviewed ? 'prov--reviewed' : 'prov--draft'}`} aria-label={label}>
      <div className="prov__status">
        {reviewed ? <span>Reviewed by {reviewedBy}{reviewedAt ? `, ${reviewedAt}` : ''}</span> : <span>Draft, not reviewed</span>}
      </div>
      <div className="prov__body">{children}</div>
    </section>
  );
}

export function Banner({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'error'; title?: string; children?: ReactNode }) {
  return (
    <div className={`banner banner--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <p className="banner__title">{title}</p>}
      {children && <div className="small">{children}</div>}
    </div>
  );
}
