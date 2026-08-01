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
 * CACHE_VERSION MUSS bei jeder Änderung an der App erhöht werden. Ohne das
 * bleiben alte Dateien im Cache liegen: der Wechsel der Version ist das
 * Signal, unter dem `activate` die alten Caches löscht.
 *
 * Verlauf:
 *   v1  Phase 1 — Grundgerüst, Onboarding, Tagesziele
 *   v2  Phase 2 — Check-in, Bereitschaft, Dezimaleingabe mit Komma
 *   v3  Phase 4 — Trainingsplan, Übungskatalog, Satz-Logger
 *   v4  Profil-Screen, Kaloriendefizit mit Ausnahmetagen
 *   v5  Phase 3+5 — Ernährung, Trends, Charts
 *   v6  Phase 6+7 — Reviews, Monatsarchiv, Export und Import
 *   v7  Trefferflächen der Kopfzeile auf 44 px
 *   v8  Trainingsplan ohne Schwerpunkt, Oberkörper gleichmäßig
 *   v9  Donnerstag: Rumpfübung raus, dritte Bizepsübung rein
 *   v10 Großer Umbau: Push/Pull/Beintag, Check-in mit 4 Fragen im Fenster,
 *       Trainingsuhr mit Satzpause, Tage verschieben, Yazio-Wochenschnitt,
 *       Monats-Review mit zehn Fragen, buntes Farbsystem
 *   v11 Satzzahlen folgen wieder dem Plan (die Bereitschaft rät nur),
 *       Heute ohne Beine- und Makrokarte, Essen und Trends in Abschnitten,
 *       Review kurz mit Stichpunkten, Monatsdatei-Export und Rückmeldung
 *   v12 Die App blickt nicht vor den ersten erfassten Monat zurück
 *   v13 Overlay-Fenster fürs Handy: dialog trägt nur noch die Fläche, das
 *       sichtbare Fenster ist ein Kind darin, der Griffbalken zieht wirklich
 *   v14 Einblendbewegung trägt nicht mehr die Position des Fensters
 *   v15 Trainingsuhr endet nur noch auf „Training beenden", Pause läuft an
 *       der Übung und in der angehefteten Kopfleiste, Ansichtswechsel
 *       gleiten, toter Platzhalter-Code entfernt
 *   v16 Stoppuhr-Flow: „Training starten" im Fenster (für Einheiten abseits
 *       des heutigen Plans), „Training abschließen" zeigt ein Abschlussbild
 *       mit Dauer, Sätzen und bewegtem Gewicht
 *   v17 Beintag neu (Bizeps vor Trizeps, Beinbeuger, Kniebeuge, RDL,
 *       Beinstrecker), Wiederholungen während der Pause gesperrt, grüner
 *       Bildschirm nach der Pause, Abschließen fragt nach offenen Übungen
 *   v18 Review ohne Fragen: ein Urteil oben, vier Themenfenster mit Grafik
 *       darunter, Erinnerung an den Yazio-Wochenschnitt am Sonntag
 *   v19 Die Erinnerungen stehen unter der Trainingskarte, nicht darueber
 */

const CACHE_VERSION = 'v19';
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
  './js/lib/aggregate.js',
  './js/lib/archive.js',
  './js/lib/dates.js',
  './js/lib/energy.js',
  './js/lib/planner.js',
  './js/lib/readiness.js',
  './js/lib/review.js',
  './js/lib/schedule.js',
  './js/lib/state.js',
  './js/lib/volume.js',
  './js/lib/weekly.js',
  './data/exercises.js',
  './data/plan-default.js',
  './js/views/archive.js',
  './js/views/chart.js',
  './js/views/checkin.js',
  './js/views/clock.js',
  './js/views/dom.js',
  './js/views/gauge.js',
  './js/views/nutrition.js',
  './js/views/onboarding.js',
  './js/views/profile.js',
  './js/views/review.js',
  './js/views/session.js',
  './js/views/sheet.js',
  './js/views/today.js',
  './js/views/training.js',
  './js/views/trends.js',
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
