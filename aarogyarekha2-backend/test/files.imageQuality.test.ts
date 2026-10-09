import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { analyse, decode, enhance, estimateSkew, LIMITS, rotate, sharpness, shrink, stretchContrast, toGray, WARNING_TEXT, type Gray } from '../src/files/imageQuality.js';

function page(w = 800, h = 1000, o: { bg?: number; ink?: number; seed?: number } = {}): Gray {
  const bg = o.bg ?? 235, ink = o.ink ?? 25; const d = new Uint8ClampedArray(w * h).fill(bg); let s = o.seed ?? 3; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  for (let line = 0; line < 30; line++) {
    const y0 = 60 + line * 28; let x = 60;
    while (x < w - 80) { const bw = 20 + Math.floor(rnd() * 50); for (let yy = y0; yy < y0 + 12; yy++) for (let xx = x; xx < Math.min(x + bw, w - 60); xx++) d[yy * w + xx] = ink; x += bw + 10; }
  }
  return { width: w, height: h, data: d };
}
const pngOf = (g: Gray) => { const p = new PNG({ width: g.width, height: g.height }); for (let i = 0, k = 0; i < g.data.length; i++, k += 4) { p.data[k] = p.data[k + 1] = p.data[k + 2] = g.data[i]!; p.data[k + 3] = 255; } return PNG.sync.write(p); };
const jpgOf = (g: Gray, q = 90) => { const rgba = Buffer.alloc(g.width * g.height * 4); for (let i = 0, k = 0; i < g.data.length; i++, k += 4) { rgba[k] = rgba[k + 1] = rgba[k + 2] = g.data[i]!; rgba[k + 3] = 255; } return jpeg.encode({ data: rgba, width: g.width, height: g.height }, q).data; };
const blur = (g: Gray, r = 4): Gray => { const { width: w, height: h } = g; const tmp = new Float64Array(w * h), out = new Uint8ClampedArray(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += g.data[y * w + xx]!; n++; } } tmp[y * w + x] = s / n; } for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]!; n++; } } out[y * w + x] = s / n; } return { ...g, data: out }; };

describe('analyse', () => {
  it('a clean page of print has no warnings', () => { expect(analyse(Buffer.from(pngOf(page())), 'image/png').warnings).toEqual([]); });
  it('works for JPEG as well', () => { expect(analyse(Buffer.from(jpgOf(page())), 'image/jpeg').warnings).toEqual([]); });
  it('a dark photo is flagged too dark', () => { expect(analyse(Buffer.from(pngOf(page(800, 1000, { bg: 40, ink: 5 }))), 'image/png').warnings).toContain('too_dark'); });
  it('a washed-out photo is flagged', () => { expect(analyse(Buffer.from(pngOf(page(800, 1000, { bg: 252, ink: 240 }))), 'image/png').warnings).toContain('washed_out'); });
  it('a faint page is flagged low contrast', () => { expect(analyse(Buffer.from(pngOf(page(800, 1000, { bg: 170, ink: 150 }))), 'image/png').warnings).toContain('low_contrast'); });
  it('a blurred page is flagged blurry and a sharp one is not', () => {
    const sharp = analyse(Buffer.from(pngOf(page())), 'image/png'); const blurry = analyse(Buffer.from(pngOf(blur(page(), 6))), 'image/png');
    expect(blurry.warnings).toContain('blurry'); expect(blurry.sharpness).toBeLessThan(sharp.sharpness); expect(sharp.sharpness).toBeGreaterThan(LIMITS.blurBelow);
  });
  it('a small picture is flagged small', () => { expect(analyse(Buffer.from(pngOf(page(400, 500))), 'image/png').warnings).toContain('small'); });
  it('every warning has a plain sentence telling the person what to do', () => { for (const t of Object.values(WARNING_TEXT)) expect(t).toMatch(/Retake|Text may/); });
  it('garbage bytes throw instead of returning a wrong answer', () => { expect(() => analyse(Buffer.from('not an image'), 'image/png')).toThrow(); expect(() => decode(Buffer.from([1, 2, 3]), 'application/pdf')).toThrow(); });
});

describe('contrast stretch', () => {
  it('spreads a dull image to the full range, and leaves an already full-range or flat image alone', () => {
    const dull = page(400, 500, { bg: 170, ink: 120 }); const s = stretchContrast(dull); let lo = 255, hi = 0; for (const v of s.data) { if (v < lo) lo = v; if (v > hi) hi = v; } expect(lo).toBeLessThan(10); expect(hi).toBeGreaterThan(245);
    const flat: Gray = { width: 10, height: 10, data: new Uint8ClampedArray(100).fill(128) }; expect(stretchContrast(flat).data).toEqual(flat.data);
  });
});

describe('deskew', () => {
  it('a straight page needs no correction', () => { expect(estimateSkew(page())).toBe(0); });
  it('finds the tilt of a rotated page and enhance straightens it', () => {
    for (const tilt of [2, -2, 3.5]) {
      const tilted = rotate(page(), tilt); const est = estimateSkew(tilted);
      expect(Math.abs(Math.abs(est) - Math.abs(tilt)), `tilt ${tilt} estimated ${est}`).toBeLessThanOrEqual(0.75);
      const out = enhance(Buffer.from(pngOf(tilted)), 'image/png'); expect(out.skewDegrees).toBe(est);
      const fixed = toGray(decode(out.bytes, 'image/png')); expect(Math.abs(estimateSkew(fixed)), `tilt ${tilt} left over`).toBeLessThanOrEqual(0.75);
    }
  });
  it('a blank page has no skew to find', () => { expect(estimateSkew({ width: 200, height: 200, data: new Uint8ClampedArray(40000).fill(255) })).toBe(0); });
});

describe('enhance', () => {
  it('returns PNG bytes of the same size', () => { const o = enhance(Buffer.from(jpgOf(page(300, 400))), 'image/jpeg'); const d = decode(o.bytes, 'image/png'); expect([d.width, d.height]).toEqual([300, 400]); });
  it('returns the original bytes untouched when the picture cannot be read', () => { const junk = Buffer.from('nope'); const o = enhance(junk, 'image/png'); expect(o.bytes).toBe(junk); expect(o.skewDegrees).toBe(0); });
  it('transparent pixels count as white paper', () => { const p = new PNG({ width: 4, height: 4 }); const g = toGray({ width: 4, height: 4, data: p.data }); expect([...g.data].every(v => v === 255)).toBe(true); });
});

describe('sharpness', () => { it('is zero for a flat picture and tiny pictures', () => { expect(sharpness({ width: 50, height: 50, data: new Uint8ClampedArray(2500).fill(10) })).toBe(0); expect(sharpness({ width: 2, height: 2, data: new Uint8ClampedArray(4) })).toBe(0); }); });
