// Design values, taken from the app's own tokens (aarogyarekha2-frontend/src/styles/tokens.css).
// Flat only: no gradients, shadows, glow or blur. Priority colours are used for priority and nothing else.
import { Easing } from 'remotion';

export const COLOR = {
  ink: '#15232d',
  paper: '#eef1f3',
  panel: '#ffffff',
  action: '#0e4a55',
  actionInk: '#ffffff',
  actionTint: '#e2eef0',
  muted: '#4a5b67',
  rule: '#8e9ba5',
  ruleSoft: '#cbd3d9',
  red: '#b42318', redTint: '#fbe9e7',
  orange: '#b54708', orangeTint: '#fdebd5',
  yellow: '#8a5a00', yellowTint: '#fbf1c7',
  green: '#1b6b3f', greenTint: '#e3f2e8',
} as const;

export const FONT = { sans: "'Public Sans', system-ui, sans-serif", devanagari: "'Noto Sans Devanagari', 'Public Sans', sans-serif", oriya: "'Noto Sans Oriya', 'Public Sans', sans-serif" } as const;

/** 1920 x 1080. The video text sizes follow the Remotion layout rule scaled to a 1920 px width. */
export const SIZE = {
  headline: 112,
  caption: 72,
  ui: 34,
  uiSmall: 28,
  edgeX: 120,
  edgeY: 96,
  radius: 2,
} as const;

/** Calm, exact motion: a soft ease-out, no overshoot, nothing bounces. */
export const EASE = Easing.bezier(0.2, 0.7, 0.2, 1);
export const EASE_INOUT = Easing.bezier(0.45, 0, 0.25, 1);

/** The four priorities: tier 1 is the most urgent. Shape as well as colour and word, as in the app. */
export const TIER = {
  1: { word: 'Immediate', color: COLOR.red, tint: COLOR.redTint },
  2: { word: 'Very urgent', color: COLOR.orange, tint: COLOR.orangeTint },
  3: { word: 'Urgent', color: COLOR.yellow, tint: COLOR.yellowTint },
  4: { word: 'Routine', color: COLOR.green, tint: COLOR.greenTint },
} as const;
export type Tier = keyof typeof TIER;
