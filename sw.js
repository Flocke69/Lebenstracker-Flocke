/* Service Worker — macht die App offline nutzbar.
 *
 * Strategie: stale-while-revalidate. Anfragen werden sofort aus dem Cache
 * bedient (also auch im Flugmodus und im Funkloch am Sportplatz) und im
 * Hintergrund aktualisiert. Beim nächsten Start ist die neue Version da.
 *
 * Der Alternativansatz "network-first" wäre hier falsch: die App wird morgens
 * im Bett und abends in der Umkleide geöffnet, oft bei schlechtem Empfang.
 * Warten auf ein Netz, das gar nicht antwortet, ist die schlechtere Erfahrung.
 *
 * CACHE_VERSION bei jedem Deploy erhöhen.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `lebenstracker-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/app.js',
  './js/store.js',
  './js/lib/dates.js',
  './js/lib/energy.js',
  './js/lib/planner.js',
  './js/lib/state.js',
  './js/views/dom.js',
  './js/views/onboarding.js',
  './js/views/today.js',
  './js/views/placeholder.js',
  './fonts/barlow-condensed-600-latin.woff2',
  './fonts/inter-var-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Einzeln, damit eine fehlende Datei nicht die ganze Installation kippt.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[sw] nicht vorgeladen:', url, err.message);
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('lebenstracker-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nur eigene GET-Anfragen. Die App ruft ohnehin nichts Fremdes auf.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });

      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        // Aktualisierung im Hintergrund laufen lassen, nicht darauf warten.
        event.waitUntil(network);
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;

      // Navigation ohne Netz und ohne Cache-Treffer: die Shell ausliefern.
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline und nicht im Cache.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })()
  );
});
