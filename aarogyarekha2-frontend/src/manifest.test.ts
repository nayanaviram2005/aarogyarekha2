import { describe, expect, it } from 'vitest';
import manifestText from '../public/manifest.webmanifest?raw';
import indexHtml from '../index.html?raw';

const manifest = JSON.parse(manifestText);
const icons = Object.keys(import.meta.glob('../public/*.png')).map(k => k.replace('../public', ''));

describe('installable web app', () => {
  it('has the fields a browser needs to offer installing it, and its icons exist', () => {
    for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) expect(manifest[k], k).toBeTruthy();
    expect(manifest.display).toBe('standalone'); expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    for (const i of manifest.icons) expect(icons, i.src).toContain(i.src);
  });
  it('the page links the manifest', () => { expect(indexHtml).toMatch(/rel="manifest" href="\/manifest\.webmanifest"/); });
});
