import { useState, type ReactNode } from 'react';

/**
 * A closed-by-default section. Its content is not even built until it is opened, so a screen with several of these loads fewer things
 * and keeps the main steps in view. The title says what is inside; `hint` says when you would want it.
 */
export function Fold({ title, hint, defaultOpen = false, id, children }: { title: string; hint?: string; defaultOpen?: boolean; id?: string; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="fold" id={id} open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="fold__summary"><span className="fold__title">{title}</span>{hint && <span className="fold__hint small muted">{hint}</span>}</summary>
      {open && <div className="fold__body">{children}</div>}
    </details>
  );
}
