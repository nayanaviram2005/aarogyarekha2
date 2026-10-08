/* AarogyaRekha service worker.
 * It keeps ONLY the app's own code (page shell, scripts, styles, fonts) so the screen can open when the connection drops.
 * It never stores patient information: it ignores every request that is not a GET to this same site, and the API lives elsewhere
 * and answers with no-store anyway. Notes taken offline are kept separately, encrypted, by the page (src/offline/outbox.ts). */
const CACHE = 'ar-shell-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // the API and anything else: network only, never cached

  if (req.mode === 'navigate') {                                   // opening the app: network first, cached shell when offline
    event.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/index.html', copy)); return res; })
      .catch(() => caches.match('/index.html').then(r => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {   // fingerprinted files: cache first
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })));
  }
});
