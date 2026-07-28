/* Das Trainingsfenster — mitlaufende Uhr, Sätze, Pausen.
 *
 * Drei Dinge machen den Unterschied zwischen einem Logger, den man benutzt,
 * und einem, den man nach zwei Wochen liegen lässt:
 *
 *   1. "Letztes Mal" steht DIREKT an der Übung. Ohne das ist Progression
 *      Ratespiel — niemand erinnert sich an das Gewicht von vor einer Woche.
 *   2. Eintippen ohne Zwischenschritte. Zwei Felder pro Satz, sofort
 *      gespeichert, kein Absenden.
 *   3. Die Pause läuft von allein. Wer nach jedem Satz selbst auf die Uhr
 *      tippen muss, tut es beim vierten nicht mehr — und trainiert dann mit
 *      70 Sekunden Pause statt drei Minuten.
 *
 * DIE PAUSE STEHT NICHT IM ZUSTAND. Sie liegt in einem eigenen
 * localStorage-Eintrag, nicht in `lebenstracker.v1`: eine Pause ist kein
 * Messwert, sie hat in der Exportdatei nichts zu suchen. Gespeichert wird sie
 * trotzdem — wer während des Trainings die App wegwischt, soll den Countdown
 * beim Zurückkommen weiterlaufen sehen.
 *
 * DIE TRAININGSDAUER STEHT SEHR WOHL IM ZUSTAND, als `startedAt`/`endedAt` an
 * der Einheit. Sie ist ein Messwert: 45 Minuten für dieselbe Einheit, die
 * vorher 70 gebraucht hat, ist eine Information über die Woche.
 */

import { formatDayShort, formatDayLong, todayKey } from '../lib/dates.js';
import {
  getDay, getSets, getSession, lastPerformance, sessionMinutes,
} from '../lib/state.js';
import { legVolumeAllowance, exerciseBlockReason } from '../lib/planner.js';
import { readinessScore, trainingGuidance } from '../lib/readiness.js';
import { totalSets } from '../lib/volume.js';
import { EXERCISES, exercise } from '../../data/exercises.js';
import { sessionExercises } from '../../data/plan-default.js';
import {
  el, decimalInput, parseDecimal, toInputValue, dec, kg, setCount,
} from './dom.js';
import { openSheet } from './sheet.js';
import { liveText, liveWidth, formatSeconds, formatDuration } from './clock.js';

/** Satzpause in Sekunden. Flockes Vorgabe: drei Minuten. */
export const REST_SECONDS = 180;

/** Ein Griff mehr Pause, wenn der Satz härter war als gedacht. */
const REST_BUMP = 30;

const REST_STORAGE_KEY = 'lebenstracker.rest';

/* ─── Pausenuhr ──────────────────────────────────────────────────────────── */

function readRest() {
  try {
    const raw = globalThis.localStorage?.getItem(REST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.until !== 'number') return null;
    // Abgelaufene Pausen sind keine Pausen mehr.
    if (parsed.until <= Date.now()) return null;
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

function startRest(label, seconds = REST_SECONDS) {
  writeRest({ until: Date.now() + seconds * 1000, seconds, label });
}

function bumpRest(seconds) {
  const rest = readRest();
  if (!rest) return;
  writeRest({ ...rest, until: rest.until + seconds * 1000, seconds: rest.seconds + seconds });
}

const restSecondsLeft = (rest) => Math.max(0, (rest.until - Date.now()) / 1000);

/**
 * Der Pausenbalken.
 *
 * Zahl UND Balken: die Zahl sagt, wie lange noch, der Balken sagt es ohne
 * Lesen. Beides läuft über den Sekundentakt aus clock.js und rührt den Rest
 * des Fensters nicht an — sonst wäre die Tastatur bei jedem Tick weg.
 */
function restBar(rest, redraw) {
  return el('div', { class: 'rest', role: 'status' },
    el('div', { class: 'rest__head' },
      el('span', { class: 'rest__label', text: `Pause — ${rest.label}` }),
      liveText(() => formatSeconds(restSecondsLeft(rest)), { class: 'rest__time' })),
    el('div', { class: 'rest__track' },
      liveWidth(() => restSecondsLeft(rest) / rest.seconds, { class: 'rest__fill' })),
    el('div', { class: 'rest__tools' },
      el('button', {
        type: 'button', class: 'btn btn--small',
        text: `+${REST_BUMP} s`,
        onclick: () => { bumpRest(REST_BUMP); redraw(); },
      }),
      el('button', {
        type: 'button', class: 'btn btn--small btn--ghost',
        text: 'Weiter',
        onclick: () => { writeRest(null); redraw(); },
      })));
}

/* ─── Satzzeilen ─────────────────────────────────────────────────────────── */

function setRow(store, dayKey, planId, exId, index, set, entry, redraw) {
  const done = Boolean(set && set.reps !== null && set.reps !== undefined);
  const exName = exercise(exId).name;

  const write = (field) => (event) => {
    const value = parseDecimal(event.target.value);
    const wasDone = Boolean(set?.reps ?? null);
    try {
      store.setSet(dayKey, planId, exId, index, { [field]: value });
      /* Die Pause startet, wenn die WIEDERHOLUNGEN eintragen werden — das ist
         der Moment, in dem der Satz vorbei ist. Nicht beim Gewicht: das trägt
         man oft vorher ein. Und nicht erneut, wenn man eine Zahl nur
         korrigiert. */
      if (field === 'reps' && value !== null && !wasDone) {
        startRest(`${exName}, Satz ${index + 1}`);
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
 */
function exerciseCard(store, state, dayKey, planId, entry, setsDelta, legLevel, redraw) {
  const ex = exercise(entry.id);
  const blocked = exerciseBlockReason(
    { loadsLegs: EXERCISES[entry.id].loadsLegs, prophylaxis: entry.prophylaxis },
    legLevel
  );

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

  return el('div', {
    class: `exercise${blocked ? ' exercise--blocked' : ''}${complete ? ' exercise--complete' : ''}`,
  },
    el('div', { class: 'card__head' },
      el('span', null,
        el('span', { class: 'exercise__name', text: ex.name }),
        ex.variant ? el('span', { class: 'exercise__variant', text: ` ${ex.variant}` }) : null),
      el('span', { class: 'exercise__target', text: target })),

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

    entry.goal ? el('p', { class: 'exercise__note', text: entry.goal }) : null,
    ex.note && !blocked ? el('p', { class: 'exercise__note', text: ex.note }) : null);
}

/* ─── Fenster ────────────────────────────────────────────────────────────── */

/**
 * Trainingsfenster öffnen.
 *
 * Startet die Uhr, falls sie noch nicht läuft. Das ist der Grund, warum
 * "Training starten" nur diese eine Funktion aufruft: Uhr und Fenster gehören
 * zusammen, und zwei Wege dorthin wären zwei Wege, die auseinanderlaufen.
 */
export function openSession(store, dayKey, session) {
  const existing = getSession(store.getState(), dayKey, session.id);
  if (!existing?.startedAt) {
    store.setSessionMeta(dayKey, session.id, { startedAt: new Date().toISOString() });
  }

  let handle = null;
  const redraw = () => handle?.redraw();

  handle = openSheet({
    store,
    eyebrow: dayKey === todayKey() ? 'Training läuft' : formatDayLong(dayKey),
    title: session.name,
    doneLabel: 'Training beenden',
    onClose: () => {
      /* Beim Schließen wird die Uhr angehalten und die Pause gelöscht. Beides
         gehört zum Training, nicht zum Tag. */
      const logged = getSession(store.getState(), dayKey, session.id);
      if (logged?.startedAt && !logged.endedAt) {
        store.setSessionMeta(dayKey, session.id, { endedAt: new Date().toISOString() });
      }
      writeRest(null);
    },
    body: () => {
      const state = store.getState();
      const profile = state.profile;
      const allowance = legVolumeAllowance(dayKey, {
        matchDayWeekday: profile.matchDayWeekday,
        teamTrainingWeekdays: profile.teamTrainingWeekdays ?? [],
      });
      const readiness = readinessScore(getDay(state, dayKey).checkin);
      const guidance = trainingGuidance(readiness, allowance);

      /* Gezählt wird gegen den PLAN, nicht gegen die Empfehlung. „7/13" muss
         dieselbe Zahl im Nenner haben wie die Trainingsseite und der Plan —
         sonst bedeutet derselbe Bruch an zwei Stellen etwas anderes. */
      const entries = sessionExercises(session);
      const plannedTotal = entries.reduce((sum, e) => {
        const blocked = exerciseBlockReason(
          { loadsLegs: EXERCISES[e.id].loadsLegs, prophylaxis: e.prophylaxis },
          guidance.legLevel
        );
        return sum + (blocked ? 0 : e.sets);
      }, 0);
      const doneTotal = totalSets(getDay(state, dayKey).sessions
        .filter((s) => s.planId === session.id));

      const logged = getSession(state, dayKey, session.id);
      const rest = readRest();

      return el('div', null,
        /* Uhr und Satzzähler oben, weil das die zwei Zahlen sind, auf die man
           zwischen den Sätzen schaut. */
        el('div', { class: 'session-bar' },
          el('div', { class: 'session-bar__cell' },
            liveText(
              () => formatDuration((sessionMinutes(logged, Date.now()) ?? 0) * 60),
              { class: 'session-bar__value' }
            ),
            el('span', { class: 'session-bar__label', text: 'Dauer' })),
          el('div', { class: 'session-bar__cell' },
            el('span', { class: 'session-bar__value', text: `${doneTotal}/${plannedTotal}` }),
            el('span', { class: 'session-bar__label', text: 'Sätze' }))),

        rest ? restBar(rest, redraw) : el('p', {
          class: 'rest rest--idle',
          text: `Nach jedem Satz laufen ${REST_SECONDS / 60} Minuten Pause. Die Uhr `
              + 'startet von allein, sobald du die Wiederholungen einträgst.',
        }),

        guidance.setsDelta !== 0
          ? el('div', { class: 'notice notice--warn' },
            el('span', { class: 'notice__title', text: guidance.headline }),
            `${guidance.detail} Vorschlag für heute: `
            + `${setCount(Math.abs(guidance.setsDelta))} weniger pro Übung, `
            + `RPE höchstens ${guidance.rpeCap}. `
            + 'Der Plan bleibt stehen — du entscheidest.')
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
                guidance.setsDelta, guidance.legLevel, redraw
              )))));
    },
  });

  return handle;
}

/** Läuft gerade eine Einheit an diesem Tag? */
export function runningSession(state, dayKey) {
  return getDay(state, dayKey).sessions.find((s) => s.startedAt && !s.endedAt) ?? null;
}
