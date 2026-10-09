import type { CSSProperties, ReactNode } from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLOR, EASE, FONT, SIZE, TIER, type Tier } from './tokens';

/** A 0..1 progress between two frames, eased and clamped. */
export const ramp = (frame: number, from: number, to: number, easing = EASE) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });

const SHAPE: Record<Tier, ReactNode> = {
  1: <rect x="1" y="1" width="10" height="10" />,          // square
  2: <polygon points="6,1 11,11 1,11" />,                  // triangle
  3: <circle cx="6" cy="6" r="5" />,                       // circle
  4: <rect x="0" y="4" width="12" height="4" />,           // bar
};

/** The priority plate: a shape, a colour and a word, so it never depends on colour alone. */
export const Plate = ({ tier, scale = 1 }: { tier: Tier; scale?: number }) => {
  const t = TIER[tier];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 * scale, padding: `${8 * scale}px ${18 * scale}px`, border: `${2 * scale}px solid ${t.color}`, background: t.tint, color: t.color, fontWeight: 700, fontSize: SIZE.ui * scale, borderRadius: SIZE.radius, whiteSpace: 'nowrap' }}>
      <svg width={30 * scale} height={30 * scale} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">{SHAPE[tier]}</svg>
      {t.word}
    </span>
  );
};

export const NotAssessed = () => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '8px 18px', border: `2px dashed ${COLOR.rule}`, color: COLOR.muted, fontWeight: 600, fontSize: SIZE.ui, borderRadius: SIZE.radius, whiteSpace: 'nowrap' }}>
    <svg width="30" height="30" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" aria-hidden="true"><rect x="1" y="1" width="10" height="10" /></svg>
    Not assessed
  </span>
);

export const Chip = ({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'action' | 'warn' }) => (
  <span style={{ display: 'inline-block', padding: '4px 14px', border: `2px solid ${tone === 'action' ? COLOR.action : tone === 'warn' ? COLOR.yellow : COLOR.rule}`, background: tone === 'action' ? COLOR.actionTint : tone === 'warn' ? COLOR.yellowTint : COLOR.panel, color: tone === 'action' ? COLOR.action : tone === 'warn' ? COLOR.yellow : COLOR.muted, fontWeight: 600, fontSize: SIZE.uiSmall, borderRadius: SIZE.radius, whiteSpace: 'nowrap' }}>{children}</span>
);

export const Panel = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: COLOR.panel, border: `2px solid ${COLOR.rule}`, borderRadius: SIZE.radius, ...style }}>{children}</div>
);

/** The line of text that carries each scene, since the video has no sound. Fades in once the picture has begun. */
export const Caption = ({ children, delay = 6, size = SIZE.caption }: { children: ReactNode; delay?: number; size?: number }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: SIZE.edgeX, right: SIZE.edgeX, bottom: SIZE.edgeY, fontSize: size, fontWeight: 600, lineHeight: 1.15, color: COLOR.ink, opacity: ramp(frame, delay, delay + 12), translate: `0px ${(1 - ramp(frame, delay, delay + 14)) * 16}px` }}>
      {children}
    </div>
  );
};

/** One scene: a short fade (the paper background sits behind all scenes, so cuts never flash) in and out at its edges, and the edge margins. */
export const SceneFrame = ({ children }: { children: ReactNode }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const edge = 8;
  const opacity = Math.min(ramp(frame, 0, edge), 1 - ramp(frame, durationInFrames - edge, durationInFrames));
  return (
    <div style={{ position: 'absolute', inset: 0, color: COLOR.ink, fontFamily: FONT.sans, opacity }}>
      {children}
    </div>
  );
};

/** Fades and slides its children in at a frame (relative to the scene), so a scene reads as a list of "at frame N, this appears". */
export const At = ({ from, children, style, dx = 0, dy = 18 }: { from: number; children: ReactNode; style?: CSSProperties; dx?: number; dy?: number }) => {
  const frame = useCurrentFrame();
  const p = ramp(frame, from, from + 14);
  return <div style={{ opacity: ramp(frame, from, from + 10), translate: `${(1 - p) * dx}px ${(1 - p) * dy}px`, ...style }}>{children}</div>;
};

/** The small label at the top of each walkthrough scene: which step this is. */
export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div style={{ position: 'absolute', left: SIZE.edgeX, top: 64, fontSize: SIZE.uiSmall, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: COLOR.muted }}>{children}</div>
);

/** A button as drawn in the app. `pressed` is 0..1 and gives a short press. */
export const Btn = ({ label, primary = false, pressed = 0, width }: { label: string; primary?: boolean; pressed?: number; width?: number }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 76, width, padding: '0 36px', fontSize: SIZE.ui, fontWeight: 700, border: `2px solid ${primary ? COLOR.action : COLOR.rule}`, background: primary ? COLOR.action : COLOR.panel, color: primary ? COLOR.actionInk : COLOR.ink, borderRadius: SIZE.radius, scale: 1 - 0.04 * Math.sin(Math.PI * Math.min(Math.max(pressed, 0), 1)), whiteSpace: 'nowrap' }}>{label}</span>
);

export const Check = ({ size = 40, color = COLOR.green }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);

export const Label = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: SIZE.uiSmall, fontWeight: 700, color: COLOR.muted, letterSpacing: 2, textTransform: 'uppercase' }}>{children}</span>
);

/** A white input-like box showing text typed in progressively. */
export const Typed = ({ text, from, to, placeholder = '', width }: { text: string; from: number; to: number; placeholder?: string; width?: number | string }) => {
  const frame = useCurrentFrame();
  const shown = text.slice(0, Math.round(text.length * ramp(frame, from, to)));
  return (
    <span style={{ display: 'flex', alignItems: 'center', minHeight: 68, width, padding: '0 18px', border: `2px solid ${COLOR.rule}`, background: COLOR.panel, fontSize: SIZE.ui, fontWeight: 600, color: shown ? COLOR.ink : COLOR.muted, borderRadius: SIZE.radius }}>{shown || placeholder}</span>
  );
};

export const CONTENT_TOP = 150;

/** Intro pacing: a scene's own keyframes run at 80% speed (so everything takes 25% longer). Scene durations in scenes.ts are set to match. */
export const SLOW = 0.8;
export const useSlow = () => useCurrentFrame() * SLOW;
