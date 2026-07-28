/* Ein einziger Sekundentakt für die ganze App.
 *
 * Trainingsdauer und Satzpause müssen sekündlich hochlaufen. Der naive Weg —
 * bei jedem Tick den Screen neu zeichnen — ist hier ausgeschlossen: im
 * Trainingsfenster stehen Eingabefelder, und ein Neuzeichnen während der
 * Eingabe wirft die Tastatur weg und verliert den Fokus. Einmal pro Sekunde
 * wäre das unbenutzbar.
 *
 * Deshalb schreiben die Ticker DIREKT in einen Textknoten und rühren den Rest
 * des Baums nicht an.
 *
 * Und deshalb müssen sie sich auch selbst wieder abmelden: die App zeichnet
 * ihre Ansichten komplett neu, dabei fallen alte Knoten aus dem Dokument. Ein
 * Ticker, der weiter auf einen weggeworfenen Knoten schreibt, ist ein Leck,
 * das mit jeder Neuzeichnung wächst. Bei jedem Takt wird darum geprüft, ob der
 * Knoten noch im Dokument hängt — `isConnected` ist genau diese Frage, und sie
 * kostet nichts.
 */

import { el } from './dom.js';

const ticking = new Set();
let handle = null;

/**
 * Einen Takt abarbeiten.
 *
 * Jeder Eintrag bringt sein eigenes `apply` mit. Das ist der Grund: ein
 * Text-Ticker schreibt textContent, ein Balken-Ticker schreibt style.width.
 * Vorher lief beides über textContent — und der Pausenbalken trug die Zeichen
 * "67.06%" als Text in sich.
 */
function tick() {
  for (const entry of [...ticking]) {
    if (!entry.node.isConnected) {
      // Der Knoten ist weggezeichnet worden. Niemand wartet mehr auf ihn.
      ticking.delete(entry);
      continue;
    }
    try {
      const next = entry.render();
      if (next !== entry.last) {
        entry.apply(entry.node, next);
        entry.last = next;
      }
    } catch (err) {
      ticking.delete(entry);
      console.warn('[clock] Ticker abgemeldet', err.message);
    }
  }

  if (ticking.size === 0 && handle !== null) {
    clearInterval(handle);
    handle = null;
  }
}

function register(entry) {
  ticking.add(entry);
  if (handle === null) handle = setInterval(tick, 1000);
}

/* Der Browser hält Timer in einem Hintergrund-Tab an. Kommt die App zurück,
   soll die Zeit sofort stimmen und nicht erst beim nächsten Takt — alle
   Ticker rechnen ohnehin aus einem absoluten Zeitstempel, ein Takt von Hand
   reicht also aus. */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
}

/**
 * Ein Element, dessen Text sich jede Sekunde selbst neu schreibt.
 *
 * @param {() => string} render liefert den aktuellen Text
 * @param {object} props Attribute für das Element (class, aria-…)
 * @param {string} tag Elementname, Standard 'span'
 */
export function liveText(render, props = {}, tag = 'span') {
  const initial = render();
  const node = el(tag, { ...props, text: initial });
  register({
    node,
    render,
    apply: (target, value) => { target.textContent = value; },
    last: initial,
  });
  return node;
}

/**
 * Wie liveText, aber für einen Balken: die Funktion liefert 0…1.
 *
 * Geschrieben wird die BREITE, nicht der Text. Damit läuft der Pausenbalken
 * ohne Neuzeichnen leer.
 */
export function liveWidth(fraction, props = {}) {
  const percent = () =>
    `${(Math.min(Math.max(fraction(), 0), 1) * 100).toFixed(2)}%`;
  const initial = percent();
  const node = el('div', props);
  node.style.width = initial;
  register({
    node,
    render: percent,
    apply: (target, value) => { target.style.width = value; },
    last: initial,
  });
  return node;
}

/**
 * Für alles, was weder Text noch Balken ist — z. B. eine Klasse, die
 * umspringt, wenn die Pause in die Endphase geht. `render` liefert einen
 * Vergleichswert, `apply` schreibt ihn ans Element. Angewendet wird sofort
 * und danach nur bei Änderung.
 */
export function liveApply(node, render, apply) {
  const initial = render();
  apply(node, initial);
  register({ node, render, apply, last: initial });
  return node;
}

/** Sekunden als m:ss — für Pausen. */
export function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Sekunden als h:mm:ss bzw. m:ss — für die Trainingsdauer. */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
