// App-shell service worker. DataGolf traffic is never handled here — the app
// caches feed payloads itself in localStorage so it can open offline with the
// last board you looked at.

const VERSION = 'sg-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/api.js',
  './js/model.js',
  './js/scoring.js',
  './js/store.js',
  './js/presets.js',
  './js/ui.js',
  './js/diagnostics.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The proxy sits next to the shell, so its prefix depends on the SW scope.
  const scope = new URL('./', self.location).pathname;
  if (url.pathname === `${scope}dg` || url.pathname.startsWith(`${scope}dg/`)) return;

  // Stale-while-revalidate: shell loads instantly, updates land next visit.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) return cached;
      const fresh = await network;
      if (fresh) return fresh;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline and not cached.', {
        status: 503,
        headers: { 'content-type': 'text/plain' },
      });
    }),
  );
});
