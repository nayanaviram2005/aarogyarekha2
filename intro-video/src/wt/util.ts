import { interpolate, Easing } from 'remotion';
import { EASE, EASE_INOUT } from '../tokens';

/** 0..1 progress of time `t` (seconds) between `a` and `b`, eased and clamped. */
export const p = (t: number, a: number, b: number, easing: (n: number) => number = EASE) =>
  interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });

/** Linear 0..1, for things like progress bars. */
export const lin = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

/** Text typed in between two times. */
export const typed = (text: string, t: number, a: number, b: number) => text.slice(0, Math.round(text.length * lin(t, a, b)));

/** Values at times, eased between each pair (used for the camera and the cursor). */
export const track = (t: number, times: number[], values: number[], easing: (n: number) => number = EASE_INOUT) =>
  interpolate(t, times, values, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });

export const ease = Easing;

/** A press animation: 1 -> 0.96 -> 1 around time `at`. */
export const press = (t: number, at: number) => 1 - 0.05 * Math.sin(Math.PI * lin(t, at - 0.12, at + 0.2));
export const pressed = (t: number, at: number) => (t >= at - 0.05 && t <= at + 0.45 ? 1 : 0);
