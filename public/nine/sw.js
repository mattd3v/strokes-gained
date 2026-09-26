// App-shell service worker for The Nine. Everything the app knows lives in
// localStorage, so caching the shell is all it takes to work offline on the
// course.

const VERSION = 'nine-v5';
const SHELL = [
  './',
  './index.html',
  './nine.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/handicap.js',
  './js/store.js',
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
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('nine-') && k !== VERSION).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Stale-while-revalidate: opens instantly, updates land on the next visit.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
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
      return new Response('Offline and not cached.', { status: 503, headers: { 'content-type': 'text/plain' } });
    }),
  );
});
