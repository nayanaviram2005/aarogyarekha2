import { useEffect, useState, type ReactNode } from 'react';
import { QueuePane } from './QueuePane';

type Pane = 'queue' | 'note' | 'context';

export function PaneFrame({ center, context, startOn, resetKey }: { center: ReactNode; context: ReactNode; startOn: Pane; resetKey?: string }) {
  const [pane, setPane] = useState<Pane>(startOn);
  useEffect(() => setPane(startOn), [startOn, resetKey]);
  const tab = (id: Pane, label: string) => (
    <button role="tab" aria-selected={pane === id} onClick={() => setPane(id)}>{label}</button>
  );
  return (
    <div className="panes" data-pane={pane}>
      <QueuePane onOpen={() => setPane('note')} />
      <main className="pane pane--center" aria-label="Triage note"><div className="pane__body">{center}</div></main>
      <aside className="pane pane--context" aria-label="Context"><div className="pane__head"><h2>Context</h2></div><div className="pane__body">{context}</div></aside>
      <div className="tabbar" role="tablist" aria-label="Panes">{tab('queue', 'Queue')}{tab('note', 'Note')}{tab('context', 'Context')}</div>
    </div>
  );
}
