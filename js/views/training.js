/* Training — die drei Einheiten auf einem Screen.
 *
 * Flockes Vorgabe: hier stehen ALLE DREI Einheiten, nicht nur die von heute.
 * Der Grund ist praktisch — man will wissen, was in der Woche noch kommt, und
 * man will eine Einheit auch dann öffnen können, wenn sie eigentlich morgen
 * dran wäre.
 *
 * Was hier NICHT passiert: loggen. Die Sätze trägt man im Trainingsfenster
 * ein (js/views/session.js), das der Startknopf öffnet. Zwei Orte für dieselbe
 * Eingabe wären zwei Orte, die auseinanderlaufen.
 */

import { todayKey, WEEKDAYS_LONG, formatDayShort, weekdayOf } from '../lib/dates.js';
import { getDay, getSession, sessionMinutes } from '../lib/state.js';
import { weekPlan, sessionForDay } from '../lib/schedule.js';
import { legVolumeAllowance, exerciseBlockReason } from '../lib/planner.js';
import { readinessScore, trainingGuidance } from '../lib/readiness.js';
import { totalSets, plannedSetsPerMuscle, setsPerMuscle } from '../lib/volume.js';
import { EXERCISES, MUSCLE_GROUPS, exercise } from '../../data/exercises.js';
import { PLAN, SESSIONS, sessionExercises, plannedSets } from '../../data/plan-default.js';
import { openSession } from './session.js';
import { el, card, dec, setCount } from './dom.js';

/** Farbe je Einheit — dieselbe Reihenfolge wie im Plan, überall gleich. */
const SESSION_TONE = { 'a-push': 'push', 'b-pull': 'pull', 'c-legs': 'legs' };

/* ─── Zustand einer Einheit in dieser Woche ──────────────────────────────── */

function statusOf(state, entry) {
  const { session, dayKey } = entry;
  if (!dayKey) return { key: 'none', word: 'kein Tag', tone: 'idle' };

  const logged = getSession(state, dayKey, session.id);
  const done = totalSets(logged ? [logged] : []);
  const today = todayKey();

  if (logged?.startedAt && !logged.endedAt) return { key: 'running', word: 'läuft', tone: 'ok' };
  if (done > 0) {
    return { key: 'done', word: `${setCount(done)} geloggt`, tone: 'good' };
  }
  if (dayKey === today) return { key: 'today', word: 'heute dran', tone: 'ok' };
  if (dayKey < today) return { key: 'missed', word: 'ausgelassen', tone: 'bad' };
  return { key: 'ahead', word: WEEKDAYS_LONG[weekdayOf(dayKey)], tone: 'idle' };
}

/* ─── Karte je Einheit ───────────────────────────────────────────────────── */

function sessionCard(store, state, entry) {
  const { session, dayKey, isMoved } = entry;
  const status = statusOf(state, entry);
  const today = todayKey();
  const openKey = dayKey ?? today;

  const logged = getSession(state, openKey, session.id);
  const minutes = sessionMinutes(logged ?? {}, Date.now());

  /* Die Sperre wird für den TAG DER EINHEIT gerechnet, nicht für heute. Sonst
     stünde am Sonntag an jeder Beinübung "gesperrt", obwohl die Einheit am
     Donnerstag liegt. Die Bereitschaft geht hier NICHT ein: in der Übersicht
     steht der Plan, nicht die Tagesform. */
  const allowance = legVolumeAllowance(openKey, {
    matchDayWeekday: state.profile.matchDayWeekday,
    teamTrainingWeekdays: state.profile.teamTrainingWeekdays ?? [],
  });
  const guidance = trainingGuidance(
    readinessScore(getDay(state, openKey).checkin), allowance
  );

  const rows = sessionExercises(session).map((e) => {
    const ex = exercise(e.id);
    const blocked = exerciseBlockReason(
      { loadsLegs: EXERCISES[e.id].loadsLegs, prophylaxis: e.prophylaxis },
      guidance.legLevel
    );
    return el('li', { class: `exlist__row${blocked ? ' exlist__row--blocked' : ''}` },
      el('span', { class: 'exlist__name' },
        ex.name,
        ex.variant ? el('span', { class: 'exlist__variant', text: ` ${ex.variant}` }) : null),
      el('span', { class: 'exlist__target', text: `${e.sets}×${e.repsMin}–${e.repsMax}` }));
  });

  return el('div', { class: `card card--session card--${SESSION_TONE[session.id] ?? 'idle'}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: dayKey ? WEEKDAYS_LONG[weekdayOf(dayKey)] : 'ohne Tag' }),
      el('span', { class: `chip chip--${status.tone}`, text: status.word })),

    el('div', { class: 'session-card__title' },
      el('span', { class: 'session-card__name', text: session.name }),
      el('span', { class: 'session-card__sets', text: `${plannedSets(session)} Sätze` })),
    el('p', { class: 'session-card__focus', text: session.focus }),

    isMoved
      ? el('p', { class: 'card__note', text: `Diese Woche verschoben auf ${formatDayShort(dayKey)}.` })
      : null,

    el('ul', { class: 'exlist' }, rows),

    minutes !== null && status.key === 'done'
      ? el('p', { class: 'card__note', text: `Gedauert hat es ${Math.round(minutes)} Minuten.` })
      : null,

    el('button', {
      type: 'button',
      class: `btn btn--block${status.key === 'today' || status.key === 'running' ? ' btn--primary' : ''}`,
      text: status.key === 'running' ? 'weiterführen'
        : status.key === 'done' ? 'ansehen'
          : status.key === 'today' ? 'Training starten'
            : 'öffnen und loggen',
      onclick: () => openSession(store, openKey, session),
    }));
}

/* ─── Wochenvolumen ──────────────────────────────────────────────────────── */

/**
 * Geplant gegen geloggt, je Muskelgruppe.
 *
 * Zwei Balken übereinander statt einer Zahl: „11 von 14" muss man rechnen,
 * zwei unterschiedlich lange Balken nicht.
 */
function volumeCard(state, anyDayKey) {
  const planned = plannedSetsPerMuscle(SESSIONS);
  const keys = weekPlan(state, anyDayKey).map((e) => e.dayKey).filter(Boolean);
  const sessions = keys.flatMap((key) => getDay(state, key).sessions ?? []);
  const actual = setsPerMuscle(sessions);

  const rows = Object.entries(planned)
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;

  return card('Wochenvolumen',
    el('span', { class: 'chip', text: 'geplant gegen geloggt' }),
    rows.map(([key, plan]) => {
      const done = actual[key] ?? 0;
      const ratio = plan > 0 ? done / plan : 0;
      const tone = ratio >= 0.9 ? 'good' : ratio >= 0.5 ? 'ok' : 'bad';
      return el('div', { class: 'vol' },
        el('div', { class: 'vol__head' },
          el('span', { class: 'vol__name', text: MUSCLE_GROUPS[key] }),
          el('span', { class: 'vol__value' },
            el('b', { class: `vol__done vol__done--${tone}`, text: dec(done, 1) }),
            ` von ${dec(plan, 1)}`)),
        el('div', { class: 'vol__track' },
          el('div', { class: 'vol__plan', style: `width: ${((plan / max) * 100).toFixed(1)}%` },
            el('div', {
              class: `vol__fill vol__fill--${tone}`,
              style: `width: ${(Math.min(ratio, 1) * 100).toFixed(1)}%`,
            }))));
    }),
    el('p', { class: 'card__note' },
      'Eine Hauptmuskelgruppe zählt einen Satz, eine Nebengruppe einen halben. ',
      'Gezählt wird nur, was tatsächlich geloggt ist.'));
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();
  const plan = weekPlan(state, today);
  const todaysSession = sessionForDay(state, today);

  return el('div', { class: 'view' },
    el('h1', { text: 'Training' }),
    el('p', { class: 'field__hint' },
      todaysSession
        ? `Heute: ${todaysSession.name}. Antippen und loggen.`
        : 'Heute steht keine Krafteinheit an.'),
    el('div', { style: 'height: var(--space-4)' }),

    plan.map((entry) => sessionCard(store, state, entry)),

    volumeCard(state, today),

    card('Progression',
      el('span', { class: 'chip', text: `${PLAN.blockWeeks} Wochen` }),
      el('p', { text: PLAN.progression.description }),
      el('p', { class: 'card__note' },
        `Woche ${PLAN.progression.deloadWeek} ist Deload: ein Satz weniger, RPE `,
        `höchstens ${PLAN.progression.deloadRpeCap}. RPE 8 heißt: zwei `,
        'Wiederholungen wären noch gegangen.')));
}
