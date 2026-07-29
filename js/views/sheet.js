/* Overlay-Fenster.
 *
 * Flockes Vorgabe: der Check-in soll nicht auf dem Screen kleben, sondern sich
 * als Fenster öffnen und beim Abschließen wieder zugehen. Dasselbe fürs
 * Training.
 *
 * DAS FENSTER LIEGT AUSSERHALB VON #app — und das ist der ganze Trick. Die App
 * zeichnet bei jeder Zustandsänderung ihre Ansicht komplett neu (siehe
 * js/app.js). Läge das Fenster in diesem Baum, würde die erste Eingabe darin
 * es sofort wieder zerstören. Als Geschwister von #app bleibt es stehen.
 *
 * Dafür muss es sich selbst um seinen Inhalt kümmern: es hängt sich an den
 * Store und zeichnet nur seinen eigenen Körper neu. Der Rest der App bleibt
 * dabei unangetastet.
 *
 * ─── Zwei Dinge, die auf dem Handy schiefgingen ────────────────────────────
 *
 * 1. DAS <dialog> WIRD NICHT MEHR SELBST GESTALTET. Vorher trug das
 *    dialog-Element die Maße des Fensters (`inset: auto 0 0 0`, `max-height`,
 *    Rundung). Das kämpft gegen die eingebauten Regeln des Browsers, der einem
 *    Dialog `width: fit-content`, `margin: auto` und ein eigenes `max-height`
 *    verpasst — auf iOS mit anderem Ergebnis als auf dem Rechner. Jetzt ist der
 *    Dialog ein durchsichtiger Vollbild-Kasten, und das sichtbare Fenster ist
 *    ein Kind darin. Damit gibt es nichts mehr zu überstimmen.
 *
 * 2. DER GRIFFBALKEN TUT JETZT WAS. Vorher war er nur gemalt — er sah aus wie
 *    zum Ziehen und reagierte auf nichts. Eine Fläche, die eine Handlung
 *    verspricht und sie nicht einlöst, ist schlimmer als keine Fläche. Jetzt:
 *    nach unten ziehen schließt, nach oben ziehen macht ganz auf, Antippen
 *    schaltet zwischen beiden Höhen um.
 *
 * Warum <dialog> und kein eigenes div: showModal() bringt Fokusfang,
 * Escape-Taste und die Verdunkelung dahinter mit. Alles drei von Hand zu bauen
 * geht, aber nicht besser.
 */

import { el, replace } from './dom.js';

/** Nur ein Fenster gleichzeitig. Zwei übereinander sind auf 375 px unbenutzbar. */
let current = null;

/** So weit muss nach unten gezogen werden, damit das Fenster schließt. */
const CLOSE_DISTANCE = 90;

/** Ab dieser Zugstrecke nach oben geht das Fenster auf ganze Höhe. */
const EXPAND_DISTANCE = 24;

/** Dauer der Schließbewegung. Muss zur CSS-Transition passen. */
const CLOSE_MS = 180;

const reducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

/**
 * Griffbalken und Kopfzeile zum Ziehen einrichten.
 *
 * Pointer-Events statt Touch-Events, weil sie Finger und Maus gleich behandeln —
 * damit ist das Ziehen auch am Rechner prüfbar und nicht nur auf dem Gerät.
 *
 * BEWEGUNG UND LOSLASSEN HÄNGEN AM FENSTER, nicht am Griffbalken. Der naheliegende
 * Weg wäre `setPointerCapture` auf dem Griff — der kann aber werfen (bei einer
 * nicht mehr aktiven Zeiger-Kennung), und ohne ihn verliert der Zug seinen
 * Empfänger, sobald der Finger den Griff verlässt. Und er verlässt ihn sofort,
 * denn genau darum geht es beim Ziehen. Am Fenster registriert, kann beides
 * nicht passieren.
 *
 * @returns {Function} Aufräumfunktion
 */
function makeDraggable({ handles, panel, dialog, onClose }) {
  let startY = null;
  let moved = 0;

  const setOffset = (px) => {
    panel.style.transform = px > 0 ? `translateY(${px}px)` : '';
  };

  const stop = () => {
    startY = null;
    panel.style.transition = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };

  function onMove(event) {
    if (startY === null) return;
    const dy = event.clientY - startY;
    moved = dy;

    if (dy > 0) {
      setOffset(dy);
      return;
    }
    /* Nach oben: das Fenster geht auf ganze Höhe, statt sich vom Bildrand
       wegzuschieben. Genau das war Flockes Beschwerde — hochziehen ging nicht. */
    if (dy < -EXPAND_DISTANCE) {
      dialog.classList.add('sheet--full');
      setOffset(0);
    }
  }

  function onUp() {
    if (startY === null) return;
    const dy = moved;
    stop();
    if (dy > CLOSE_DISTANCE) onClose();
    else setOffset(0);
  }

  function onCancel() {
    if (startY === null) return;
    stop();
    setOffset(0);
  }

  const onDown = (event) => {
    // Nur der primäre Zeiger, und nicht mitten in einer laufenden Bewegung.
    if (startY !== null || event.button !== 0) return;
    startY = event.clientY;
    moved = 0;
    panel.style.transition = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  for (const handle of handles) handle.addEventListener('pointerdown', onDown);

  return stop;
}

/**
 * Fenster öffnen.
 *
 * @param {object}   options
 * @param {object}   options.store       Store, an dem der Körper hängt
 * @param {string}   options.title       Überschrift
 * @param {string}   [options.eyebrow]   kleine Zeile darüber
 * @param {Function} options.body        () => Node, wird bei jeder Änderung neu gerufen
 * @param {Function} [options.footer]    () => Node, klebt am unteren Rand
 * @param {string|Function} [options.doneLabel] Text des Schließen-Knopfes —
 *   als Funktion, wenn er sich mit dem Zustand ändern soll
 * @param {string|Function} [options.doneTone] 'primary' | 'ghost' — der
 *   Schließen-Knopf tritt zurück, wenn im Footer eine wichtigere Handlung
 *   steht („Training abschließen" gewinnt gegen „Schließen")
 * @param {Function} [options.onDone]    NUR beim Schließen-Knopf, vor dem
 *   Schließen. Der Unterschied zu onClose ist der Punkt: Wegwischen ist kein
 *   Abschließen.
 * @param {Function} [options.onClose]   nach jedem Schließen, egal wie
 * @param {string}   [options.tone]      'good' | 'ok' | 'bad' — färbt die Kopfkante
 */
export function openSheet({
  store, title, eyebrow = null, body, footer = null,
  doneLabel = 'Abgeschlossen', doneTone = 'primary',
  onDone = null, onClose = null, tone = null,
}) {
  // Ein noch offenes Fenster verschwindet sofort, nicht mit Animation:
  // sonst liegen zwei übereinander.
  closeSheet({ instant: true });

  const bodySlot = el('div', { class: 'sheet__body' });
  const footSlot = el('div', { class: 'sheet__foot' });

  const grip = el('button', {
    type: 'button',
    class: 'sheet__grip',
    /* Der Balken ist antippbar UND ziehbar, und das steht auch dran. Ein
       Element, dessen Bedienung man erraten muss, wird nicht bedient. */
    'aria-label': 'Fenster größer oder kleiner. Nach unten ziehen schließt.',
  }, el('span', { class: 'sheet__grip-bar', 'aria-hidden': 'true' }));

  const head = el('div', { class: 'sheet__head' },
    el('div', { class: 'sheet__head-text' },
      eyebrow ? el('span', { class: 'eyebrow', text: eyebrow }) : null,
      el('h2', { class: 'sheet__title', text: title })),
    el('button', {
      type: 'button',
      class: 'sheet__close',
      'aria-label': 'Fenster schließen',
      text: '×',
      onclick: () => closeSheet(),
    }));

  const panel = el('div', { class: 'sheet__panel' }, grip, head, bodySlot, footSlot);
  const dialog = el('dialog', { class: `sheet${tone ? ` sheet--${tone}` : ''}` }, panel);

  function draw() {
    /* Der Körper wird bei jeder Eingabe komplett neu gebaut. Ohne die zwei
       Zeilen hier springt das Fenster dabei an den Anfang zurück — beim
       Check-in also nach JEDER der vier Antworten. Danach benutzt das niemand
       mehr. */
    const scrollTop = bodySlot.scrollTop;

    /* Ein offenes <details> im Fenster soll ebenfalls offen bleiben — sonst
       klappt der Hinweis zu, sobald man daneben etwas eintippt. */
    const open = [...bodySlot.querySelectorAll('details[open]')].map((d) => d.dataset.keep);
    replace(bodySlot, body());
    bodySlot.scrollTop = scrollTop;
    for (const keep of open) {
      if (!keep) continue;
      const found = bodySlot.querySelector(`details[data-keep="${keep}"]`);
      if (found) found.open = true;
    }
    const doneToneNow = typeof doneTone === 'function' ? doneTone() : doneTone;
    replace(footSlot,
      footer ? footer() : null,
      el('button', {
        type: 'button',
        class: `btn btn--block btn--${doneToneNow === 'ghost' ? 'ghost' : 'primary'}`,
        text: typeof doneLabel === 'function' ? doneLabel() : doneLabel,
        onclick: () => {
          if (onDone) onDone();
          closeSheet();
        },
      }));
  }

  document.body.append(dialog);
  draw();

  const unsubscribe = store.subscribe(() => {
    if (dialog.isConnected) draw();
  });

  /* Klick auf die Verdunkelung schließt. Der Dialog füllt den ganzen Bildschirm
     und ist durchsichtig — getroffen wird er nur neben dem Fenster. */
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeSheet();
  });
  // Escape löst 'cancel' aus, nicht 'click'.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSheet();
  });

  // Antippen des Griffbalkens schaltet die Höhe um.
  grip.addEventListener('click', () => dialog.classList.toggle('sheet--full'));
  const stopDragging = makeDraggable({
    handles: [grip, head], panel, dialog, onClose: () => closeSheet(),
  });

  current = { dialog, panel, unsubscribe, onClose, stopDragging };

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');   // sehr alte Browser: wenigstens sichtbar

  document.documentElement.classList.add('has-sheet');
  return { close: closeSheet, redraw: draw, expand: () => dialog.classList.add('sheet--full') };
}

/**
 * Fenster schließen, falls eines offen ist. Mehrfachaufruf ist harmlos.
 *
 * Aufgeräumt wird SOFORT — Abmeldung vom Store und die Klasse am Dokument —,
 * das Element verschwindet erst nach der Bewegung. Andersherum würde eine
 * Eingabe während des Ausblendens noch in einen sterbenden Baum schreiben.
 */
export function closeSheet({ instant = false } = {}) {
  if (!current) return;
  const { dialog, panel, unsubscribe, onClose, stopDragging } = current;
  current = null;

  unsubscribe();
  /* Die Zieh-Zuhörer hängen am Fenster, nicht am Dialog — sie verschwinden
     nicht mit dem Element und müssen abgemeldet werden. */
  stopDragging();
  document.documentElement.classList.remove('has-sheet');

  const remove = () => {
    try {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    } catch { /* schon zu */ }
    dialog.remove();
    if (onClose) onClose();
  };

  if (instant || reducedMotion()) {
    remove();
    return;
  }

  // Nach unten rausschieben, dann entfernen.
  panel.style.transition = `transform ${CLOSE_MS}ms var(--ease, ease)`;
  panel.style.transform = 'translateY(100%)';
  setTimeout(remove, CLOSE_MS);
}
