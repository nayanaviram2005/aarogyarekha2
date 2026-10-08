// Checks the built frontend (aarogyarekha2-frontend/dist) for things that must never ship:
//   * any secret value from .env (except the public anon key and the public project URL),
//   * the demo module (synthetic people),
//   * hosted fonts or other third-party hosts.
// Prints names and counts only, never a secret value.   npm --prefix aarogyarekha2-backend run bundle:scan
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const dist = join(root, 'aarogyarekha2-frontend', 'dist');
if (!existsSync(dist)) { console.log('No dist folder. Run the frontend build first.'); process.exit(1); }

const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(dist);
const textual = files.filter(f => /\.(js|css|html|json|map|txt)$/i.test(f));
const blob = textual.map(f => readFileSync(f, 'utf8')).join('\n');

// Secrets: every .env value of a sensitive-looking name that is long enough to be meaningful.
const PUBLIC = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
const env = existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/) : [];
const leaks: string[] = []; let checked = 0;
for (const line of env) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (!m) continue;
  const [, name, raw] = m; const value = raw!.replace(/^["']|["']$/g, '').trim();
  if (PUBLIC.has(name!) || value.length < 12 || !/KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL/.test(name!)) continue;
  checked++;
  const pieces = [value, ...(value.includes('@') ? [value.split('@')[0]!.split(':').pop()!] : [])].filter(p => p.length >= 12);   // a connection string's password too
  if (pieces.some(p => blob.includes(p))) leaks.push(name!);
}

const checks: [string, boolean][] = [
  ['no secret from .env appears in the bundle', leaks.length === 0],
  ['no demo people in the bundle', !/Kavita Mohanty|Ramesh Sahoo|createDemoApi/.test(blob)],
  ['no hosted font or analytics hosts', !/fonts\.googleapis|fonts\.gstatic|google-analytics|googletagmanager|cdn\.jsdelivr|unpkg\.com/.test(blob)],
  ['service worker is present', files.some(f => f.endsWith('sw.js'))],
  ['service worker never touches the API (no fetch of other origins, caches only same-origin GET)', /origin !== self\.location\.origin\) return/.test(readFileSync(join(dist, 'sw.js'), 'utf8'))],
  ['no source maps shipped', !files.some(f => f.endsWith('.map'))],
];
console.log(`files scanned: ${textual.length}; secret values checked: ${checked}`);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
if (leaks.length) console.log('LEAKED (names only):', leaks.join(', '));
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
