/* Das Trainingsfenster — mitlaufende Uhr, Sätze, Pausen.
 *
 * Drei Dinge machen den Unterschied zwischen einem Logger, den man benutzt,
 * und einem, den man nach zwei Wochen liegen lässt:
 *
 *   1. "Letztes Mal" steht DIREKT an der Übung. Ohne das ist Progression
 *      Ratespiel — niemand erinnert sich an das Gewicht von vor einer Woche.
 *   2. Eintippen ohne Zwischenschritte. Zwei Felder pro Satz, sofort
 *      gespeichert, kein Absenden.
 *   3. Die Pause läuft von allein UND steht da, wo man gerade ist: als
 *      Countdown in der angehefteten Kopfleiste und als Balken direkt in der
 *      Karte der Übung, deren Satz gerade vorbei ist. Wer bei Übung fünf
 *      steht, scrollt nicht zur Uhr — die Uhr kommt zu ihm.
 *
 * DIE UHR ENDET NUR AUF ANSAGE. „Training beenden" setzt `endedAt` — das
 * Wegwischen des Fensters tut es nicht. Wer zwischendurch rauswischt (Musik
 * wechseln, Nachricht tippen), führt sein Training später einfach weiter, und
 * die Dauer stimmt trotzdem. Vergisst man das Beenden ganz, schließt der
 * nächste App-Start die Einheit rückwirkend auf den letzten Satz
 * (lib/state.js, withStaleSessionsClosed).
 *
 * DIE UHR LÄUFT NUR AM TAG DER EINHEIT. Wer einen vergangenen Tag nachträgt,
 * bekommt keine erfundene Dauer — dann bleibt sie leer.
 *
 * DIE PAUSE STEHT NICHT IM ZUSTAND. Sie liegt in einem eigenen
 * localStorage-Eintrag, nicht in `lebenstracker.v1`: eine Pause ist kein
 * Messwert, sie hat in der Exportdatei nichts zu suchen. Gespeichert wird sie
 * trotzdem — wer während des Trainings die App wegwischt, soll den Countdown
 * beim Zurückkommen weiterlaufen sehen.
 *
 * WÄHREND DER PAUSE GEHEN KEINE WIEDERHOLUNGEN REIN. Flockes Vorgabe, und
 * sie ist logisch: eine laufende Pause heißt, dass der letzte Satz vorbei ist
 * und der nächste noch nicht angefangen hat. Es gibt in diesem Moment keine
 * Wiederholung, die man ehrlich eintragen könnte — wohl aber ein Gewicht, das
 * man für den nächsten Satz schon an der Hantel stehen hat. Also: Gewichte
 * ja, Wiederholungen nein.
 */

import { formatDayShort, formatDayLong, todayKey } from '../lib/dates.js';
import {
  getDay, getSets, getSession, lastPerformance, sessionMinutes,
  hasLoggedSets, withoutSession, skippedExercises,
} from '../lib/state.js';
import { legVolumeAllowance, exerciseBlockReason } from '../lib/planner.js';
import { readinessScore, trainingGuidance } from '../lib/readiness.js';
import { totalSets, tonnage } from '../lib/volume.js';
import { EXERCISES, exercise } from '../../data/exercises.js';
import { sessionExercises } from '../../data/plan-default.js';
import {
  el, decimalInput, parseDecimal, toInputValue, dec, kg, setCount, setWord,
} from './dom.js';
import { openSheet } from './sheet.js';
import { liveText, liveWidth, liveApply, formatSeconds, formatDuration } from './clock.js';

/** Satzpause in Sekunden. Flockes Vorgabe: drei Minuten. */
export const REST_SECONDS = 180;

/** Ein Griff mehr Pause, wenn der Satz härter war als gedacht. */
const REST_BUMP = 30;

/** Unter dieser Restzeit gilt die Pause als Endphase (Anzeige springt um). */
const REST_SOON = 10;

/**
 * So lange wartet der grüne Bildschirm auf „Schließen".
 *
 * Die abgelaufene Pause verschwindet NICHT von selbst — sie wird weggetippt.
 * Trotzdem braucht sie eine Grenze: wer das Fenster wegwischt und zwei
 * Stunden später denselben Tag noch mal öffnet, will nicht von einem grünen
 * Bildschirm begrüßt werden, der zu einem Satz von vorhin gehört. Eine halbe
 * Stunde ist länger als jeder Gang zur Toilette und kürzer als jede Pause,
 * die noch etwas bedeutet.
 */
const REST_OVER_GRACE_MS = 30 * 60_000;

const REST_STORAGE_KEY = 'lebenstracker.rest';

/* ─── Pausenuhr ──────────────────────────────────────────────────────────── */

function readRest() {
  try {
    const raw = globalThis.localStorage?.getItem(REST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.until !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRest(value) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(REST_STORAGE_KEY);
    else globalThis.localStorage?.setItem(REST_STORAGE_KEY, JSON.stringify(value));
  } catch { /* privater Modus — dann läuft die Pause nur im Speicher */ }
}

/**
 * Die Pause DIESER Einheit, oder null.
 *
 * Der Eintrag trägt Tag und Einheit, damit ein Fenster nie den Countdown
 * eines anderen Trainings zeigt — etwa wenn nach dem Wegwischen ein alter
 * Tag zum Nachtragen geöffnet wird. Abgelaufene Pausen zählen weiter als
 * „vorbei"-Anzeige, bis sie weggetippt sind oder zu alt werden.
 */
function restFor(dayKey, planId) {
  const rest = readRest();
  if (!rest || rest.dayKey !== dayKey || rest.planId !== planId) return null;
  if (rest.until + REST_OVER_GRACE_MS <= Date.now()) return null;
  return rest;
}

function startRest({ dayKey, planId, exId, label, seconds }) {
  writeRest({
    until: Date.now() + seconds * 1000,
    seconds, label, dayKey, planId, exId,
  });
}

const restSecondsLeft = (rest) => Math.max(0, (rest.until - Date.now()) / 1000);

/** run → soon (Endphase) → over (abgelaufen), für die Farb- und Textzustände. */
const restPhase = (rest) => {
  const left = restSecondsLeft(rest);
  if (left <= 0) return 'over';
  if (left <= REST_SOON) return 'soon';
  return 'run';
};

/** Läuft die Uhr noch? Genau dann sind die Wiederholungsfelder gesperrt. */
const restRunning = (rest) => Boolean(rest) && restSecondsLeft(rest) > 0;

/**
 * Der Pausenbalken in der Übungskarte.
 *
 * Zahl UND Balken: die Zahl sagt, wie lange noch, der Balken sagt es ohne
 * Lesen. Beides läuft über den Sekundentakt aus clock.js und rührt den Rest
 * des Fensters nicht an — sonst wäre die Tastatur bei jedem Tick weg.
 * Läuft die Zeit ab, springt die Karte auf „Weiter geht's" um, ohne dass
 * neu gezeichnet werden muss.
 */
function restBar(rest, redraw) {
  const bump = () => {
    /* Nicht über readRest(): kurz nach Ablauf soll „+30 s" die Pause
       wiederbeleben, nicht ins Leere greifen. */
    writeRest({
      ...rest,
      until: Math.max(rest.until, Date.now()) + REST_BUMP * 1000,
      seconds: rest.seconds + REST_BUMP,
    });
    redraw();
  };

  const box = el('div', { class: 'rest', role: 'status' },
    el('div', { class: 'rest__head' },
      el('span', { class: 'rest__label', text: rest.label }),
      el('span', null,
        liveText(() => formatSeconds(restSecondsLeft(rest)), { class: 'rest__time' }),
        el('span', { class: 'rest__go', text: 'Weiter geht’s' }))),
    el('div', { class: 'rest__track' },
      liveWidth(() => restSecondsLeft(rest) / rest.seconds, { class: 'rest__fill' })),
    el('p', {
      class: 'rest__lock',
      text: 'Wiederholungen sind gesperrt, solange die Pause läuft — '
        + 'Gewichte kannst du schon eintragen.',
    }),
    el('div', { class: 'rest__tools' },
      el('button', {
        type: 'button', class: 'btn btn--small rest__bump',
        text: `+${REST_BUMP} s`,
        onclick: bump,
      }),
      el('button', {
        type: 'button', class: 'btn btn--small btn--ghost',
        text: 'Überspringen',
        onclick: () => { writeRest(null); redraw(); },
      })));

  return liveApply(box, () => restPhase(rest), (node, phase) => {
    node.classList.toggle('rest--soon', phase === 'soon');
    node.classList.toggle('rest--over', phase === 'over');
  });
}

/* ─── Der grüne Bildschirm, wenn die Pause um ist ────────────────────────── */

/**
 * Flockes Vorgabe: ist die Pause vorbei, wird der Bildschirm grün und bleibt
 * es, bis man unten „Schließen" drückt.
 *
 * Warum das so gebaut ist und nicht als eigenes Fenster: der Kasten liegt von
 * Anfang an im Baum und wird vom Sekundentakt nur SICHTBAR GESCHALTET. Ein
 * Overlay, das erst beim Neuzeichnen entsteht, käme nämlich genau dann nicht —
 * das Fenster zeichnet nur bei Eingaben neu, und während der Pause tippt
 * niemand. Man würde also warten, bis man selbst etwas tut, um zu erfahren,
 * dass man nicht mehr warten muss.
 *
 * Er verschwindet NUR auf Tastendruck. Das ist der Punkt: ein grüner Blitz,
 * den man verpasst, während man zum Trinken geht, ist kein Signal.
 */
function restDone(rest, onClose) {
  const box = el('div', { class: 'restdone', role: 'status' },
    el('div', { class: 'restdone__body' },
      el('p', { class: 'restdone__lead', text: 'Weiter geht’s' }),
      el('p', { class: 'restdone__shout', text: 'du Maschine 🔥' }),
      el('p', { class: 'restdone__label', text: rest.label })),
    el('div', { class: 'restdone__foot' },
      el('button', {
        type: 'button',
        class: 'btn btn--block restdone__close',
        text: 'Schließen',
        onclick: onClose,
      })));

  return liveApply(box, () => restPhase(rest) === 'over', (node, over) => {
    node.classList.toggle('restdone--on', over);
  });
}

/* ─── Angeheftete Kopfleiste: Dauer, Sätze, Pause ────────────────────────── */

/**
 * Die drei Zahlen, auf die man zwischen den Sätzen schaut — immer sichtbar,
 * egal wie tief man in der Übungsliste steckt. Die Pausenzelle springt zur
 * laufenden Pause, damit „+30 s" nie weiter als einen Tipp entfernt ist.
 */
function sessionBar(liveSessionMinutes, doneTotal, plannedTotal, rest) {
  const pauseCell = rest
    ? el('button', {
      type: 'button',
      class: 'session-bar__cell session-bar__cell--tap',
      'aria-label': 'Zur laufenden Pause springen',
      onclick: (event) => {
        /* Sofortiger Sprung, kein smooth: weiches Scrollen fällt in
           gesperrten Layouts (has-sheet) stillschweigend aus — ein Sprung,
           der immer ankommt, schlägt eine Animation, die manchmal kommt. */
        event.currentTarget.closest('.sheet__body')
          ?.querySelector('.exercise .rest')
          ?.scrollIntoView({ block: 'center' });
      },
    },
      liveText(() => formatSeconds(restSecondsLeft(rest)),
        { class: 'session-bar__value session-bar__value--rest' }),
      el('span', { class: 'session-bar__label', text: 'Pause' }))
    : el('div', { class: 'session-bar__cell' },
      el('span', { class: 'session-bar__value session-bar__value--idle', text: '—' }),
      el('span', { class: 'session-bar__label', text: 'Pause' }));

  const bar = el('div', { class: 'session-bar' },
    el('div', { class: 'session-bar__cell' },
      liveText(() => {
        const minutes = liveSessionMinutes();
        return minutes === null ? '—' : formatDuration(minutes * 60);
      }, { class: 'session-bar__value' }),
      el('span', { class: 'session-bar__label', text: 'Dauer' })),
    el('div', { class: 'session-bar__cell' },
      el('span', { class: 'session-bar__value', text: `${doneTotal}/${plannedTotal}` }),
      el('span', { class: 'session-bar__label', text: 'Sätze' })),
    pauseCell,
    rest
      ? el('div', { class: 'session-bar__restline' },
        liveWidth(() => restSecondsLeft(rest) / rest.seconds, { class: 'session-bar__restfill' }))
      : null);

  return rest
    ? liveApply(bar, () => restPhase(rest), (node, phase) => {
      node.classList.toggle('session-bar--soon', phase === 'soon');
      node.classList.toggle('session-bar--over', phase === 'over');
    })
    : bar;
}

/* ─── Satzzeilen ─────────────────────────────────────────────────────────── */

function setRow(store, dayKey, planId, exId, index, set, entry, redraw) {
  const done = Boolean(set && set.reps !== null && set.reps !== undefined);

  const write = (field) => (event) => {
    const value = parseDecimal(event.target.value);
    const wasDone = Boolean(set?.reps ?? null);
    try {
      store.setSet(dayKey, planId, exId, index, { [field]: value });
      /* Die Pause startet, wenn die WIEDERHOLUNGEN eingetragen werden — das
         ist der Moment, in dem der Satz vorbei ist. Nicht beim Gewicht: das
         trägt man oft vorher ein. Und nicht erneut, wenn man eine Zahl nur
         korrigiert. */
      if (field === 'reps' && value !== null && !wasDone) {
        const meta = { lastSetAt: new Date().toISOString() };
        /* Ein neuer Satz auf einer schon beendeten Einheit heißt: es geht
           doch weiter. Die Uhr läuft wieder — beendet wird auf Ansage, nicht
           nebenbei. Nur am Tag selbst; Nachträge wecken keine Uhr.

           Fortsetzen heißt fortsetzen, nicht rückwirkend durchlaufen: die
           Lücke zwischen Beenden und Weitermachen ist keine Trainingszeit.
           Der Start wird so verschoben, dass die bisherige Dauer stehen
           bleibt und ab jetzt einfach weiterzählt. */
        const logged = getSession(store.getState(), dayKey, planId);
        if (dayKey === todayKey() && logged?.startedAt && logged?.endedAt) {
          const priorMs = Math.max(0,
            new Date(logged.endedAt) - new Date(logged.startedAt));
          meta.startedAt = new Date(Date.now() - priorMs).toISOString();
          meta.endedAt = null;
        }
        store.setSessionMeta(dayKey, planId, meta);
        startRest({
          dayKey, planId, exId,
          label: `Satz ${index + 1} ist durch`,
          seconds: entry.rest ?? REST_SECONDS,
        });
        redraw();
      }
    } catch (err) {
      event.target.value = '';
      console.warn('[session]', err.message);
    }
  };

  return el('div', { class: `setrow${done ? ' setrow--done' : ''}` },
    el('span', { class: 'setrow__index', text: String(index + 1) }),
    decimalInput({
      /* Die Klasse ist kein Schmuck: über sie findet der Sekundentakt in
         openSession alle Wiederholungsfelder, um sie während der Pause zu
         sperren und danach wieder freizugeben. */
      class: 'setrow__reps',
      value: toInputValue(set?.reps ?? null),
      placeholder: entry.unit === 'Sekunden' ? 'Sek.' : 'Wdh.',
      'aria-label': `Satz ${index + 1}, Wiederholungen`,
      onchange: write('reps'),
    }),
    decimalInput({
      value: toInputValue(set?.kg ?? null),
      placeholder: 'kg',
      'aria-label': `Satz ${index + 1}, Gewicht in Kilogramm`,
      onchange: write('kg'),
    }),
    el('span', {
      class: 'setrow__tick',
      text: done ? '✓' : '',
      'aria-hidden': 'true',
    }));
}

/* ─── Übung ──────────────────────────────────────────────────────────────── */

function lastText(state, dayKey, exId) {
  const last = lastPerformance(state, dayKey, exId);
  if (!last) return 'Erstes Mal — trag ein, was du schaffst.';
  const sets = last.sets
    .map((s) => (s.kg ? `${dec(s.reps, 0)}×${kg(s.kg)}` : `${dec(s.reps, 0)}`))
    .join('  ');
  return `Letztes Mal ${formatDayShort(last.dayKey)} — ${sets}`;
}

/**
 * Eine Übung mit ihren Satzzeilen.
 *
 * DER PLAN IST DAS ZIEL, IMMER. Hier stand vorher `entry.sets + setsDelta` als
 * Satzzahl — bei niedriger Bereitschaft wurden aus 3 geplanten Sätzen also 1,
 * und zwar überall gleichzeitig. Das war falsch, und zwar aus zwei Gründen:
 *
 *   Es hat Flockes Plan überschrieben. Die Satzzahlen sind seine Vorgabe, keine
 *   Empfehlung der App — die App darf sie nicht stillschweigend kürzen.
 *
 *   Und es hat das Loggen verhindert. Wer sich beim zweiten Satz doch gut
 *   fühlt, hatte keine Zeile mehr für den dritten.
 *
 * Richtig ist: die geplante Satzzahl steht da, es gibt so viele Zeilen wie
 * geplante Sätze, und die Reduktion erscheint als sichtbarer HINWEIS an der
 * Übung. Ein Hinweis, den man ignorieren kann, ist ehrlicher als eine
 * Kürzung, die man nicht sieht.
 *
 * Die Satzpause steht als fester Wert an jeder Übung — und läuft sie, dann
 * liegt der Countdown-Balken GENAU HIER, unter den Satzzeilen dieser Übung.
 *
 * EINE ENTFALLENE ÜBUNG BLEIBT STEHEN, aber ohne Zeilen. Wer sie beim
 * Abschließen hat entfallen lassen, soll sehen, dass es sie gab — und sie mit
 * einem Tipp zurückholen können. Sie wegzublenden würde aussehen wie ein
 * Fehler im Plan.
 */
function exerciseCard(
  store, state, dayKey, planId, entry, setsDelta, legLevel, rest, skipped, unskip, redraw
) {
  const ex = exercise(entry.id);
  const blocked = exerciseBlockReason(
    { loadsLegs: EXERCISES[entry.id].loadsLegs, prophylaxis: entry.prophylaxis },
    legLevel
  );

  if (skipped) {
    return el('div', { class: 'exercise exercise--skipped' },
      el('div', { class: 'card__head' },
        el('span', null,
          el('span', { class: 'exercise__name', text: ex.name }),
          ex.variant ? el('span', { class: 'exercise__variant', text: ` ${ex.variant}` }) : null),
        el('span', { class: 'chip', text: 'entfallen' })),
      el('p', {
        class: 'exercise__last',
        text: 'Für dieses Training entfallen — sie zählt nicht als offen.',
      }),
      el('button', {
        type: 'button', class: 'btn btn--small btn--ghost',
        text: 'doch noch machen',
        onclick: unskip,
      }));
  }

  const plannedSets = entry.sets;
  // Empfehlung, nicht Vorgabe. Nie unter einen Satz, nie über den Plan.
  const advisedSets = blocked
    ? plannedSets
    : Math.min(plannedSets, Math.max(1, plannedSets + setsDelta));

  const logged = getSets(state, dayKey, planId, entry.id);
  const doneHere = logged.filter(Boolean).length;
  const rowCount = Math.max(plannedSets, logged.length);
  const complete = doneHere >= advisedSets;

  const target = `${plannedSets} × ${entry.repsMin}–${entry.repsMax}`
    + (entry.unit === 'Sekunden' ? ' Sek.' : '')
    + ` @ RPE ${entry.rpe}`;
  const restHere = rest && rest.exId === entry.id && !blocked;

  return el('div', {
    class: `exercise${blocked ? ' exercise--blocked' : ''}${complete ? ' exercise--complete' : ''}`,
  },
    el('div', { class: 'card__head' },
      el('span', null,
        el('span', { class: 'exercise__name', text: ex.name }),
        ex.variant ? el('span', { class: 'exercise__variant', text: ` ${ex.variant}` }) : null),
      el('span', { class: 'exercise__target' },
        el('span', { text: target }),
        el('span', {
          class: 'exercise__pause',
          text: `Pause ${formatSeconds(entry.rest ?? REST_SECONDS)}`,
        }))),

    blocked
      ? el('p', { class: 'exercise__last', text: blocked })
      : el('p', { class: 'exercise__last', text: lastText(state, dayKey, entry.id) }),

    advisedSets < plannedSets
      ? el('p', { class: 'exercise__advice' },
        el('b', { text: `Heute ${setCount(advisedSets)} von ${plannedSets}` }),
        ' — alle Zeilen bleiben trotzdem da.')
      : null,

    blocked ? null : el('div', null,
      el('div', { class: 'setrow__head' },
        el('span', { text: '' }),
        el('span', { text: entry.unit === 'Sekunden' ? 'Sekunden' : 'Wdh.' }),
        el('span', { text: 'kg' }),
        el('span', { text: '' })),
      Array.from({ length: rowCount }, (_, i) =>
        setRow(store, dayKey, planId, entry.id, i, logged[i] ?? null, entry, redraw))),

    restHere ? restBar(rest, redraw) : null,

    entry.goal ? el('p', { class: 'exercise__note', text: entry.goal }) : null,
    ex.note && !blocked ? el('p', { class: 'exercise__note', text: ex.note }) : null);
}

/* ─── Abschlussbild ──────────────────────────────────────────────────────── */

/**
 * Was nach „Training abschließen" auf dem Screen steht: die Dauer, groß.
 *
 * Das ist die Zahl, für die die Stoppuhr überhaupt läuft — „so lange war ich
 * im Gym". Sätze und bewegtes Gewicht stehen daneben, weil sie dieselbe
 * Frage aus zwei anderen Richtungen beantworten: War das ein Training?
 */
function finishSummary(state, dayKey, session) {
  const logged = getSession(state, dayKey, session.id);
  const minutes = sessionMinutes(logged ?? {});
  const sets = totalSets(logged ? [logged] : []);
  const moved = tonnage(logged ? [logged] : []);

  return el('div', { class: 'finish' },
    el('span', { class: 'eyebrow', text: 'Training abgeschlossen' }),
    el('p', {
      class: 'finish__time',
      text: minutes === null ? '—' : formatDuration(minutes * 60),
    }),
    el('p', {
      class: 'finish__label',
      text: minutes === null
        ? `${session.name} — ohne Uhr nachgetragen`
        : `im Gym — ${session.name}`,
    }),
    el('div', { class: 'finish__stats' },
      el('span', { class: 'finish__stat' },
        el('b', { text: String(sets) }), ` ${setWord(sets)}`),
      moved > 0
        ? el('span', { class: 'finish__stat' },
          el('b', { text: Math.round(moved).toLocaleString('de-DE') }), ' kg bewegt')
        : null),
    el('p', {
      class: 'finish__note',
      text: 'Die Dauer bleibt an der Einheit gespeichert — sie steht auf der '
        + 'Trainingsseite und im Heute-Screen.',
    }));
}

/* ─── Die Nachfrage vor dem Abschließen ──────────────────────────────────── */

/**
 * Was auf dem Screen steht, wenn beim Abschließen noch Übungen offen sind.
 *
 * Flockes Vorgabe: abschließen können MUSS gehen, auch wenn eine Übung
 * ausfällt — die Maschine war belegt, die Zeit war um, der Rücken hat gezwickt.
 * Aber nicht stillschweigend. Deshalb steht hier namentlich, worum es geht,
 * bevor irgendetwas geschrieben wird.
 *
 * Warum ein Bild im Fenster und kein confirm(): ein Systemdialog kann keine
 * Liste zeigen, sieht auf dem iPhone aus wie ein Fehler und wird in einer zum
 * Homescreen hinzugefügten App gerne mal ganz unterdrückt. Eine Frage, die
 * nicht ankommt, ist schlimmer als keine.
 */
function finishConfirm(open) {
  return el('div', { class: 'confirm' },
    el('span', { class: 'eyebrow', text: 'Wirklich abschließen?' }),
    el('p', {
      class: 'confirm__lead',
      text: open.length === 1
        ? 'Eine geplante Übung steht noch ohne einen einzigen Satz da:'
        : `${open.length} geplante Übungen stehen noch ohne einen einzigen Satz da:`,
    }),
    el('ul', { class: 'confirm__list' },
      open.map((entry) => {
        const ex = exercise(entry.id);
        return el('li', { class: 'confirm__row' },
          el('span', { class: 'confirm__name' },
            ex.name,
            ex.variant
              ? el('span', { class: 'exercise__variant', text: ` ${ex.variant}` })
              : null),
          el('span', {
            class: 'confirm__target',
            text: `${entry.sets}×${entry.repsMin}–${entry.repsMax}`,
          }));
      })),
    el('p', {
      class: 'confirm__note',
      text: open.length === 1
        ? 'Schließt du jetzt ab, entfällt sie für dieses Training. Sie zählt '
          + 'dann nicht mehr als offen, und die Satzzahl oben rechnet ohne sie. '
          + 'Im Plan steht sie nächste Woche wieder.'
        : 'Schließt du jetzt ab, entfallen sie für dieses Training. Sie zählen '
          + 'dann nicht mehr als offen, und die Satzzahl oben rechnet ohne sie. '
          + 'Im Plan stehen sie nächste Woche wieder.',
    }));
}

/* ─── Fenster ────────────────────────────────────────────────────────────── */

/**
 * Trainingsfenster öffnen.
 *
 * DIE STOPPUHR IST DER RAHMEN DES BESUCHS: „Training starten" drückt sie an,
 * „Training abschließen" hält sie an und zeigt als Abschlussbild, wie lange
 * der Gym-Besuch gedauert hat — mit Sätzen und bewegtem Gewicht dazu.
 *
 * Für die HEUTIGE Einheit startet die Uhr schon mit dem Öffnen: der Knopf auf
 * der Karte heißt „Training starten", und genau das soll er tun. Für jede
 * andere Einheit (vorgezogen, verschoben, nachgeholt) liegt der Startknopf
 * unten im Fenster — die App erfindet keine Dauer für einen Tag, an dem nur
 * nachgetragen wird, aber sie verweigert die Stoppuhr auch niemandem, der
 * wirklich gerade trainiert.
 *
 * „Schließen", Wegwischen, ×, Escape — alles lässt die Uhr weiterlaufen und
 * die Trainingsseite zeigt „läuft". Nur „Training abschließen" beendet.
 * Abschließen ohne einen einzigen Satz verwirft die leere Einheit.
 *
 * ABSCHLIESSEN GEHT IMMER — aber offene Übungen werden vorher benannt. Wer
 * bestätigt, lässt sie für DIESES Training entfallen; der Plan selbst bleibt
 * unangetastet.
 */
export function openSession(store, dayKey, session) {
  const isToday = dayKey === todayKey();
  const existing = getSession(store.getState(), dayKey, session.id);
  if (isToday && !existing?.startedAt && !existing?.endedAt) {
    store.setSessionMeta(dayKey, session.id, { startedAt: new Date().toISOString() });
  }

  let handle = null;
  const redraw = () => handle?.redraw();

  /* Nach „Training abschließen" zeigt das Fenster das Abschlussbild statt der
     Übungsliste. Der Merker lebt nur in diesem Fenster: wer die Einheit
     später wieder öffnet, sieht ganz normal seine Sätze. */
  let justEnded = false;

  /* Solange hier eine Liste steht, zeigt das Fenster die Nachfrage vor dem
     Abschließen — und sonst nichts. */
  let confirming = null;

  const liveSession = () => getSession(store.getState(), dayKey, session.id);
  const isRunning = () => {
    const logged = liveSession();
    return Boolean(logged?.startedAt && !logged.endedAt);
  };

  /* Bereitschaft und Beinsperre für DIESEN Tag. Steht hier und nicht im
     Körper, weil die Nachfrage beim Abschließen dieselbe Rechnung braucht:
     eine gesperrte Beinübung ist keine ausgelassene — die hat der Plan
     selbst zurückgezogen. */
  const guidanceNow = (state) => {
    const profile = state.profile;
    const allowance = legVolumeAllowance(dayKey, {
      matchDayWeekday: profile.matchDayWeekday,
      teamTrainingWeekdays: profile.teamTrainingWeekdays ?? [],
    });
    return trainingGuidance(readinessScore(getDay(state, dayKey).checkin), allowance);
  };

  const isBlocked = (entry, legLevel) => Boolean(exerciseBlockReason(
    { loadsLegs: EXERCISES[entry.id].loadsLegs, prophylaxis: entry.prophylaxis },
    legLevel
  ));

  /** Geplante, nicht gesperrte Übungen ohne einen einzigen Satz. */
  const openExercises = () => {
    const state = store.getState();
    const legLevel = guidanceNow(state).legLevel;
    return sessionExercises(session).filter((entry) =>
      !isBlocked(entry, legLevel)
      && getSets(state, dayKey, session.id, entry.id).filter(Boolean).length === 0);
  };

  const finish = () => {
    const logged = liveSession();
    writeRest(null);
    if (!logged || (!hasLoggedSets(logged) && logged.sessionRpe == null)) {
      /* Abgeschlossen ohne einen einzigen Satz: da war kein Training. Die
         leere Hülle verschwindet, statt in Reviews als Trainingstag zu
         zählen — und ein Abschlussbild über nichts gibt es auch nicht. */
      store.update((s) => withoutSession(s, dayKey, session.id));
      handle?.close();
      return;
    }
    justEnded = true;
    store.setSessionMeta(dayKey, session.id, { endedAt: new Date().toISOString() });
  };

  /**
   * „Training abschließen" — mit Nachfrage, wenn Übungen offen sind.
   *
   * Ohne einen einzigen geloggten Satz wird NICHT gefragt: da gibt es keine
   * ausgelassene Übung, da gibt es nur kein Training. Diese Einheit wird
   * verworfen, und eine Frage danach wäre eine Frage zu viel.
   */
  const askFinish = () => {
    const logged = liveSession();
    if (!logged || !hasLoggedSets(logged)) { finish(); return; }

    const open = openExercises();
    if (open.length === 0) { finish(); return; }
    confirming = open;
    redraw();
  };

  const confirmFinish = () => {
    const ids = confirming.map((entry) => entry.id);
    /* Erst den Merker löschen, dann schreiben: jeder Schreibvorgang zeichnet
       das Fenster neu, und es soll dabei nicht noch einmal die Frage zeigen,
       die gerade beantwortet wurde. */
    confirming = null;
    store.setSessionMeta(dayKey, session.id, { skipped: ids });
    finish();
  };

  /** Eine entfallene Übung zurückholen. */
  const unskip = (exId) => {
    const current = skippedExercises(liveSession());
    store.setSessionMeta(dayKey, session.id,
      { skipped: current.filter((id) => id !== exId) });
  };

  handle = openSheet({
    /* Zustand BEIM ÖFFNEN: eine beendete Einheit heißt nicht „läuft", nur
       weil heute ist. Der Fuß des Fensters zieht bei jedem Zeichnen nach. */
    store,
    eyebrow: isRunning() ? 'Training läuft' : isToday ? 'Heute' : formatDayLong(dayKey),
    title: session.name,
    /* Während der Nachfrage gibt es KEIN „Schließen": dort stehen zwei
       Antworten, und an einer davon soll man nicht vorbeikommen. */
    doneLabel: () => (confirming ? null : 'Schließen'),
    /* „Schließen" tritt zurück, solange unten eine wichtigere Handlung
       steht — Starten oder Abschließen. */
    doneTone: () => {
      const logged = liveSession();
      const finishedView = Boolean(logged?.endedAt) && hasLoggedSets(logged);
      return justEnded || (!isRunning() && finishedView) ? 'primary' : 'ghost';
    },
    footer: () => {
      if (justEnded) return null;
      if (confirming) {
        return [
          el('button', {
            type: 'button', class: 'btn btn--primary btn--block',
            text: confirming.length === 1
              ? 'Abschließen, Übung entfällt'
              : 'Abschließen, Übungen entfallen',
            onclick: confirmFinish,
          }),
          el('button', {
            type: 'button', class: 'btn btn--block btn--ghost',
            text: 'Zurück zum Training',
            onclick: () => { confirming = null; redraw(); },
          }),
        ];
      }
      if (isRunning()) {
        return el('button', {
          type: 'button', class: 'btn btn--primary btn--block',
          text: 'Training abschließen',
          onclick: askFinish,
        });
      }
      const logged = liveSession();
      // Eine fertige Einheit MIT Sätzen wird nur noch angesehen.
      if (logged?.endedAt && hasLoggedSets(logged)) return null;
      /* startedAt UND endedAt setzen: für frische Einheiten ist endedAt
         ohnehin leer, und eine beendete leere Hülle (Altversion, Versehen)
         wird damit wiederbelebt statt den Start zu verdecken. */
      return el('button', {
        type: 'button', class: 'btn btn--primary btn--block',
        text: 'Training starten',
        onclick: () => store.setSessionMeta(dayKey, session.id,
          { startedAt: new Date().toISOString(), endedAt: null }),
      });
    },
    body: () => {
      if (justEnded) return finishSummary(store.getState(), dayKey, session);
      if (confirming) return finishConfirm(confirming);
      const state = store.getState();
      const guidance = guidanceNow(state);

      /* Entfallene Übungen zählen nicht mehr mit — weder als offener Satz
         noch im Nenner. Genau das heißt „entfällt für dieses Training". */
      const skipped = new Set(skippedExercises(liveSession()));

      /* Gezählt wird gegen den PLAN, nicht gegen die Empfehlung. „7/13" muss
         dieselbe Zahl im Nenner haben wie die Trainingsseite und der Plan —
         sonst bedeutet derselbe Bruch an zwei Stellen etwas anderes. */
      const entries = sessionExercises(session);
      const plannedTotal = entries.reduce((sum, e) => {
        if (skipped.has(e.id) || isBlocked(e, guidance.legLevel)) return sum;
        return sum + e.sets;
      }, 0);
      const doneTotal = totalSets(getDay(state, dayKey).sessions
        .filter((s) => s.planId === session.id));

      const rest = restFor(dayKey, session.id);

      const view = el('div', null,
        sessionBar(
          () => sessionMinutes(liveSession() ?? {}, Date.now()),
          doneTotal, plannedTotal, rest
        ),

        doneTotal === 0 && !rest
          ? el('p', {
            class: 'field__hint',
            text: 'Die Pausenuhr startet von allein, sobald du bei einem Satz '
              + 'die Wiederholungen einträgst — und zählt dann hier oben und '
              + 'direkt an der Übung.',
          })
          : null,

        guidance.setsDelta !== 0
          ? el('div', { class: 'notice notice--warn' },
            el('span', { class: 'notice__title', text: guidance.headline }),
            `${guidance.detail} Vorschlag für heute: `
            + `${setCount(Math.abs(guidance.setsDelta))} weniger pro Übung, `
            + `RPE höchstens ${guidance.rpeCap}. `
            + 'Der Plan bleibt stehen — du entscheidest.')
          : null,

        /* Die Einleitung der Einheit — Lektüre fürs Aufwärmen. Sobald der
           erste Satz geloggt ist, verschwindet sie: dann wird trainiert,
           nicht gelesen. */
        doneTotal === 0 && session.intro
          ? el('p', { class: 'block__intro', text: session.intro })
          : null,

        session.blocks.map((block) =>
          el('div', { class: 'block' },
            // Ein Block ohne Namen bekommt keine Überschrift — der aktuelle
            // Plan hat pro Tag genau einen.
            block.name
              ? el('div', { class: 'block__title' },
                el('span', { class: 'block__name', text: block.name }))
              : null,
            block.intro ? el('p', { class: 'block__intro', text: block.intro }) : null,
            block.exercises.map((e) =>
              exerciseCard(
                store, state, dayKey, session.id,
                { ...e, prophylaxis: Boolean(block.prophylaxis) },
                guidance.setsDelta, guidance.legLevel, rest,
                skipped.has(e.id), () => unskip(e.id), redraw
              )))));

      /* DIE SPERRE DER WIEDERHOLUNGSFELDER HÄNGT AM SEKUNDENTAKT, nicht am
         Neuzeichnen. Sonst bliebe sie nach dem Ablauf der Pause bestehen, bis
         zufällig etwas anderes das Fenster neu baut — und man könnte nach der
         Pause nichts eintragen, obwohl sie vorbei ist. Ein einziger Ticker
         für alle Felder: er schaltet nur bei Wechseln, nicht jede Sekunde. */
      if (!rest) return view;
      return liveApply(view, () => restRunning(rest), (node, locked) => {
        node.classList.toggle('is-resting', locked);
        for (const input of node.querySelectorAll('.setrow__reps')) {
          input.disabled = locked;
        }
      });
    },

    /* Der grüne Bildschirm. Er liegt immer im Baum, solange es eine Pause
       gibt, und schaltet sich beim Ablauf selbst sichtbar. */
    overlay: () => {
      if (justEnded || confirming) return null;
      const rest = restFor(dayKey, session.id);
      if (!rest) return null;
      return restDone(rest, () => { writeRest(null); redraw(); });
    },
  });

  return handle;
}
