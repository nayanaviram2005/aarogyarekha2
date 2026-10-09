// Fonts are bundled with the video (no network). loadFont holds the render until each file is ready.
import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

const load = (family: string, file: string, weight: string) => loadFont({ family, url: staticFile(`fonts/${file}`), weight, format: 'woff2' });

export const fontsReady = Promise.all([
  load('Public Sans', 'PublicSans-400.woff2', '400'),
  load('Public Sans', 'PublicSans-600.woff2', '600'),
  load('Public Sans', 'PublicSans-700.woff2', '700'),
  load('Noto Sans Devanagari', 'NotoDevanagari-600.woff2', '600'),
  load('Noto Sans Oriya', 'NotoOriya-400.woff2', '400'),
]);
