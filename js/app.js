/* Einstiegspunkt: Zustand laden, Reiter aufbauen, Ansicht zeichnen.
 *
 * Kein Framework. Bei einer Änderung wird die aktuelle Ansicht komplett neu
 * gezeichnet — bei dieser Datenmenge ist das schneller als jede
 * Differenzberechnung und deutlich weniger Code, der schiefgehen kann.
 */

import { createStore, requestPersistentStorage } from './store.js';
import { isProfileComplete } from './lib/state.js';
import { formatMonth, monthKey, todayKey } from './lib/dates.js';
import { el, replace } from './views/dom.js';
import * as todayView from './views/today.js';
import * as trainingView from './views/training.js';
import * as onboardingView from './views/onboarding.js';
import * as placeholderView from './views/placeholder.js';

const VIEWS = { heute: todayView, training: trainingView };

const ROUTES = [
  { id: 'heute', label: 'Heute', glyph: '◎' },
  { id: 'training', label: 'Training', glyph: '↑' },
  { id: 'essen', label: 'Essen', glyph: '◐' },
  { id: 'trends', label: 'Trends', glyph: '◔' },
  { id: 'review', label: 'Review', glyph: '≡' },
];

const DEFAULT_ROUTE = 'heute';

const store = createStore();
const root = document.getElementById('app');

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '');
  return ROUTES.some((r) => r.id === id) ? id : DEFAULT_ROUTE;
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
  replace(root, onboardingView.render({
    store,
    onDone: () => { navigate(DEFAULT_ROUTE); render(); },
  }));
}

function renderApp() {
  const route = currentRoute();
  root.className = 'app';

  const viewSlot = el('main', { id: 'view' });
  const view = VIEWS[route];
  const body = view
    ? view.render({ store, navigate })
    : placeholderView.render({ store, navigate, route });

  replace(viewSlot, ...storageWarnings(), body);

  replace(root,
    el('header', { class: 'topbar' },
      el('span', { class: 'topbar__title', text: 'Lebenstracker' }),
      el('span', { class: 'topbar__sub', text: formatMonth(monthKey(todayKey())) })),
    viewSlot,
    el('nav', { class: 'tabbar', 'aria-label': 'Bereiche' },
      ROUTES.map((r) => el('button', {
        type: 'button',
        class: `tab${r.id === route ? ' tab--active' : ''}`,
        'aria-current': r.id === route ? 'page' : null,
        onclick: () => navigate(r.id),
      },
        el('span', { class: 'tab__glyph', text: r.glyph, 'aria-hidden': 'true' }),
        el('span', { text: r.label })))));
}

function render() {
  /* Jede Eingabe im Check-in speichert sofort und löst ein Neuzeichnen aus.
     Ohne das hier würde die Seite dabei jedes Mal nach oben springen — nach
     dem dritten Antippen benutzt das niemand mehr. */
  const scrollY = window.scrollY;
  const openReveals = [...document.querySelectorAll('.reveal[open]')].length;

  try {
    if (!isProfileComplete(store.getState()?.profile)) renderOnboarding();
    else {
      renderApp();
      if (openReveals > 0) {
        document.querySelectorAll('.reveal').forEach((d) => { d.open = true; });
      }
      window.scrollTo(0, scrollY);
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

  store.subscribe(render);
  window.addEventListener('hashchange', render);
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
