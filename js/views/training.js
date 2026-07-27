/* Training — Plan anzeigen und Sätze loggen.
 *
 * Zwei Dinge machen den Unterschied zwischen einem Logger, den man benutzt,
 * und einem, den man nach zwei Wochen liegen lässt:
 *
 *   1. "Letztes Mal" steht DIREKT an der Übung. Ohne das ist Progression
 *      Ratespiel — niemand erinnert sich an das Gewicht von vor einer Woche.
 *   2. Eintippen ohne Zwischenschritte. Zwei Felder pro Satz, sofort
 *      gespeichert, kein Absenden.
 *
 * Gesperrte Übungen werden nicht ausgeblendet, sondern durchgestrichen mit
 * Begründung. Verschwundene Übungen wirken wie ein Fehler; durchgestrichene
 * erklären sich selbst.
 */

import { todayKey, weekdayOf, formatDayShort, WEEKDAYS_LONG } from '../lib/dates.js';
import { getSets, lastPerformance, dayTypeFor } from '../lib/state.js';
import { legVolumeAllowance, exerciseBlockReason } from '../lib/planner.js';
import { readinessScore, trainingGuidance } from '../lib/readiness.js';
import { getDay } from '../lib/state.js';
import { DAY_TYPE_LABELS } from '../lib/energy.js';
import { totalSets } from '../lib/volume.js';
import { EXERCISES, exercise } from '../../data/exercises.js';
import { PLAN, sessionForWeekday, sessionExercises } from '../../data/plan-default.js';
import { el, card, decimalInput, parseDecimal, toInputValue, dec, kg } from './dom.js';

/* Die Regel selbst liegt in lib/planner.js und ist dort getestet. Hier wird
   nur der Katalog danebengelegt. */
function blockReason(entry, legLevel) {
  return exerciseBlockReason(
    { loadsLegs: EXERCISES[entry.id].loadsLegs, prophylaxis: entry.prophylaxis },
    legLevel
  );
}

/* ─── Satzzeilen ─────────────────────────────────────────────────────────── */

function setRow(store, dayKey, planId, exId, index, set, unit) {
  const done = Boolean(set && set.reps !== null && set.reps !== undefined);

  const write = (field) => (event) => {
    const value = parseDecimal(event.target.value);
    try {
      store.setSet(dayKey, planId, exId, index, { [field]: value });
    } catch (err) {
      event.target.value = '';
      console.warn('[training]', err.message);
    }
  };

  return el('div', { class: `setrow${done ? ' setrow--done' : ''}` },
    el('span', { class: 'setrow__index', text: String(index + 1) }),
    decimalInput({
      value: toInputValue(set?.reps ?? null),
      placeholder: unit === 'Sekunden' ? 'Sek.' : 'Wdh.',
      'aria-label': `Satz ${index + 1}, Wiederholungen`,
      onchange: write('reps'),
    }),
    decimalInput({
      value: toInputValue(set?.kg ?? null),
      placeholder: 'kg',
      'aria-label': `Satz ${index + 1}, Gewicht in Kilogramm`,
      onchange: write('kg'),
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

function exerciseCard(store, state, dayKey, planId, entry, setsDelta, legLevel) {
  const ex = exercise(entry.id);
  const blocked = blockReason(entry, legLevel);

  // Bei niedriger Bereitschaft ein Satz weniger, aber nie unter einen.
  const plannedSets = Math.max(1, entry.sets + (blocked ? 0 : setsDelta));
  const logged = getSets(state, dayKey, planId, entry.id);
  const rowCount = Math.max(plannedSets, logged.length);

  const target = `${plannedSets} × ${entry.repsMin}–${entry.repsMax}`
    + (entry.unit === 'Sekunden' ? ' Sek.' : '')
    + ` @ RPE ${entry.rpe}`;

  return el('div', { class: `exercise${blocked ? ' exercise--blocked' : ''}` },
    el('div', { class: 'card__head' },
      el('span', null,
        el('span', { class: 'exercise__name', text: ex.name }),
        ex.variant ? el('span', { class: 'exercise__variant', text: ` ${ex.variant}` }) : null),
      el('span', { class: 'exercise__target', text: target })),

    blocked
      ? el('p', { class: 'exercise__last', text: blocked })
      : el('p', { class: 'exercise__last', text: lastText(state, dayKey, entry.id) }),

    blocked ? null : el('div', null,
      el('div', { class: 'setrow__head' },
        el('span', { text: '' }),
        el('span', { text: entry.unit === 'Sekunden' ? 'Sekunden' : 'Wdh.' }),
        el('span', { text: 'kg' })),
      Array.from({ length: rowCount }, (_, i) =>
        setRow(store, dayKey, planId, entry.id, i, logged[i] ?? null, entry.unit))),

    entry.goal ? el('p', { class: 'exercise__note', text: entry.goal }) : null,
    ex.note && !blocked ? el('p', { class: 'exercise__note', text: ex.note }) : null);
}

/* ─── Kein Trainingstag ──────────────────────────────────────────────────── */

function noSessionToday(state, dayKey) {
  const dayType = dayTypeFor(state, dayKey);
  const weekday = weekdayOf(dayKey);

  const messages = {
    match: 'Spieltag. Heute gehört alles dem Spiel.',
    team: 'Mannschaftstraining. Das ist dein Training für heute.',
    rest: 'Kein Gym heute — Ruhetag.',
    gym: 'Für diesen Wochentag steht keine Einheit im Plan.',
  };

  const nextDays = [1, 2, 3, 4, 5, 6, 7]
    .map((offset) => (weekday + offset) % 7)
    .map((wd) => ({ wd, session: sessionForWeekday(wd) }))
    .filter((x) => x.session);
  const next = nextDays[0];

  return el('div', { class: 'view' },
    el('h1', { text: 'Training' }),
    card('Heute',
      el('span', { class: 'chip', text: DAY_TYPE_LABELS[dayType] }),
      el('p', { text: messages[dayType] }),
      next
        ? el('p', { class: 'card__note' },
          `Nächste Einheit: ${WEEKDAYS_LONG[next.wd]} — ${next.session.name} `
          + `(${next.session.focus}).`)
        : null),
    planOverview());
}

/* ─── Planübersicht ──────────────────────────────────────────────────────── */

function planOverview() {
  return card('Dein Plan',
    el('span', { class: 'chip', text: `${PLAN.blockWeeks} Wochen` }),
    el('ul', null,
      PLAN.sessions.map((s) =>
        el('li', null,
          el('strong', { text: `${WEEKDAYS_LONG[s.weekday]}: ${s.name}` }),
          ` — ${s.focus}, ${sessionExercises(s).length} Übungen`))),
    el('p', { class: 'card__note' }, PLAN.progression.description,
      ` Woche ${PLAN.progression.deloadWeek} ist Deload: ein Satz weniger, RPE höchstens `,
      `${PLAN.progression.deloadRpeCap}.`));
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

export function render({ store }) {
  const state = store.getState();
  const dayKey = todayKey();
  const session = sessionForWeekday(weekdayOf(dayKey));

  if (!session) return noSessionToday(state, dayKey);

  const allowance = legVolumeAllowance(dayKey, {
    matchDayWeekday: state.profile.matchDayWeekday,
    teamTrainingWeekdays: state.profile.teamTrainingWeekdays ?? [],
  });
  const readiness = readinessScore(getDay(state, dayKey).checkin);
  const guidance = trainingGuidance(readiness, allowance);

  const entries = sessionExercises(session);
  const plannedTotal = entries.reduce((sum, e) => {
    const blocked = blockReason(e, guidance.legLevel);
    return sum + (blocked ? 0 : Math.max(1, e.sets + guidance.setsDelta));
  }, 0);
  const doneTotal = totalSets(getDay(state, dayKey).sessions);

  return el('div', { class: 'view' },
    el('h1', { text: session.name }),
    el('p', { class: 'session__intro', text: session.intro }),

    el('div', { class: 'session__progress' },
      el('b', { text: `${doneTotal}/${plannedTotal}` }),
      el('span', { class: 'stat__label', text: 'Sätze erledigt' })),

    readiness.score === null
      ? el('div', { class: 'notice notice--warn' },
        el('span', { class: 'notice__title', text: 'Check-in fehlt' }),
        'Ohne Check-in trainierst du nach Plan. Trag ihn im Reiter Heute ein, '
        + 'dann passt die App das Volumen an.')
      : guidance.setsDelta !== 0
        ? el('div', { class: 'notice notice--warn' },
          el('span', { class: 'notice__title', text: guidance.headline }),
          `${guidance.detail} Deshalb heute `
          + `${Math.abs(guidance.setsDelta)} Satz${Math.abs(guidance.setsDelta) === 1 ? '' : 'e'} `
          + `weniger pro Übung, RPE höchstens ${guidance.rpeCap}.`)
        : null,

    session.blocks.map((block) =>
      el('div', { class: 'block' },
        el('div', { class: 'block__title' },
          el('span', { class: 'block__name', text: block.name }),
          block.prophylaxis
            ? el('span', { class: 'chip', text: 'schützt die Saison' })
            : null),
        block.intro ? el('p', { class: 'block__intro', text: block.intro }) : null,
        block.exercises.map((e) =>
          exerciseCard(
            store, state, dayKey, session.id,
            { ...e, prophylaxis: Boolean(block.prophylaxis) },
            guidance.setsDelta, guidance.legLevel
          )))));
}
