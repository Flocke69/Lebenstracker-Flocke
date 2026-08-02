/* Einstiegspunkt: Zustand laden, Reiter aufbauen, Ansicht zeichnen.
 *
 * Kein Framework. Bei einer Änderung wird die aktuelle Ansicht komplett neu
 * gezeichnet — bei dieser Datenmenge ist das schneller als jede
 * Differenzberechnung und deutlich weniger Code, der schiefgehen kann.
 */

import { createStore, requestPersistentStorage } from './store.js';
import { isProfileComplete, withStaleSessionsClosed } from './lib/state.js';
import { formatMonth, monthKey, todayKey } from './lib/dates.js';
import { el, replace } from './views/dom.js';
import { closeSheet } from './views/sheet.js';
import { Spring } from './views/motion.js';
import { currentTheme, toggleTheme, applyStoredTheme } from './views/theme.js';
import { needsRollover } from './lib/archive.js';
import * as todayView from './views/today.js';
import * as trainingView from './views/training.js';
import * as nutritionView from './views/nutrition.js';
import * as trendsView from './views/trends.js';
import * as reviewView from './views/review.js';
import * as archiveView from './views/archive.js';
import * as profileView from './views/profile.js';
import * as onboardingView from './views/onboarding.js';

const VIEWS = {
  heute: todayView,
  training: trainingView,
  essen: nutritionView,
  trends: trendsView,
  review: reviewView,
  profil: profileView,
  archiv: archiveView,
};

const ROUTES = [
  { id: 'heute', label: 'Heute', glyph: '◎' },
  { id: 'training', label: 'Training', glyph: '↑' },
  { id: 'essen', label: 'Essen', glyph: '◐' },
  { id: 'trends', label: 'Trends', glyph: '◔' },
  { id: 'review', label: 'Review', glyph: '≡' },
];

/* ─── Die gleitende Kapsel der Tab-Bar ─────────────────────────────────────
 *
 * Sie liegt HINTER den Reitern und wandert mit einer Feder zum neuen. Die
 * Feder lebt im Modul, nicht in der Ansicht: die App zeichnet bei jeder
 * Eingabe alles neu, und eine Feder, die dabei jedes Mal neu entsteht, wäre
 * bei jedem Tastendruck wieder am Anfang.
 *
 * Deshalb auch die Unterscheidung unten: beim ROUTENWECHSEL gleitet sie, beim
 * bloßen Neuzeichnen wird sie ohne Bewegung an ihren Platz gesetzt.
 */
let capsuleEl = null;
const capsuleX = new Spring(0, { damping: 0.9, response: 0.34, onChange: paintCapsule });
const capsuleW = new Spring(0, { damping: 0.9, response: 0.34, onChange: paintCapsule });

function paintCapsule() {
  if (!capsuleEl?.isConnected) return;
  capsuleEl.style.transform = `translate3d(${capsuleX.x.toFixed(2)}px, 0, 0)`;
  capsuleEl.style.width = `${capsuleW.x.toFixed(2)}px`;
}

function placeCapsule(tabbar, index, { instant }) {
  if (!capsuleEl) return;

  /* Profil und Archiv sind keine Reiter. Dann gibt es nichts zu markieren —
     eine Kapsel, die in dem Fall unter "Heute" stehen bliebe, würde behaupten,
     man sei auf dem Heute-Screen. */
  capsuleEl.style.opacity = index < 0 ? '0' : '1';
  if (index < 0) return;

  const tab = tabbar.querySelectorAll('.tab')[index];
  if (!tab) return;
  const pad = 5;                       // Innenabstand der Leiste, siehe CSS
  const x = tab.offsetLeft - pad;
  const w = tab.offsetWidth;
  if (instant) {
    capsuleX.set(x);
    capsuleW.set(w);
  } else {
    capsuleX.to(x);
    capsuleW.to(w);
  }
}

const DEFAULT_ROUTE = 'heute';

const store = createStore();
const root = document.getElementById('app');

/* Profil und Archiv sind bewusst keine Reiter — sie hängen an der Kopfzeile. */
const EXTRA_ROUTES = ['profil', 'archiv'];

function currentRoute() {
  /* Der Teil hinter `?` gehört der Ansicht — der Zeitraum im Review, der
     gezeigte Tag auf dem Heute-Screen —, nicht der Route. */
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (EXTRA_ROUTES.includes(id)) return id;
  return ROUTES.some((r) => r.id === id) ? id : DEFAULT_ROUTE;
}

/** Beim Wechseln des Reiters gehört ein offenes Fenster zu. */
let lastRoute = currentRoute();
function onHashChange() {
  const route = currentRoute();
  if (route !== lastRoute) {
    lastRoute = route;
    closeSheet();
  }
  render();
}

function navigate(id) {
  location.hash = `#/${id}`;
}

/* ─── Hinweise, die über allem stehen ────────────────────────────────────── */

function storageWarnings() {
  const notes = [];

  if (store.isEphemeral()) {
    notes.push(el('div', { class: 'notice notice--error' },
      el('span', { class: 'notice__title', text: 'Daten werden nicht gespeichert' }),
      'Dieser Browser erlaubt keinen dauerhaften Speicher — im privaten Modus ' +
      'ist das normal. Alles Eingetragene ist beim Schließen weg.'));
  }

  const err = store.getLastError();
  if (err) {
    notes.push(el('div', { class: 'notice notice--error' },
      el('span', { class: 'notice__title', text: 'Speichern fehlgeschlagen' }),
      err.message));
  }

  return notes;
}

/* ─── Zeichnen ───────────────────────────────────────────────────────────── */

function renderOnboarding() {
  root.className = 'app app--onboarding';
  replace(root, el('main', { class: 'viewport' },
    onboardingView.render({
      store,
      onDone: () => { navigate(DEFAULT_ROUTE); render(); },
    })));
}

/* Der Monatsabschluss legt sich VOR die App — ohne Reiter, ohne Ausweg.
   Solange er offen ist, gibt es nichts anderes zu tun. */
function renderRollover() {
  root.className = 'app app--onboarding';
  replace(root, el('main', { class: 'viewport' },
    archiveView.renderRollover({
      store,
      onDone: () => { navigate(DEFAULT_ROUTE); render(); },
    })));
}

/* ─── Kopfleiste ───────────────────────────────────────────────────────────
 *
 * Sie schwebt über dem Inhalt, statt ihm einen Streifen wegzunehmen. Die
 * Glasfläche dahinter ist zunächst unsichtbar und wird eingeblendet, sobald
 * Inhalt darunter läuft — eine Kante, die entsteht, statt einer Trennlinie,
 * die immer da ist.
 */
function topbar(route) {
  const themeIsLight = currentTheme() === 'light';

  const iconBtn = (label, glyph, onclick, active = false) => el('button', {
    type: 'button',
    class: `topbar__btn${active ? ' topbar__btn--active' : ''}`,
    'aria-label': label,
    onclick,
  }, el('span', { class: 'topbar__glyph', text: glyph, 'aria-hidden': 'true' }));

  return el('header', { class: 'topbar' },
    el('div', { class: 'topbar__sheen', 'aria-hidden': 'true' }),
    el('div', { class: 'topbar__row' },
      el('div', { class: 'topbar__id' },
        el('span', { class: 'topbar__title', text: 'Lebenstracker' }),
        el('span', { class: 'topbar__sub', text: formatMonth(monthKey(todayKey())) })),
      el('div', { class: 'topbar__tools' },
        iconBtn(
          themeIsLight ? 'Auf dunkel umschalten' : 'Auf hell umschalten',
          themeIsLight ? '☾' : '☀',
          () => { toggleTheme(); render(); },
        ),
        iconBtn('Archiv und Sicherung', '↓',
          () => navigate(route === 'archiv' ? DEFAULT_ROUTE : 'archiv'),
          route === 'archiv'),
        iconBtn(route === 'profil' ? 'Profil schließen' : 'Profil öffnen',
          route === 'profil' ? '×' : '⚙',
          () => navigate(route === 'profil' ? DEFAULT_ROUTE : 'profil'),
          route === 'profil'))));
}

/* ─── Tab-Bar ──────────────────────────────────────────────────────────────
 *
 * Eine schwebende Leiste mit Rand ringsum, keine angeklebte Zeile: der Inhalt
 * läuft sichtbar darunter durch, und das macht aus dem unteren Bildrand eine
 * Ebene statt eines Abschlusses.
 */
function tabbar(route) {
  const capsule = el('div', { class: 'tabbar__capsule', 'aria-hidden': 'true' });
  capsuleEl = capsule;

  return el('nav', { class: 'tabbar', 'aria-label': 'Bereiche' },
    capsule,
    ROUTES.map((r) => el('button', {
      type: 'button',
      class: `tab${r.id === route ? ' tab--active' : ''}`,
      'aria-current': r.id === route ? 'page' : null,
      onclick: () => navigate(r.id),
    },
      el('span', { class: 'tab__glyph', text: r.glyph, 'aria-hidden': 'true' }),
      el('span', { class: 'tab__label', text: r.label }))));
}

/* Beim Reiterwechsel gleitet die neue Ansicht kurz herein; beim Neuzeichnen
   nach einer Eingabe NICHT — sonst würde der Screen bei jedem Tippen zucken. */
let paintedRoute = null;

/**
 * Die Glasfläche der Kopfleiste einblenden, sobald Inhalt darunter läuft.
 *
 * Kein Klassenwechsel bei einer Schwelle, sondern ein weicher Wert: eine
 * Leiste, die bei genau 12 px Scrollstrecke schlagartig undurchsichtig wird,
 * blitzt beim Wippen des Fingers.
 */
function bindScrollEdge(viewport, bar) {
  const paint = () => {
    const t = Math.min(1, Math.max(0, viewport.scrollTop / 24));
    bar.style.setProperty('--edge', t.toFixed(3));
  };
  viewport.addEventListener('scroll', paint, { passive: true });
  paint();
}

function renderApp() {
  const route = currentRoute();
  const routeChanged = route !== paintedRoute;
  root.className = 'app';

  const viewSlot = el('main', {
    id: 'view',
    class: `viewport${routeChanged ? ' view-enter' : ''}`,
  });
  paintedRoute = route;
  const body = (VIEWS[route] ?? VIEWS[DEFAULT_ROUTE]).render({ store, navigate });

  replace(viewSlot, ...storageWarnings(), body);

  const bar = topbar(route);
  const tabs = tabbar(route);
  replace(root, bar, viewSlot, tabs);

  bindScrollEdge(viewSlot, bar);

  /* Die Kapsel wandert nur, wenn sich der Reiter WIRKLICH geändert hat.
     Beim Neuzeichnen nach einer Eingabe wird sie ohne Bewegung gesetzt —
     sonst liefe bei jedem Tastendruck eine Animation los.

     Nach dem Einhängen, nicht davor: offsetLeft ist erst dann bekannt. */
  requestAnimationFrame(() => {
    placeCapsule(tabs, ROUTES.findIndex((r) => r.id === route), {
      instant: !routeChanged || capsuleW.x === 0,
    });
  });
}

function render() {
  /* Jede Eingabe speichert sofort und löst ein Neuzeichnen aus. Ohne das hier
     würde die Seite dabei jedes Mal nach oben springen — nach dem dritten
     Antippen benutzt das niemand mehr.

     Gescrollt wird seit dem Umbau auf schwebende Leisten NICHT mehr das
     Dokument, sondern der Behälter darin: nur so kann Inhalt unter dem Glas
     hindurchlaufen, statt von einem Streifen abgeschnitten zu werden. */
  const scrollTop = root.querySelector('.viewport')?.scrollTop ?? 0;

  /* Offene Aufklappbereiche NAMENTLICH merken.
   *
   * Vorher wurde nur gezählt und danach alles wieder aufgeklappt — mit einem
   * einzigen Bereich pro Screen ging das noch durch. Seit Essen und Trends aus
   * mehreren Abschnitten bestehen, wäre es falsch: wer einen aufklappt, hätte
   * hinterher alle offen.
   *
   * Nur Bereiche INNERHALB der App. Die Overlay-Fenster hängen an
   * document.body und zeichnen sich selbst neu (js/views/sheet.js). */
  const openKeeps = [...root.querySelectorAll('details[data-keep]')]
    .filter((d) => d.open)
    .map((d) => d.dataset.keep);

  try {
    if (!isProfileComplete(store.getState()?.profile)) renderOnboarding();
    else if (needsRollover(store.getState())) renderRollover();
    else {
      renderApp();
      for (const keep of openKeeps) {
        const found = root.querySelector(`details[data-keep="${keep}"]`);
        if (found) found.open = true;
      }
      const viewport = root.querySelector('.viewport');
      if (viewport) viewport.scrollTop = scrollTop;
    }
  } catch (err) {
    console.error('[app] Zeichnen fehlgeschlagen', err);
    root.className = 'app app--onboarding';
    replace(root, el('div', { class: 'view' },
      el('div', { class: 'notice notice--error' },
        el('span', { class: 'notice__title', text: 'Etwas ist schiefgelaufen' }),
        err.message)));
  }
}

/* ─── Service Worker ─────────────────────────────────────────────────────── */

const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/**
 * Offline-Cache einschalten — aber nicht beim lokalen Entwickeln.
 *
 * Der Service Worker liefert bewusst zuerst aus dem Cache. Auf dem
 * Entwicklungsrechner heißt das: nach jeder Änderung sieht man die alte
 * Version, bis der Cache von Hand geleert wird. Auf localhost wird er
 * deshalb nicht registriert und ein eventuell vorhandener abgemeldet.
 *
 * Offline wird auf der echten Adresse geprüft, nicht hier.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (IS_LOCAL) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
      if (regs.length) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
        console.info('[app] Service Worker lokal abgemeldet — kein Cache beim Entwickeln.');
      }
    });
    return;
  }

  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('[app] Service Worker nicht registriert', err.message);
  });
}

/* ─── Start ──────────────────────────────────────────────────────────────── */

function boot() {
  /* VOR dem ersten Zeichnen: sonst blitzt einmal die dunkle Palette auf,
     bevor auf hell umgeschaltet wird. */
  applyStoredTheme();

  try {
    store.load();
  } catch (err) {
    // Nur bei Daten aus einer neueren App-Version. Nichts überschreiben.
    root.className = 'app app--onboarding';
    replace(root, el('div', { class: 'view' },
      el('div', { class: 'notice notice--error' },
        el('span', { class: 'notice__title', text: 'Daten aus einer neueren Version' }),
        err.message)));
    return;
  }

  /* Laufende Uhren von gestern und davor schließen — rückwirkend auf den
     letzten Satz. Muss VOR dem ersten Zeichnen passieren, sonst stünde kurz
     „läuft" an einer Einheit von vorgestern. */
  store.update((s) => withStaleSessionsClosed(s, todayKey()));

  store.subscribe(render);
  window.addEventListener('hashchange', onHashChange);

  /* Beim Drehen des Geräts stimmen die Pixelplätze der gleitenden Kapseln
     nicht mehr. NUR neu einmessen, nicht neu zeichnen: auf iOS löst auch die
     eingeblendete Tastatur ein resize aus, und ein Neuzeichnen würde dabei
     das Feld wegwerfen, in das gerade getippt wird. */
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => {
      const tabs = root.querySelector('.tabbar');
      if (tabs) {
        placeCapsule(tabs, ROUTES.findIndex((r) => r.id === currentRoute()), { instant: true });
      }
      todayView.relayoutWeekband();
    });
  });

  render();

  // Nur eine Bitte an den Browser. Der monatliche Export bleibt Pflicht.
  requestPersistentStorage().then(({ supported, granted }) => {
    console.info(`[app] dauerhafter Speicher: ${supported ? (granted ? 'zugesagt' : 'abgelehnt') : 'nicht unterstützt'}`);
  });

  registerServiceWorker();
}

boot();

// Für die Prüfung von der Konsole aus.
window.__store = store;
