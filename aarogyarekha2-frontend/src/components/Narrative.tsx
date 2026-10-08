import { Fragment, type ReactNode } from 'react';

/**
 * Shows a FHIR narrative (an XHTML <div>) WITHOUT putting its markup into the page.
 * The string is parsed into a detached document and rebuilt as React elements from an allow-list: paragraphs, lists,
 * bold and italic. Anything else (scripts, images, links, event handlers, unknown tags) is dropped and only its text is kept.
 */
const ALLOWED: Record<string, string> = { P: 'p', UL: 'ul', OL: 'ol', LI: 'li', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', BR: 'br' };

function render(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = ALLOWED[el.tagName.toUpperCase()];
  const kids = [...el.childNodes].map((c, i) => render(c, `${key}.${i}`));
  if (!tag) return el.tagName.toUpperCase() === 'SCRIPT' || el.tagName.toUpperCase() === 'STYLE' ? null : <Fragment key={key}>{kids}</Fragment>;
  if (tag === 'br') return <br key={key} />;
  const Tag = tag as 'p';
  return <Tag key={key}>{kids}</Tag>;
}

export function Narrative({ xhtml }: { xhtml: string }) {
  const doc = new DOMParser().parseFromString(xhtml, 'text/html');
  return <>{[...doc.body.childNodes].map((n, i) => render(n, String(i)))}</>;
}
