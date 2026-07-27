/* Persistenz.
 *
 * Dünne Schicht über `localStorage` rund um die reinen Funktionen aus
 * js/lib/state.js. Hier passiert nur: laden, schreiben, benachrichtigen.
 * Jede Regel und jede Prüfung liegt in state.js und ist dort getestet.
 *
 * localStorage statt IndexedDB, weil ein Monat Tagesdaten wenige Kilobyte
 * sind und synchroner Zugriff den Code erheblich vereinfacht.
 */

import { monthKey, todayKey } from './lib/dates.js';
import { migrate, withDay, withProfile } from './lib/state.js';

export const STORAGE_KEY = 'lebenstracker.v1';

/** Ersatzspeicher, falls localStorage nicht verfügbar ist (privater Modus). */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function probe(storage) {
  try {
    const probeKey = `${STORAGE_KEY}.probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

export function createStore({ storage, today = todayKey } = {}) {
  let backing = storage ?? globalThis.localStorage ?? null;
  let ephemeral = false;

  if (!backing || !probe(backing)) {
    backing = memoryStorage();
    ephemeral = true;
  }

  const listeners = new Set();
  let state = null;
  let lastError = null;

  function read() {
    const raw = backing.getItem(STORAGE_KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      // Kaputter Eintrag: nicht überschreiben, sondern beiseitelegen. Sonst
      // ist die einzige Kopie der Daten weg.
      console.error('[store] gespeicherte Daten sind kein gültiges JSON', err);
      try {
        backing.setItem(`${STORAGE_KEY}.beschaedigt.${Date.now()}`, raw);
      } catch { /* Platz reicht nicht — dann eben nicht */ }
      return null;
    }
  }

  function write() {
    try {
      backing.setItem(STORAGE_KEY, JSON.stringify(state));
      lastError = null;
    } catch (err) {
      lastError = err;
      console.error('[store] Schreiben fehlgeschlagen', err);
    }
  }

  function emit() {
    for (const fn of listeners) fn(state);
  }

  /** Lädt und migriert. Wirft nur, wenn die Daten aus einer NEUEREN Version sind. */
  function load() {
    state = migrate(read(), monthKey(today()));
    write();
    return state;
  }

  /** Zustand über eine reine Funktion verändern: fn(state) → neuer state. */
  function update(fn) {
    const next = fn(state);
    if (next === state) return state;
    state = next;
    write();
    emit();
    return state;
  }

  return {
    load,
    getState: () => state,
    /** true, wenn nur im Speicher gehalten wird — Daten sind dann flüchtig. */
    isEphemeral: () => ephemeral,
    /** Letzter Schreibfehler, z. B. wenn der Speicher voll ist. */
    getLastError: () => lastError,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    update,
    setProfile: (patch) => update((s) => withProfile(s, patch)),
    setDay: (key, patch) => update((s) => withDay(s, key, patch)),

    /** Nur für Tests und den Zurücksetzen-Knopf im Profil. */
    clear() {
      backing.removeItem(STORAGE_KEY);
      return load();
    },
  };
}

/**
 * Dauerhaften Speicher anfragen.
 *
 * Ohne das löscht iOS Safari die Daten von Web-Apps, die rund 7 Wochen nicht
 * geöffnet wurden. Die Anfrage ist nur eine Bitte — der Browser entscheidet.
 * Deshalb bleibt der monatliche Export Pflicht, nicht Komfort.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return { supported: false, granted: false };
  try {
    const already = await navigator.storage.persisted?.();
    if (already) return { supported: true, granted: true };
    const granted = await navigator.storage.persist();
    return { supported: true, granted };
  } catch {
    return { supported: true, granted: false };
  }
}
