import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export interface Gray { width: number; height: number; data: Uint8ClampedArray }
export type Warning = 'blurry' | 'too_dark' | 'washed_out' | 'low_contrast' | 'small';
export interface Quality { width: number; height: number; sharpness: number; brightness: number; contrast: number; warnings: Warning[] }

export const LIMITS = { blurBelow: 60, darkBelow: 70, brightAbove: 225, contrastBelow: 35, smallBelow: 700 } as const;
export const WARNING_TEXT: Record<Warning, string> = {
  blurry: 'The picture looks blurry. Text may be misread. Retake it holding the camera steady.',
  too_dark: 'The picture is dark. Retake it in better light.',
  washed_out: 'The picture is very bright or washed out. Retake it without glare.',
  low_contrast: 'The text does not stand out much from the page. Retake it in even light.',
  small: 'The picture is small. Retake it closer, so the page fills the frame.',
};

export function decode(bytes: Buffer, mime: string): { width: number; height: number; data: Uint8Array } {
  if (mime === 'image/png') { const p = PNG.sync.read(bytes); return { width: p.width, height: p.height, data: p.data }; }
  if (mime === 'image/jpeg') { const j = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 }); return { width: j.width, height: j.height, data: j.data }; }
  throw new Error('not a picture');
}

export function toGray(rgba: { width: number; height: number; data: Uint8Array }): Gray {
  const { width, height, data } = rgba; const g = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const a = data[p + 3]! / 255; const bg = 255 * (1 - a);
    g[i] = 0.299 * data[p]! * a + 0.587 * data[p + 1]! * a + 0.114 * data[p + 2]! * a + bg;
  }
  return { width, height, data: g };
}

export function shrink(g: Gray, max = 800): Gray {
  const k = Math.max(g.width, g.height) / max; if (k <= 1) return g;
  const w = Math.max(1, Math.floor(g.width / k)), h = Math.max(1, Math.floor(g.height / k)); const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * k), x1 = Math.max(x0 + 1, Math.floor((x + 1) * k)), y0 = Math.floor(y * k), y1 = Math.max(y0 + 1, Math.floor((y + 1) * k)); let s = 0, n = 0;
    for (let yy = y0; yy < y1 && yy < g.height; yy++) for (let xx = x0; xx < x1 && xx < g.width; xx++) { s += g.data[yy * g.width + xx]!; n++; }
    out[y * w + x] = n ? s / n : 255;
  }
  return { width: w, height: h, data: out };
}

const stats = (g: Gray) => { let s = 0; for (const v of g.data) s += v; const mean = s / g.data.length; let q = 0; for (const v of g.data) q += (v - mean) ** 2; return { mean, std: Math.sqrt(q / g.data.length) }; };

export function sharpness(g: Gray): number {
  const { width: w, height: h, data: d } = g; if (w < 3 || h < 3) return 0;
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const l = 4 * d[i]! - d[i - 1]! - d[i + 1]! - d[i - w]! - d[i + w]!; s += l; s2 += l * l; n++; }
  const m = s / n; return s2 / n - m * m;
}

export function analyse(bytes: Buffer, mime: string): Quality {
  const img = decode(bytes, mime); const full = toGray(img); const g = shrink(full);
  const { mean, std } = stats(g); const sh = sharpness(g);
  const warnings: Warning[] = [];
  if (Math.min(img.width, img.height) < LIMITS.smallBelow) warnings.push('small');
  if (mean < LIMITS.darkBelow) warnings.push('too_dark'); else if (mean > LIMITS.brightAbove) warnings.push('washed_out');
  if (std < LIMITS.contrastBelow && !warnings.includes('too_dark') && !warnings.includes('washed_out')) warnings.push('low_contrast');
  if (sh < LIMITS.blurBelow) warnings.push('blurry');
  return { width: img.width, height: img.height, sharpness: Math.round(sh), brightness: Math.round(mean), contrast: Math.round(std), warnings };
}

export function stretchContrast(g: Gray): Gray {
  const hist = new Uint32Array(256); for (const v of g.data) hist[v]!++;
  const total = g.data.length; let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]!; if (acc >= total * 0.01) { lo = i; break; } }
  acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]!; if (acc >= total * 0.01) { hi = i; break; } }
  if (hi - lo < 10) return g;
  const out = new Uint8ClampedArray(g.data.length); const k = 255 / (hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = (g.data[i]! - lo) * k;
  return { ...g, data: out };
}

export function rotate(g: Gray, deg: number): Gray {
  if (Math.abs(deg) < 0.01) return g;
  const { width: w, height: h, data: d } = g; const out = new Uint8ClampedArray(w * h).fill(255);
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy; const sx = c * dx + s * dy + cx, sy = -s * dx + c * dy + cy;
    if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
    out[y * w + x] = d[i]! * (1 - fx) * (1 - fy) + d[i + 1]! * fx * (1 - fy) + d[i + w]! * (1 - fx) * fy + d[i + w + 1]! * fx * fy;
  }
  return { width: w, height: h, data: out };
}

export function estimateSkew(g: Gray, maxDeg = 5, step = 0.5): number {
  const small = shrink(g, 400); const { mean } = stats(small);
  const dark = new Uint8ClampedArray(small.data.length); for (let i = 0; i < dark.length; i++) dark[i] = small.data[i]! < mean * 0.8 ? 1 : 0;
  const { width: w, height: h } = small; let best = 0, bestScore = -1, zeroScore = 0;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += step) {
    const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = w / 2, cy = h / 2; const rows = new Float64Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark[y * w + x]) { const yy = Math.round(-s * (x - cx) + c * (y - cy) + cy); if (yy >= 0 && yy < h) rows[yy]!++; }
    let m = 0; for (const v of rows) m += v; m /= h; let score = 0; for (const v of rows) score += (v - m) ** 2;
    if (Math.abs(a) < 1e-9) zeroScore = score;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return bestScore > zeroScore * 1.05 ? best : 0;
}

export function enhance(bytes: Buffer, mime: string): { bytes: Buffer; skewDegrees: number } {
  try {
    const img = decode(bytes, mime); let g = stretchContrast(toGray(img));
    const skew = estimateSkew(g); g = rotate(g, -skew);
    const png = new PNG({ width: g.width, height: g.height });
    for (let i = 0, p = 0; i < g.data.length; i++, p += 4) { png.data[p] = png.data[p + 1] = png.data[p + 2] = g.data[i]!; png.data[p + 3] = 255; }
    return { bytes: PNG.sync.write(png), skewDegrees: skew };
  } catch { return { bytes, skewDegrees: 0 }; }
}
