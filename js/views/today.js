/* Heute — der Screen, der täglich benutzt wird.
 *
 * Aufbau folgt der Reihenfolge, in der die Fragen morgens auftauchen:
 *
 *   1. Wochenband       — wo stehe ich, und ANTIPPBAR: Tage durchblättern
 *   2. Monats-Review    — nur am Monatsende, dann aber ganz oben
 *   3. Check-in         — eine Karte, die ein Fenster öffnet
 *   4. Training heute   — was ansteht, mit "Starten" und "Verschieben"
 *   5. Gewicht          — Erinnerung, Eingabe, Wochenstreifen
 *
 * WAS HIER BEWUSST NICHT STEHT:
 *
 *   Die Bereitschaft als Zahl von 0 bis 100. Statt der Zahl steht die
 *   Statusgrafik in der Check-in-Karte.
 *
 *   Die Beinfreigabe als eigene Karte. Die Regel gilt weiter und ist dort
 *   wirksam, wo sie etwas bewirkt: im Trainingsfenster, an der einzelnen Übung.
 *   Auf dem Startscreen war sie eine Erklärung ohne Handlung.
 *
 *   Kalorien und Makros. Die stehen im Reiter Essen, wo sie hingehören — hier
 *   waren sie eine Zahl, die man morgens nicht braucht.
 *
 * Der Screen kann jeden Tag der laufenden Woche zeigen, nicht nur heute — die
 * Route trägt den Tag als `#/heute?day=YYYY-MM-DD`. Das ist die einzige Stelle,
 * an der ein Tag nachgetragen werden kann, und sie ist genau einen Fingertipp
 * vom Wochenband entfernt.
 */

import {
  todayKey, weekKeys, weekdayShort, parseKey, formatDayLong, weekdayOf,
  addDays, weekStartKey, formatDayShort, formatMonth, WEEKDAYS_LONG,
} from '../lib/dates.js';
import { dayTypeFor, weightOn, getDay, getSession, sessionMinutes } from '../lib/state.js';
import { DAY_TYPE_LABELS } from '../lib/energy.js';
import { readinessScore, CHECKIN_FIELDS } from '../lib/readiness.js';
import { sessionForDay, weekPlan, moveTargets, recommendMove, sessionDoneInWeek }
  from '../lib/schedule.js';
import { exportReminder } from '../lib/archive.js';
import { monthReviewDue } from '../lib/review.js';
import { weekEntryDue } from '../lib/weekly.js';
import { totalSets } from '../lib/volume.js';
import { movingAverage, series, WEIGHT_WINDOW } from '../lib/aggregate.js';
import { checkinSummary, openCheckin } from './checkin.js';
import { openSession } from './session.js';
import { openSheet, closeSheet } from './sheet.js';
import { readinessArc, factorBars } from './gauge.js';
import { Spring } from './motion.js';
import {
  el, replace, dec, setWord, decimalInput, parseDecimal, toInputValue,
} from './dom.js';

/* ─── Wochenband ─────────────────────────────────────────────────────────── */

/**
 * Die Woche als Reihe von Knöpfen.
 *
 * Jeder Tag ist antippbar und wechselt den gezeigten Tag — Flockes Vorgabe.
 * Die Marke unter der Zahl sagt, was an dem Tag läuft: Spiel, Mannschaft,
 * Krafteinheit, erledigt. Farbe UND Form, damit die Marke nicht allein an der
 * Farbe hängt.
 */
/* Die gleitende Kapsel hinter dem gezeigten Tag.
 *
 * Sie liegt im Modul und nicht in der Funktion: die App zeichnet bei jeder
 * Eingabe alles neu, und eine Feder, die dabei jedes Mal neu entstünde, wäre
 * bei jedem Tastendruck wieder am Anfang. Genau dieselbe Bauart wie die
 * Kapsel der Tab-Bar in js/app.js.
 */
let bandCapsule = null;
let bandPainted = null;
const bandX = new Spring(0, { damping: 0.9, response: 0.34, onChange: paintBandCapsule });
const bandW = new Spring(0, { damping: 0.9, response: 0.34, onChange: paintBandCapsule });

function paintBandCapsule() {
  if (!bandCapsule?.isConnected) return;
  bandCapsule.style.transform = `translate3d(${bandX.x.toFixed(2)}px, 0, 0)`;
  bandCapsule.style.width = `${bandW.x.toFixed(2)}px`;
}

/**
 * Die Kapsel neu einmessen, ohne neu zu zeichnen.
 *
 * Nötig beim Drehen des Geräts: die Kapsel kennt ihren Platz nur in Pixeln,
 * und die stimmen nach einer Breitenänderung nicht mehr. Ein vollständiges
 * Neuzeichnen wäre der einfachere Weg und der falsche — auf iOS löst auch
 * die eingeblendete Tastatur ein resize aus, und dabei darf das Feld, in das
 * gerade getippt wird, nicht verschwinden.
 */
export function relayoutWeekband() {
  const band = document.querySelector('.weekband');
  const day = band?.querySelector('.weekband__day--shown');
  if (!band || !day || !bandCapsule?.isConnected) return;
  bandX.set(day.offsetLeft);
  bandW.set(day.offsetWidth);
}

function placeBandCapsule(band, shownKey) {
  const day = band.querySelector('.weekband__day--shown');
  if (!day || !bandCapsule) return;
  /* Ohne Bewegung, wenn nur neu gezeichnet wurde — sonst liefe bei jedem
     Tastendruck im Gewichtsfeld eine Animation los. */
  const instant = bandPainted === shownKey || bandW.x === 0;
  bandPainted = shownKey;
  if (instant) {
    bandX.set(day.offsetLeft);
    bandW.set(day.offsetWidth);
  } else {
    bandX.to(day.offsetLeft);
    bandW.to(day.offsetWidth);
  }
}

function weekband(state, shownKey, navigateDay) {
  const today = todayKey();
  const plan = weekPlan(state, shownKey);
  const byDay = new Map(plan.filter((p) => p.dayKey).map((p) => [p.dayKey, p]));

  bandCapsule = el('div', { class: 'weekband__capsule', 'aria-hidden': 'true' });
  const band = el('div', { class: 'weekband' },
    bandCapsule,
    weekKeys(shownKey).map((key) => {
        const weekday = weekdayOf(key);
        const day = getDay(state, key);
        const isShown = key === shownKey;
        const isToday = key === today;
        const entry = byDay.get(key);
        const hasSets = totalSets(day.sessions) > 0;

        let markClass = null;
        let markText = '';
        if (weekday === state.profile.matchDayWeekday) { markClass = 'match'; markText = 'Spiel'; }
        else if ((state.profile.teamTrainingWeekdays ?? []).includes(weekday)) {
          markClass = 'team'; markText = 'Mannschaft';
        } else if (entry) {
          markClass = hasSets ? 'done' : 'gym';
          markText = hasSets ? `${entry.session.name} erledigt` : entry.session.name;
        }

        return el('button', {
          type: 'button',
          class: 'weekband__day'
            + (isShown ? ' weekband__day--shown' : '')
            + (isToday ? ' weekband__day--today' : ''),
          'aria-current': isShown ? 'date' : null,
          'aria-label': `${WEEKDAYS_LONG[weekday]} ${formatDayShort(key)}`
            + (markText ? `, ${markText}` : '')
            + (isToday ? ', heute' : ''),
          onclick: () => navigateDay(key),
        },
          el('span', { class: 'weekband__label', text: weekdayShort(key) }),
          el('span', { class: 'weekband__num', text: String(parseKey(key).getDate()) }),
          el('span', {
            class: `weekband__mark${markClass ? ` weekband__mark--${markClass}` : ''}`,
          }));
      }));

  /* Nach dem Einhängen, nicht davor: offsetLeft kennt der Browser erst,
     wenn das Element im Dokument steht. */
  requestAnimationFrame(() => placeBandCapsule(band, shownKey));

  return el('div', null,
    band,
    el('div', { class: 'weekband__legend' },
      el('span', { class: 'legend legend--match', text: 'Spiel' }),
      el('span', { class: 'legend legend--team', text: 'Mannschaft' }),
      el('span', { class: 'legend legend--gym', text: 'Gym geplant' }),
      el('span', { class: 'legend legend--done', text: 'erledigt' })));
}

/* ─── Kopf: welcher Tag ist gezeigt ──────────────────────────────────────── */

function dayHeader(shownKey, navigateDay) {
  const today = todayKey();
  const isToday = shownKey === today;
  const start = weekStartKey(today);

  return el('div', { class: 'dayhead' },
    el('button', {
      type: 'button', class: 'dayhead__step', 'aria-label': 'Tag zurück',
      text: '‹',
      // Nur innerhalb der laufenden Woche. Weiter zurück ist Archivarbeit und
      // würde hier stillschweigend auf heute zurückfallen.
      disabled: shownKey <= start,
      onclick: () => navigateDay(addDays(shownKey, -1)),
    }),
    el('div', { class: 'dayhead__center' },
      el('h1', { text: formatDayLong(shownKey) }),
      isToday
        ? el('span', { class: 'chip chip--good', text: 'heute' })
        : el('button', {
          type: 'button', class: 'btn btn--small btn--ghost',
          text: 'zurück zu heute', onclick: () => navigateDay(today),
        })),
    el('button', {
      type: 'button', class: 'dayhead__step', 'aria-label': 'Tag vor',
      text: '›',
      // Nicht in die Zukunft blättern: dort gibt es nichts einzutragen, und
      // ein Check-in für Donnerstag wäre geraten, nicht gemessen.
      disabled: shownKey >= addDays(start, 6),
      onclick: () => navigateDay(addDays(shownKey, 1)),
    }));
}

/* ─── Check-in-Karte ─────────────────────────────────────────────────────── */

/**
 * Die Karte, die das Check-in-Fenster öffnet.
 *
 * Sie zeigt die Statusgrafik, nicht die Fragen. Wer schon ausgefüllt hat, sieht
 * das Ergebnis; wer nicht, sieht einen leeren Bogen und einen Knopf. Beides in
 * derselben Karte, damit der Ort gleich bleibt.
 */
function checkinCard(store, shownKey) {
  const readiness = readinessScore(getDay(store.getState(), shownKey).checkin);
  const d = readiness.display;
  const open = () => openCheckin(store, shownKey);

  return el('div', { class: `card card--tone card--${d.tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Check-in' }),
      readiness.isComplete
        ? el('span', { class: 'chip chip--good', text: 'erledigt' })
        : el('span', { class: 'chip', text: `${readiness.missing.length} von ${CHECKIN_FIELDS.length} offen` })),

    el('div', { class: 'checkin-card' },
      readinessArc(readiness),
      el('div', { class: 'checkin-card__side' },
        factorBars(readiness),
        el('button', {
          type: 'button',
          class: `btn btn--block${readiness.isComplete ? '' : ' btn--primary'}`,
          text: readiness.isComplete ? 'Check-in ändern' : 'Check-in öffnen',
          onclick: open,
        }))),

    readiness.score === null
      ? el('p', { class: 'card__note', text: 'Vier Fragen, dreißig Sekunden. Danach weiß die App, wie viel heute geht.' })
      : el('p', { class: 'card__note', text: checkinSummary(store, shownKey) }));
}

/* ─── Training heute ─────────────────────────────────────────────────────── */

/** Das Fenster zum Verschieben — mit Empfehlung und Begründung je Tag. */
function openMoveSheet(store, shownKey, session) {
  const state = store.getState();
  const recommendation = recommendMove(state, session.id, shownKey);
  const targets = moveTargets(state, session.id, shownKey);

  const move = (targetKey) => {
    /* Zwei Schreibvorgänge: das Ziel bekommt die Einheit, der alte Tag bekommt
       ausdrücklich "nichts". Ohne das Zweite stünde die Einheit hinterher an
       beiden Tagen. */
    store.moveSession(targetKey, session.id);
    store.moveSession(shownKey, 'none');
    closeSheet();
  };

  openSheet({
    store,
    eyebrow: 'Verschieben',
    title: `${session.name} — wann stattdessen?`,
    doneLabel: 'Abbrechen',
    body: () => el('div', null,
      recommendation
        ? el('div', { class: `card card--tone card--${recommendation.isClean ? 'good' : 'ok'}` },
          el('div', { class: 'card__head' },
            el('span', { class: 'eyebrow', text: 'Empfehlung' }),
            el('span', {
              class: `chip chip--${recommendation.isClean ? 'good' : 'ok'}`,
              text: recommendation.label,
            })),
          el('p', { class: 'reco__headline', text: recommendation.headline }),
          el('p', { class: 'card__note', text: recommendation.detail }),
          el('div', { style: 'height: var(--space-3)' }),
          el('button', {
            type: 'button', class: 'btn btn--primary btn--block',
            text: `Auf ${WEEKDAYS_LONG[recommendation.weekday]} legen`,
            onclick: () => move(recommendation.dayKey),
          }))
        : el('div', { class: 'notice notice--warn' },
          el('span', { class: 'notice__title', text: 'Kein guter Tag in dieser Woche' }),
          'Bei diesem Spielrhythmus bleibt kein Tag übrig, der die Einheit '
          + 'tragen kann, ohne etwas anderes kaputt zu machen. Ehrlichste '
          + 'Antwort: diese Woche ausfallen lassen.'),

      el('h3', { text: 'Alle Tage der Woche' }),
      el('div', { class: 'movelist' },
        targets.map((t) => el('div', {
          class: `movelist__row${t.possible ? '' : ' movelist__row--blocked'}`,
        },
          el('div', null,
            el('span', { class: 'movelist__day', text: t.label }),
            el('p', { class: 'movelist__why', text: t.reason })),
          t.possible
            ? el('button', {
              type: 'button', class: 'btn btn--small',
              text: 'hierhin', onclick: () => move(t.dayKey),
            })
            : el('span', { class: 'chip chip--bad', text: 'gesperrt' })))),

      el('p', { class: 'field__hint' },
        'Die Verschiebung gilt nur für diese Woche. Der Plan bleibt, wie er ist.')),
  });
}

/**
 * Was heute ansteht — und der Knopf, der das Training startet.
 *
 * Die Karte beantwortet genau eine Frage und beantwortet sie in der
 * Überschrift. Alles Weitere (Übungsliste, Sätze) steckt im Fenster, das der
 * Knopf öffnet.
 */
function trainingCard(store, state, shownKey) {
  const session = sessionForDay(state, shownKey);
  const dayType = dayTypeFor(state, shownKey);
  const isToday = shownKey === todayKey();

  /* Kein Gym-Tag: dann steht hier, was stattdessen los ist, plus der nächste
     Termin. Eine leere Karte wäre schlechter als keine. */
  if (!session) {
    const plan = weekPlan(state, shownKey);
    const upcoming = plan
      .filter((entry) => entry.dayKey && entry.dayKey > shownKey)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey))[0];

    /* Der Tag kann leer sein, WEIL von hier etwas weggeschoben wurde. Dann ist
       „steht keine Einheit im Plan" die falsche Auskunft — und ohne den
       Rückweg wäre die Verschiebung nicht mehr rückholbar. */
    const movedAway = plan.find((entry) => entry.isMoved && entry.plannedDayKey === shownKey);
    if (movedAway) {
      return el('div', { class: 'card card--tone card--ok' },
        el('div', { class: 'card__head' },
          el('span', { class: 'eyebrow', text: 'Verschoben' }),
          el('span', { class: 'chip chip--ok', text: formatDayShort(movedAway.dayKey) })),
        el('p', { class: 'today__headline', text: `${movedAway.session.name} liegt diese Woche am ${WEEKDAYS_LONG[weekdayOf(movedAway.dayKey)]}` }),
        el('p', { class: 'today__focus', text: 'Hier ist deshalb nichts eingeplant.' }),
        el('div', { style: 'height: var(--space-3)' }),
        el('button', {
          type: 'button', class: 'btn btn--block btn--ghost',
          text: 'Verschiebung zurücknehmen',
          onclick: () => {
            // Beide Einträge weg: das Ziel und das „hier nichts" von hier.
            store.moveSession(movedAway.dayKey, null);
            store.moveSession(shownKey, null);
          },
        }));
    }

    const messages = {
      match: 'Spieltag. Heute gehört alles dem Spiel.',
      team: 'Mannschaftstraining. Das ist dein Training für heute.',
      rest: 'Kein Gym heute — Ruhetag.',
      gym: 'Für diesen Tag steht keine Einheit im Plan.',
    };

    return el('div', { class: 'card card--tone card--idle' },
      el('div', { class: 'card__head' },
        el('span', { class: 'eyebrow', text: 'Training' }),
        el('span', { class: `chip chip--daytype chip--${dayType}`, text: DAY_TYPE_LABELS[dayType] })),
      el('p', { class: 'today__headline', text: messages[dayType] }),
      upcoming
        ? el('p', { class: 'card__note' },
          `Als Nächstes: ${upcoming.session.name} am `
          + `${WEEKDAYS_LONG[weekdayOf(upcoming.dayKey)]}.`)
        : null);
  }

  const logged = getSession(state, shownKey, session.id);
  const done = totalSets(logged ? [logged] : []);
  const running = Boolean(logged?.startedAt && !logged.endedAt);
  const finished = Boolean(logged?.endedAt);
  const minutes = sessionMinutes(logged ?? {}, Date.now());
  const doneElsewhere = sessionDoneInWeek(state, shownKey, session.id);
  const movedHere = state.schedule?.[shownKey] === session.id;

  /* „läuft" schlägt „fertig": wer weiterloggt, ist nicht fertig. */
  const tone = running ? 'ok' : finished || done > 0 ? 'good' : 'idle';

  return el('div', { class: `card card--tone card--${tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: isToday ? 'Heute steht an' : 'An diesem Tag' }),
      el('span', { class: 'chip', text: `${session.blocks.reduce((n, b) => n + b.exercises.length, 0)} Übungen` })),

    el('p', { class: 'today__headline', text: session.name }),
    el('p', { class: 'today__focus', text: session.focus }),

    movedHere
      ? el('p', { class: 'card__note', text: 'Verschoben auf diesen Tag.' })
      : null,

    done > 0 || running
      ? el('div', { class: 'today__stats' },
        done > 0
          ? el('span', null, el('b', { text: String(done) }), ` ${setWord(done)} geloggt`)
          : null,
        // Unter einer Minute steht nichts — „0 Minuten" liest sich wie ein Fehler.
        minutes !== null && (running || minutes >= 1)
          ? el('span', null,
            el('b', { text: String(Math.round(minutes)) }),
            running ? ' Minuten — Uhr läuft' : ' Minuten')
          : null)
      : null,

    el('div', { style: 'height: var(--space-3)' }),
    el('button', {
      type: 'button',
      class: `btn btn--block${done > 0 ? '' : ' btn--primary'}`,
      text: running ? 'Training weiterführen'
        : done > 0 ? 'Einheit ansehen'
          : 'Training starten',
      onclick: () => openSession(store, shownKey, session),
    }),
    el('div', { style: 'height: var(--space-2)' }),
    el('button', {
      type: 'button', class: 'btn btn--block btn--ghost',
      text: 'Kann heute nicht — verschieben',
      onclick: () => openMoveSheet(store, shownKey, session),
    }),

    doneElsewhere && doneElsewhere !== shownKey
      ? el('p', { class: 'card__note' },
        `Diese Einheit ist in dieser Woche schon am ${formatDayShort(doneElsewhere)} `
        + 'geloggt worden.')
      : null);
}

/* ─── Gewicht ────────────────────────────────────────────────────────────── */

/**
 * Gewichtskarte mit Wochenstreifen.
 *
 * Der Streifen ist Flockes Vorgabe: jeden Tag dokumentiert, eine Woche im Blick.
 * Der lange Verlauf steht im Reiter Essen — hier geht es nur um "hab ich heute
 * gewogen".
 */
function weightCard(state, shownKey, store) {
  const day = getDay(state, shownKey);
  const slot = el('div');
  const input = decimalInput({
    id: 'weightToday',
    placeholder: dec(weightOn(state, shownKey), 1),
    value: toInputValue(day.weightKg),
  });

  function save() {
    replace(slot);
    const num = parseDecimal(input.value);
    if (num === null) {
      replace(slot, el('p', { class: 'field__hint', text: 'Bitte eine Zahl eintragen, z. B. 80,4.' }));
      return;
    }
    try {
      store.setDay(shownKey, { weightKg: num });
    } catch (err) {
      replace(slot, el('p', { class: 'field__hint', text: err.message }));
    }
  }

  const keys = weekKeys(shownKey);
  const raw = series(state, keys, (d) => d.weightKg);
  const measured = raw.filter((v) => typeof v === 'number').length;
  const missing = day.weightKg === null;

  /* Der gleitende Schnitt läuft über die sieben Tage BIS zum gezeigten Tag,
     nicht über die Kalenderwoche: sonst wäre der Wert am Montag ein Mittel aus
     Tagen, die noch nicht stattgefunden haben. */
  const trailing = Array.from({ length: WEIGHT_WINDOW }, (_, i) =>
    addDays(shownKey, i - WEIGHT_WINDOW + 1));
  const trailingAvg = movingAverage(
    series(state, trailing, (d) => d.weightKg), WEIGHT_WINDOW
  )[WEIGHT_WINDOW - 1];

  const known = raw.filter((v) => typeof v === 'number');
  const lo = known.length ? Math.min(...known) : 0;
  const hi = known.length ? Math.max(...known) : 1;
  const span = hi - lo || 1;

  /* „heute noch nicht" stimmt nur, wenn der gezeigte Tag heute ist. Nach dem
     Blättern auf Donnerstag wäre es eine falsche Auskunft. */
  const isToday = shownKey === todayKey();

  return el('div', { class: `card card--tone card--${missing ? 'ok' : 'good'}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Gewicht' }),
      missing
        ? el('span', {
          class: 'chip chip--ok',
          text: isToday ? 'heute noch nicht' : 'nichts eingetragen',
        })
        : el('span', { class: 'chip chip--good', text: 'eingetragen' })),

    missing
      ? el('p', {
        class: 'today__headline today__headline--sm',
        text: isToday ? 'Kurz auf die Waage' : 'Kein Wert an diesem Tag',
      })
      : el('p', { class: 'today__weight' },
        dec(day.weightKg, 1), el('span', { class: 'today__unit', text: 'kg' })),

    /* Feld und Knopf sitzen auf einer Grundlinie. Ein Blindlabel über dem Knopf
       wäre der schnellere Weg und würde die beiden um eine Zeile versetzen. */
    el('div', { class: 'field__row field__row--bottom' },
      el('div', null,
        el('label', { for: 'weightToday', text: 'Kilogramm' }),
        input),
      el('button', {
        type: 'button', class: 'btn btn--primary btn--block', text: 'Speichern', onclick: save,
      })),
    slot,

    /* Der Wochenstreifen: sieben Säulen, die fehlenden als Umriss. Ein
       fehlender Tag muss sichtbar sein — sonst merkt man nicht, dass man
       dreimal nicht gewogen hat. */
    el('div', { class: 'weightstrip' },
      keys.map((key, i) => {
        const value = raw[i];
        const has = typeof value === 'number';
        const height = has ? 20 + ((value - lo) / span) * 60 : 0;
        return el('div', {
          class: `weightstrip__col${key === shownKey ? ' weightstrip__col--shown' : ''}`,
          title: has ? `${formatDayShort(key)}: ${dec(value, 1)} kg` : `${formatDayShort(key)}: nichts`,
        },
          el('div', { class: 'weightstrip__bar-wrap' },
            has
              ? el('div', { class: 'weightstrip__bar', style: `height: ${height.toFixed(0)}%` })
              : el('div', { class: 'weightstrip__gap' })),
          el('span', { class: 'weightstrip__day', text: weekdayShort(key) }));
      })),

    el('div', { class: 'today__stats' },
      el('span', null, el('b', { text: `${measured}/7` }), ' Tage gewogen'),
      typeof trailingAvg === 'number'
        ? el('span', null, el('b', { text: dec(trailingAvg, 1) }), ' kg Ø 7 Tage')
        : null),

    el('p', { class: 'card__note' },
      'Am besten morgens nach dem Aufstehen. Einzelne Tage schwanken um ein ',
      'Kilo und mehr — bewertet wird nur der 7-Tage-Schnitt.'));
}

/* ─── Die zwei Erinnerungen ──────────────────────────────────────────────── */

/**
 * Warum die Erinnerungen HIER stehen und nicht als Handy-Benachrichtigung.
 *
 * Diese App hat keinen Server. Eine echte Push-Nachricht braucht einen — der
 * Browser kann sich nicht selbst zu einer Uhrzeit wecken, und die einzige
 * Schnittstelle, die das je konnte, hat Apple nie ausgeliefert. Eine
 * Benachrichtigung, die nur ankommt, während die App offen ist, erinnert an
 * nichts.
 *
 * Also das Ehrliche: der Hinweis liegt ganz oben auf dem Screen, den Flocke
 * täglich öffnet. Er ist groß, farbig und führt mit einem Tipp genau dorthin,
 * wo die Handlung passiert. Für den echten Stups aufs Display gibt es zwei
 * feste Erinnerungen in der iPhone-App — einmal eingerichtet, siehe README.
 */

/**
 * Sonntagabend: der Yazio-Wochenschnitt fehlt.
 *
 * Die einzige wiederkehrende Eingabe, an die die App von sich aus erinnert.
 * Ohne diese vier Zahlen kann sie über das Essen nichts sagen — weder im
 * Wochen- noch im Monats-Review. Die Regel liegt in js/lib/weekly.js.
 */
function weekMacrosCard(state, today, navigate) {
  const due = weekEntryDue(state, today);
  if (!due.due) return null;

  const tone = due.kind === 'today' ? 'ok' : 'bad';

  return el('div', { class: `card card--tone card--${tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Wochenschnitt' }),
      el('span', {
        class: `chip chip--${tone}`,
        text: due.kind === 'today' ? 'heute dran' : 'fehlt noch',
      })),
    el('p', { class: 'today__headline', text: 'Vier Zahlen aus Yazio' }),
    el('p', { class: 'today__focus', text: due.text }),
    el('div', { style: 'height: var(--space-3)' }),
    el('button', {
      type: 'button', class: 'btn btn--primary btn--block',
      text: 'Wochenschnitt eintragen',
      onclick: () => navigate('essen'),
    }));
}

/**
 * Die Aufforderung zum Monats-Review.
 *
 * Sie steht ganz oben und nur dann, wenn sie fällig ist — am letzten Tag des
 * Monats und danach, solange der Monat nicht abgehakt ist. Warum überhaupt
 * hier und nicht im Reiter Review: an einen Termin, den man selbst suchen
 * muss, denkt niemand am 31. abends. Die Regel liegt in js/lib/review.js.
 */
function monthReviewCard(state, today) {
  const due = monthReviewDue(state, today);
  if (!due.due) return null;

  return el('div', { class: `card card--tone card--${due.kind === 'today' ? 'ok' : 'bad'}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Monats-Review' }),
      el('span', {
        class: `chip chip--${due.kind === 'today' ? 'ok' : 'bad'}`,
        text: due.kind === 'today' ? 'heute fällig' : 'überfällig',
      })),
    el('p', { class: 'today__headline', text: formatMonth(due.month) }),
    el('p', { class: 'today__focus', text: due.text }),
    el('div', { style: 'height: var(--space-3)' }),
    el('button', {
      type: 'button', class: 'btn btn--primary btn--block',
      text: `${formatMonth(due.month)} ansehen`,
      onclick: () => {
        /* Direkt in den Monat des fälligen Reviews springen, nicht bloß in den
           Reiter: der Offset rechnet vom laufenden Monat zurück. */
        const [y, m] = due.month.split('-').map(Number);
        const [ty, tm] = today.split('-').map(Number);
        location.hash = `#/review?mode=month&offset=${(y - ty) * 12 + (m - tm)}`;
      },
    }));
}

/* ─── Entfallen: Beine und Tagesziel ─────────────────────────────────────────

   Hier standen zwei Karten, die jetzt weg sind:

   „Beine heute" hat die Spieltags-Regel erklärt, ohne dass man etwas damit tun
   konnte. Die Regel gilt unverändert — sie greift im Trainingsfenster an der
   einzelnen Übung, und dort steht auch die Begründung. Das ist die Stelle, an
   der sie eine Handlung ändert.

   „Ziel an diesem Tag" mit Kalorien und Makros ist in den Reiter Essen
   gewandert. Morgens beantwortet die Zahl keine Frage; abends beim Eintragen
   des Wochenschnitts schon.
   ───────────────────────────────────────────────────────────────────────────── */

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

/* Die Erinnerung steht auf dem Screen, den Flocke täglich sieht — nicht im
   Archiv, wo sie erst auffällt, wenn man ohnehin schon daran gedacht hat. */
function backupReminder(state, today, navigate) {
  const reminder = exportReminder(state, today);
  if (!reminder.due) return null;

  return el('div', { class: 'notice notice--error' },
    el('span', { class: 'notice__title', text: 'Sicherung überfällig' }),
    `${reminder.text} iOS löscht den Speicher von Web-Apps, die längere Zeit `,
    'nicht geöffnet werden — dann wäre alles weg.',
    el('div', { style: 'height: var(--space-3)' }),
    el('button', {
      type: 'button', class: 'btn btn--small',
      text: 'Jetzt sichern',
      onclick: () => navigate('archiv'),
    }));
}

/** Welcher Tag wird gezeigt? Aus der Route, mit heute als Rückfall. */
export function shownDayKey() {
  const query = location.hash.split('?')[1] ?? '';
  const wanted = new URLSearchParams(query).get('day');
  const today = todayKey();
  if (!wanted) return today;
  try {
    parseKey(wanted);
  } catch {
    return today;
  }
  // Nur innerhalb der laufenden Woche — weiter zurück ist Archivarbeit.
  const week = weekKeys(today);
  return week.includes(wanted) ? wanted : today;
}

export function render({ store, navigate }) {
  const state = store.getState();
  const shownKey = shownDayKey();
  const today = todayKey();

  const navigateDay = (key) => {
    location.hash = key === today ? '#/heute' : `#/heute?day=${key}`;
  };

  return el('div', { class: 'view' },
    weekband(state, shownKey, navigateDay),
    dayHeader(shownKey, navigateDay),
    backupReminder(state, today, navigate),
    checkinCard(store, shownKey),
    trainingCard(store, state, shownKey),

    /* DIE ERINNERUNGEN STEHEN UNTER DEM TRAINING, nicht darüber. Flockes
       Ansage. Und sie ist richtig: morgens will man wissen, was heute ansteht —
       ein Hinweis auf den Wochenschnitt VOR der Trainingskarte schiebt die
       Antwort auf die eigentliche Frage nach unten. Wer die Karte gelesen hat,
       ist ohnehin dabei zu scrollen.

       Untereinander nach Takt: der Monat kommt einmal im Monat und ist damit
       das Seltenere, der Wochenschnitt jede Woche. */
    monthReviewCard(state, today),
    weekMacrosCard(state, today, navigate),

    weightCard(state, shownKey, store));
}
