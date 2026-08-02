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
import { Spring, Tracker, project, rubberband, prefersReducedMotion } from './motion.js';

/** Nur ein Fenster gleichzeitig. Zwei übereinander sind auf 375 px unbenutzbar. */
let current = null;

/** Ab dieser Zugstrecke nach oben geht das Fenster auf ganze Höhe. */
const EXPAND_DISTANCE = 24;

/**
 * Anteil der Fensterhöhe, ab dem die PROJIZIERTE Endposition schließt.
 *
 * Projiziert, nicht gemessen: entschieden wird, wohin die Bewegung zeigt, nicht
 * wo der Finger losgelassen hat. Ein kurzer, schneller Wisch nach unten schließt
 * deshalb, auch wenn er nur 30 px weit ging.
 */
const CLOSE_FRACTION = 0.38;

/** Ab dieser Geschwindigkeit schließt es in jedem Fall — ein Wegwerfen. */
const CLOSE_VELOCITY = 900;

/**
 * Das Fenster steuern: Position, Unschärfe, Verdunkelung und der
 * zurücktretende Hintergrund hängen alle an EINEM Wert.
 *
 * Der Wert ist die Verschiebung nach unten in Pixeln: 0 heißt offen, Höhe des
 * Fensters heißt zu. Alles andere wird daraus abgeleitet — deshalb passen
 * Verdunkelung, Unschärfe und Maßstab in jedem Bild zusammen, auch wenn man
 * das Fenster mitten in der Bewegung greift und zurückzieht.
 */
function makeMotion(panel, dialog) {
  const app = document.getElementById('app');
  const height = () => panel.offsetHeight || 1;

  const paint = (y) => {
    const p = Math.max(0, Math.min(1, 1 - y / height()));   // 0 zu … 1 offen

    panel.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;

    /* Unschärfe und Maßstab laufen GEMEINSAM hoch. Eine Glasfläche, die nur
       eingeblendet wird, sieht aus wie ein Bild; eine, deren Unschärfe
       mitwächst, kommt an wie Material. */
    const blur = (10 + 22 * p).toFixed(1);
    panel.style.backdropFilter = `blur(${blur}px) saturate(180%)`;
    panel.style.webkitBackdropFilter = panel.style.backdropFilter;

    dialog.style.setProperty('--sheet-open', p.toFixed(3));

    /* Der Hintergrund tritt ZURÜCK, statt zu verschwinden: die App bleibt
       sichtbar, sie rückt nur eine Ebene nach hinten. Das geht nur, weil
       #app eine feste, bildschirmgroße Hülle ist — bei einem scrollenden
       Dokument würde das Skalieren den Inhalt verschieben. */
    if (app) {
      app.style.transform = p > 0.001
        ? `scale(${(1 - 0.04 * p).toFixed(4)}) translateY(${(-6 * p).toFixed(1)}px)`
        : '';
      app.style.borderRadius = p > 0.001 ? `${(20 * p).toFixed(0)}px` : '';
      app.style.overflow = p > 0.001 ? 'hidden' : '';
    }
  };

  const spring = new Spring(0, {
    damping: 0.86,          // ein Hauch Nachwippen: das Fenster wird geworfen
    response: 0.34,
    epsilon: 0.4,
    onChange: paint,
  });

  /* Aufräumen heißt: die App bekommt ihre eigenen Maße zurück.
     NICHT paint(0) — null ist die Position des OFFENEN Fensters, und die App
     bliebe klein und rund stehen. Die Stile werden gelöscht, nicht auf einen
     Wert gesetzt: was nicht mehr im Stilattribut steht, kann auch nicht mehr
     falsch sein. */
  const resetApp = () => {
    if (!app) return;
    app.style.transform = '';
    app.style.borderRadius = '';
    app.style.overflow = '';
  };

  return { spring, height, paint, resetApp };
}

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
function makeDraggable({ handles, dialog, motion, onClose }) {
  const { spring, height } = motion;
  const track = new Tracker();
  let dragging = false;
  let startY = 0;
  let base = 0;

  const stop = () => {
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };

  function onMove(event) {
    if (!dragging) return;
    track.push(event.clientY);
    const dy = event.clientY - startY;
    let y = base + dy;

    if (y < 0) {
      /* Nach oben ist Schluss — aber nicht hart. Solange das Fenster noch
         nicht auf ganzer Höhe steht, ist der Zug nach oben die Geste, die es
         aufzieht; danach federt es. */
      if (!dialog.classList.contains('sheet--full') && dy < -EXPAND_DISTANCE) {
        dialog.classList.add('sheet--full');
        base = 0;
        startY = event.clientY;
        y = 0;
      } else {
        y = -rubberband(-y, height());
      }
    }
    spring.set(y);
  }

  function onUp() {
    if (!dragging) return;
    stop();

    const velocity = track.velocity();
    /* Wohin zeigt die Bewegung? Nicht: wo wurde losgelassen. */
    const projected = spring.x + project(velocity);

    if (projected > height() * CLOSE_FRACTION || velocity > CLOSE_VELOCITY) {
      onClose(velocity);
      return;
    }
    /* Zurück an den Platz — MIT der Geschwindigkeit des Fingers. Ohne die
       Übergabe gäbe es genau hier die sichtbare Naht zwischen Ziehen und
       Animieren. */
    spring.to(0, velocity);
  }

  function onCancel() {
    if (!dragging) return;
    stop();
    spring.to(0);
  }

  const onDown = (event) => {
    // Nur der primäre Zeiger, und nicht mitten in einer laufenden Bewegung.
    if (dragging || event.button !== 0) return;
    dragging = true;
    startY = event.clientY;
    /* Vom AKTUELLEN Stand weiter, nicht von null: greift man das Fenster
       mitten im Schließen, folgt es sofort dem Finger, statt zu springen. */
    spring.stop();
    base = spring.x;
    track.reset();
    track.push(event.clientY);
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
 * @param {Function} [options.overlay]   () => Node, legt sich über ALLES —
 *   Kopf, Körper und Fuß. Für den einen Fall, in dem das Fenster den
 *   Bildschirm übernehmen darf: die abgelaufene Satzpause.
 * @param {string|Function} [options.doneLabel] Text des Schließen-Knopfes —
 *   als Funktion, wenn er sich mit dem Zustand ändern soll. Liefert sie
 *   `null`, gibt es gerade keinen Schließen-Knopf: dann steht im Fuß eine
 *   Entscheidung, an der man nicht vorbeigehen soll.
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
  store, title, eyebrow = null, body, footer = null, overlay = null,
  doneLabel = 'Abgeschlossen', doneTone = 'primary',
  onDone = null, onClose = null, tone = null,
}) {
  // Ein noch offenes Fenster verschwindet sofort, nicht mit Animation:
  // sonst liegen zwei übereinander.
  closeSheet({ instant: true });

  const bodySlot = el('div', { class: 'sheet__body' });
  const footSlot = el('div', { class: 'sheet__foot' });
  /* Liegt AUSSERHALB des Fensters, im Dialog selbst — sonst könnte es nur
     den scrollenden Körper verdecken und nicht den Bildschirm. */
  const overSlot = el('div', { class: 'sheet__overlay' });

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
  const dialog = el('dialog', { class: `sheet${tone ? ` sheet--${tone}` : ''}` },
    panel, overSlot);

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
    const label = typeof doneLabel === 'function' ? doneLabel() : doneLabel;
    replace(footSlot,
      footer ? footer() : null,
      label === null ? null : el('button', {
        type: 'button',
        class: `btn btn--block btn--${doneToneNow === 'ghost' ? 'ghost' : 'primary'}`,
        text: label,
        onclick: () => {
          if (onDone) onDone();
          closeSheet();
        },
      }));

    if (overlay) replace(overSlot, overlay());
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

  const motion = makeMotion(panel, dialog);
  const stopDragging = makeDraggable({
    handles: [grip, head],
    dialog,
    motion,
    onClose: (velocity) => closeSheet({ velocity }),
  });

  current = { dialog, panel, unsubscribe, onClose, stopDragging, motion };

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');   // sehr alte Browser: wenigstens sichtbar

  document.documentElement.classList.add('has-sheet');

  /* HEREINKOMMEN: von ganz unten auf null. Die Feder trägt hier ausnahmsweise
     die volle Höhe — anders als die alte Einblend-Animation, die bewusst nur
     14 px trug, damit ein ausgefallener Lauf das Fenster nicht unsichtbar
     lässt.
     Diese Sorge bleibt berechtigt, deshalb steht darunter die Reißleine: läuft
     die Feder nach 700 ms immer noch nicht (gedrosselte Zeitgeber, Tab im
     Hintergrund), wird das Fenster hart an seinen Platz gesetzt. Die Ruhelage
     ist immer die sichtbare. */
  const startHeight = panel.offsetHeight || window.innerHeight;
  motion.spring.set(startHeight);
  motion.spring.to(0);

  setTimeout(() => {
    if (current?.dialog === dialog && motion.spring.x > startHeight * 0.5) {
      motion.spring.set(0);
    }
  }, 700);

  return { close: closeSheet, redraw: draw, expand: () => dialog.classList.add('sheet--full') };
}

/**
 * Fenster schließen, falls eines offen ist. Mehrfachaufruf ist harmlos.
 *
 * Aufgeräumt wird SOFORT — Abmeldung vom Store und die Klasse am Dokument —,
 * das Element verschwindet erst nach der Bewegung. Andersherum würde eine
 * Eingabe während des Ausblendens noch in einen sterbenden Baum schreiben.
 */
export function closeSheet({ instant = false, velocity } = {}) {
  if (!current) return;
  const { dialog, panel, unsubscribe, onClose, stopDragging, motion } = current;
  current = null;

  unsubscribe();
  /* Die Zieh-Zuhörer hängen am Fenster, nicht am Dialog — sie verschwinden
     nicht mit dem Element und müssen abgemeldet werden. */
  stopDragging();
  document.documentElement.classList.remove('has-sheet');

  /* Zwei Wege führen zum Entfernen — die Feder und die Reißleine darunter.
     Ohne diesen Riegel liefe onClose zweimal, und onClose kann etwas tun,
     das nicht zweimal passieren darf. */
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;

    /* Den zurückgetretenen Hintergrund zurückholen, BEVOR das Fenster
       verschwindet — sonst bliebe die App klein und rund stehen. */
    motion.resetApp();
    try {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    } catch { /* schon zu */ }
    dialog.remove();
    if (onClose) onClose();
  };

  if (instant || prefersReducedMotion()) {
    remove();
    return;
  }

  /* Nach unten hinausgleiten — mit der Geschwindigkeit, mit der es geworfen
     wurde. `onRest` statt eines Zeitgebers: die Feder hat keine Dauer, an der
     man einen Zeitgeber ausrichten könnte. */
  motion.spring.onRest = remove;
  motion.spring.to(motion.height(), velocity);

  /* Dieselbe Reißleine wie beim Öffnen: kommt die Feder nicht ans Ziel, darf
     das Fenster trotzdem nicht liegen bleiben. */
  setTimeout(() => {
    if (dialog.isConnected) remove();
  }, 900);
}
