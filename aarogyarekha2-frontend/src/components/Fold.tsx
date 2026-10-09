import { useState, type ReactNode } from 'react';

export function Fold({ title, hint, defaultOpen = false, id, children }: { title: string; hint?: string; defaultOpen?: boolean; id?: string; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="fold" id={id} open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="fold__summary"><span className="fold__title">{title}</span>{hint && <span className="fold__hint small muted">{hint}</span>}</summary>
      {open && <div className="fold__body">{children}</div>}
    </details>
  );
}
