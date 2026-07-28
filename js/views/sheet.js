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
 * Warum <dialog> und kein eigenes div: showModal() bringt Fokusfang,
 * Escape-Taste und die Verdunkelung dahinter mit. Alles drei von Hand zu bauen
 * geht, aber nicht besser.
 */

import { el, replace } from './dom.js';

/** Nur ein Fenster gleichzeitig. Zwei übereinander sind auf 375 px unbenutzbar. */
let current = null;

/**
 * Fenster öffnen.
 *
 * @param {object}   options
 * @param {object}   options.store       Store, an dem der Körper hängt
 * @param {string}   options.title       Überschrift
 * @param {string}   [options.eyebrow]   kleine Zeile darüber
 * @param {Function} options.body        () => Node, wird bei jeder Änderung neu gerufen
 * @param {Function} [options.footer]    () => Node, klebt am unteren Rand
 * @param {string}   [options.doneLabel] Text des Schließen-Knopfes
 * @param {Function} [options.onClose]   nach dem Schließen
 * @param {string}   [options.tone]      'good' | 'ok' | 'bad' — färbt die Kopfkante
 */
export function openSheet({
  store, title, eyebrow = null, body, footer = null,
  doneLabel = 'Abgeschlossen', onClose = null, tone = null,
}) {
  closeSheet();

  const bodySlot = el('div', { class: 'sheet__body' });
  const footSlot = el('div', { class: 'sheet__foot' });

  const dialog = el('dialog', { class: `sheet${tone ? ` sheet--${tone}` : ''}` },
    el('div', { class: 'sheet__grip', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet__head' },
      el('div', null,
        eyebrow ? el('span', { class: 'eyebrow', text: eyebrow }) : null,
        el('h2', { class: 'sheet__title', text: title })),
      el('button', {
        type: 'button',
        class: 'sheet__close',
        'aria-label': 'Fenster schließen',
        text: '×',
        onclick: () => closeSheet(),
      })),
    bodySlot,
    footSlot);

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
    replace(footSlot,
      footer ? footer() : null,
      el('button', {
        type: 'button',
        class: 'btn btn--primary btn--block',
        text: doneLabel,
        onclick: () => closeSheet(),
      }));
  }

  document.body.append(dialog);
  draw();

  const unsubscribe = store.subscribe(() => {
    if (dialog.isConnected) draw();
  });

  /* Klick auf die Verdunkelung schließt. Das Fenster selbst füllt nicht die
     ganze Fläche des dialog-Elements, deshalb reicht der Zieltest. */
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeSheet();
  });
  // Escape löst 'cancel' aus, nicht 'click'.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSheet();
  });

  current = { dialog, unsubscribe, onClose };

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');   // sehr alte Browser: wenigstens sichtbar

  document.documentElement.classList.add('has-sheet');
  return { close: closeSheet, redraw: draw };
}

/** Fenster schließen, falls eines offen ist. Mehrfachaufruf ist harmlos. */
export function closeSheet() {
  if (!current) return;
  const { dialog, unsubscribe, onClose } = current;
  current = null;

  unsubscribe();
  document.documentElement.classList.remove('has-sheet');
  try {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
  } catch { /* schon zu */ }
  dialog.remove();
  if (onClose) onClose();
}

/** Ist gerade ein Fenster offen? */
export function sheetIsOpen() {
  return current !== null;
}
