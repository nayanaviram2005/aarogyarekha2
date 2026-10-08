import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A pop-up over the page, for something that must be answered before work can continue (for example consent). Escape or the Close button
 * dismisses it; focus moves into it and returns to where it was; the page behind does not scroll.
 */
export function Modal({ label, onClose, children }: { label: string; onClose?: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const focusable = box.current?.querySelector<HTMLElement>('button, [href], input, select, textarea');
    (focusable ?? box.current)?.focus();
    const scroll = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = scroll; before?.focus?.(); };
  }, []);
  useEffect(() => {
    if (!onClose) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div ref={box} className="modal__box" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {onClose && <div className="modal__bar"><button type="button" className="btn btn--small btn--quiet" onClick={onClose}>Close</button></div>}
        {children}
      </div>
    </div>
  );
}
