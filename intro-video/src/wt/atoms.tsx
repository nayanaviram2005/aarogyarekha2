import type { CSSProperties, ReactNode } from 'react';
import { COLOR, FONT, TIER, type Tier } from '../tokens';

// Small pieces of the app drawn at real screen size (body text 18 px), so the camera can zoom in on them.

const SHAPE: Record<Tier, ReactNode> = {
  1: <rect x="1" y="1" width="10" height="10" />,
  2: <polygon points="6,1 11,11 1,11" />,
  3: <circle cx="6" cy="6" r="5" />,
  4: <rect x="0" y="4" width="12" height="4" />,
};

/** The priority plate: shape, colour and word. */
export const WPlate = ({ tier, size = 17 }: { tier: Tier; size?: number }) => {
  const t = TIER[tier];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.5, padding: `${size * 0.22}px ${size * 0.6}px`, border: `1.5px solid ${t.color}`, background: t.tint, color: t.color, fontWeight: 700, fontSize: size, borderRadius: 2, whiteSpace: 'nowrap' }}>
      <svg width={size * 0.85} height={size * 0.85} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">{SHAPE[tier]}</svg>
      {t.word}
    </span>
  );
};

export const WNotAssessed = ({ size = 17 }: { size?: number }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.5, padding: `${size * 0.22}px ${size * 0.6}px`, border: `1.5px dashed ${COLOR.rule}`, color: COLOR.muted, fontWeight: 600, fontSize: size, borderRadius: 2, whiteSpace: 'nowrap' }}>
    <svg width={size * 0.85} height={size * 0.85} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" aria-hidden="true"><rect x="1" y="1" width="10" height="10" /></svg>
    Not assessed
  </span>
);

export const WChip = ({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'action' | 'warn' | 'ok' }) => {
  const c = tone === 'action' ? COLOR.action : tone === 'warn' ? COLOR.yellow : tone === 'ok' ? COLOR.green : COLOR.muted;
  const bg = tone === 'action' ? COLOR.actionTint : tone === 'warn' ? COLOR.yellowTint : tone === 'ok' ? COLOR.greenTint : COLOR.panel;
  return <span style={{ display: 'inline-block', padding: '2px 9px', border: `1.5px solid ${tone === 'plain' ? COLOR.rule : c}`, background: bg, color: c, fontWeight: 600, fontSize: 14, borderRadius: 2, whiteSpace: 'nowrap' }}>{children}</span>;
};

export const WBtn = ({ label, primary = false, w, h = 44, scale = 1, style }: { label: string; primary?: boolean; w?: number; h?: number; scale?: number; style?: CSSProperties }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: w, height: h, padding: '0 20px', fontSize: 18, fontWeight: 700, border: `1.5px solid ${primary ? COLOR.action : COLOR.rule}`, background: primary ? COLOR.action : COLOR.panel, color: primary ? COLOR.actionInk : COLOR.ink, borderRadius: 2, scale, whiteSpace: 'nowrap', ...style }}>{label}</span>
);

export const WBox = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: COLOR.panel, border: `1.5px solid ${COLOR.rule}`, borderRadius: 2, ...style }}>{children}</div>
);

export const WLabel = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: COLOR.muted }}>{children}</span>
);

export const WInput = ({ text, placeholder = '', w, h = 48, hindi = false }: { text: string; placeholder?: string; w?: number | string; h?: number; hindi?: boolean }) => (
  <span style={{ display: 'flex', alignItems: 'center', width: w, height: h, padding: '0 14px', border: `1.5px solid ${COLOR.rule}`, background: COLOR.panel, fontSize: 18, fontWeight: 600, fontFamily: hindi ? FONT.devanagari : FONT.sans, color: text ? COLOR.ink : COLOR.muted, borderRadius: 2, whiteSpace: 'nowrap', overflow: 'hidden' }}>{text || placeholder}</span>
);

export const WCheck = ({ size = 22, color = COLOR.green }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);

/** A mouse pointer, drawn at the camera's scale. */
export const Pointer = () => (
  <svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M3 2v28l7-7 5 11 5-2-5-11h10z" fill={COLOR.ink} stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" /></svg>
);
