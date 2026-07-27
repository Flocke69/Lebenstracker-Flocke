/* Trends — was sich über Wochen bewegt.
 *
 * Fünf Charts, jeder mit genau einer Messgröße. Keine Doppelachsen, keine
 * Kombi-Bilder: zwei Größen sind zwei Charts, und der Zusammenhang zwischen
 * ihnen steht als SATZ darunter, nicht als zweite Linie im selben Bild.
 *
 * Der wichtigste Chart ist der erste, und seine Aussage ist die orange
 * Linie — nicht die weißen Punkte. Tagesgewicht schwankt um mehr, als in
 * einer Woche an Fett dazukommt oder weggeht.
 */

import { todayKey, weekdayShort, formatDayShort, weekStartKey, addDays }
  from '../lib/dates.js';
import {
  lastDays, series, movingAverage, weekSummary, summarize,
  SHORT_SLEEP_H, LOW_READINESS, WEIGHT_WINDOW, mean, countKnown,
} from '../lib/aggregate.js';
import { getDay, weightOn, dayTypeFor } from '../lib/state.js';
import { dayTargets, ageOn } from '../lib/energy.js';
import { MUSCLE_GROUPS } from '../../data/exercises.js';
import { setsPerMuscle } from '../lib/volume.js';
import { lineChart, barChart, sparkBars, chartTable } from './chart.js';
import { el, card, int, dec } from './dom.js';

/** Zeitfenster der Charts. 28 Tage zeigen einen Trainingsblock. */
const RANGE_DAYS = 28;
/** So viele Wochen zeigen die Volumen-Verläufe. */
const VOLUME_WEEKS = 6;
/** Muskelgruppen, die als Small Multiples auftauchen. */
const TRACKED_MUSCLES = ['shoulders', 'back', 'biceps', 'triceps', 'chest', 'hamstrings'];

function emptyHint(text) {
  return el('p', { class: 'field__hint', text });
}

/* ─── Gewicht ────────────────────────────────────────────────────────────── */

function weightCard(state, keys) {
  const raw = series(state, keys, (d) => d.weightKg);
  const avg = movingAverage(raw, WEIGHT_WINDOW);
  const known = avg.filter((v) => typeof v === 'number');
  const delta = known.length >= 2 ? known[known.length - 1] - known[0] : null;
  const measured = countKnown(raw);

  return card('Gewicht',
    el('span', { class: 'chip', text: `${measured} von ${keys.length} Tagen` }),
    measured === 0
      ? emptyHint('Noch nichts gewogen. Trag dein Gewicht im Reiter Heute ein — '
                + 'am besten morgens nach dem Aufstehen.')
      : el('div', null,
        lineChart({
          keys, raw, avg, title: 'Gewicht in Kilogramm', unit: 'kg', digits: 1,
        }),
        el('p', { class: 'insight' },
          'Die orange Linie ist der 7-Tage-Schnitt und die eigentliche Aussage. ',
          'Die weißen Punkte sind Tageswerte — sie schwanken um mehr, als in ',
          'einer Woche an Fett dazukommen kann.'),
        delta !== null
          ? el('p', { class: 'insight' },
            el('b', { text: `${delta > 0 ? '+' : ''}${dec(delta, 1)} kg` }),
            ` im Schnitt über die letzten ${keys.length} Tage.`)
          : emptyHint('Für einen Trend braucht es Werte an mehreren Tagen.'),
        chartTable(keys, [
          { label: 'kg', values: raw, digits: 1 },
          { label: 'Ø 7 Tage', values: avg, digits: 2 },
        ])));
}

/* ─── Schlaf ─────────────────────────────────────────────────────────────── */

function sleepCard(state, keys) {
  const values = series(state, keys, (d) => d.checkin?.sleepHours);
  const avg = mean(values);
  const short = values.filter((h) => typeof h === 'number' && h < SHORT_SLEEP_H).length;

  return card('Schlaf',
    avg !== null ? el('span', { class: 'chip', text: `Ø ${dec(avg, 1)} h` }) : null,
    countKnown(values) === 0
      ? emptyHint('Noch keine Schlafdaten. Der Check-in im Reiter Heute füllt das.')
      : el('div', null,
        barChart({
          keys, values, title: 'Schlafdauer in Stunden', unit: 'h', digits: 1,
          highlightIndex: keys.length - 1,
          refs: [{ value: SHORT_SLEEP_H, label: `${dec(SHORT_SLEEP_H, 1)} h` }],
        }),
        el('p', { class: 'insight' },
          el('b', { text: String(short) }),
          ` ${short === 1 ? 'Nacht' : 'Nächte'} unter ${dec(SHORT_SLEEP_H, 1)} Stunden. `,
          'Die gestrichelte Linie ist die Schwelle — sie steht dort als Position, ',
          'nicht als Farbe, damit sie bei jeder Sehschwäche lesbar bleibt.'),
        chartTable(keys, [{ label: 'Stunden', values, digits: 1 }])));
}

/* ─── Bereitschaft ───────────────────────────────────────────────────────── */

function readinessCard(state, keys) {
  const values = series(state, keys, (d) => d.readiness);
  const avg = mean(values);
  const low = values.filter((r) => typeof r === 'number' && r < LOW_READINESS).length;

  return card('Bereitschaft',
    avg !== null ? el('span', { class: 'chip', text: `Ø ${int(avg)}` }) : null,
    countKnown(values) === 0
      ? emptyHint('Noch keine Check-ins erfasst.')
      : el('div', null,
        lineChart({
          keys, raw: values, avg: movingAverage(values, 7),
          title: 'Bereitschaft 0 bis 100', digits: 0, fromZero: true,
          refs: [
            { value: 75, label: 'volles Programm' },
            { value: LOW_READINESS, label: 'Ruhetag' },
          ],
        }),
        el('p', { class: 'insight' },
          el('b', { text: String(low) }),
          ` ${low === 1 ? 'Tag' : 'Tage'} unter ${LOW_READINESS}. `,
          'Hängt der Schnitt über zwei Wochen unter 60, ist das ein Zeichen für ',
          'zu viel Gesamtbelastung — nicht für zu wenig Disziplin.'),
        chartTable(keys, [{ label: 'Punkte', values, digits: 0 }])));
}

/* ─── Kalorien und Protein ───────────────────────────────────────────────── */

function nutritionCard(state, keys) {
  const kcal = series(state, keys, (d) => d.nutrition?.kcal);
  const protein = series(state, keys, (d) => d.nutrition?.proteinG);

  const targets = keys.map((key) => {
    const p = state.profile;
    try {
      return dayTargets({
        sex: p.sex, weightKg: weightOn(state, key), heightCm: p.heightCm,
        age: ageOn(p.birthYear, key), dayType: dayTypeFor(state, key),
        factors: p.activityFactors, proteinPerKg: p.proteinPerKg,
        fatPerKg: p.fatPerKg, kcalOffset: p.kcalOffset,
        offsetExemptDayTypes: p.offsetExemptDayTypes,
      });
    } catch { return null; }
  });
  const kcalTargetAvg = mean(targets.map((t) => t?.kcal));
  const proteinTargetAvg = mean(targets.map((t) => t?.proteinG));

  if (countKnown(kcal) === 0 && countKnown(protein) === 0) {
    return card('Ernährung', null,
      emptyHint('Noch nichts eingetragen. Der Reiter Essen füllt diese Charts.'));
  }

  return card('Ernährung',
    el('span', { class: 'chip', text: `${countKnown(kcal)} Tage erfasst` }),
    el('h3', { text: 'Kalorien' }),
    barChart({
      keys, values: kcal, title: 'Kalorien pro Tag', unit: 'kcal', digits: 0,
      highlightIndex: keys.length - 1,
      refs: kcalTargetAvg !== null
        ? [{ value: kcalTargetAvg, label: `Ø Ziel ${int(kcalTargetAvg)}` }]
        : [],
    }),
    el('div', { style: 'height: var(--space-5)' }),
    el('h3', { text: 'Protein' }),
    // Zwei Messgrößen, zwei Charts — nie zwei Achsen in einem Bild.
    barChart({
      keys, values: protein, title: 'Protein pro Tag', unit: 'g', digits: 0,
      highlightIndex: keys.length - 1,
      refs: proteinTargetAvg !== null
        ? [{ value: proteinTargetAvg, label: `Ziel ${int(proteinTargetAvg)} g` }]
        : [],
    }),
    el('p', { class: 'insight' },
      'Protein ist die Zahl, an der im Defizit alles hängt: sie entscheidet, ',
      'ob du Fett verlierst oder Fett und Muskeln.'),
    chartTable(keys, [
      { label: 'kcal', values: kcal, digits: 0 },
      { label: 'Protein g', values: protein, digits: 0 },
    ]));
}

/* ─── Volumen je Muskelgruppe ────────────────────────────────────────────── */

function volumeCard(state, today) {
  const weekStarts = Array.from({ length: VOLUME_WEEKS }, (_, i) =>
    addDays(weekStartKey(today), (i - VOLUME_WEEKS + 1) * 7));

  const perWeek = weekStarts.map((start) => {
    const keys = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const sessions = keys.flatMap((key) => getDay(state, key).sessions ?? []);
    return setsPerMuscle(sessions);
  });

  const anyVolume = perWeek.some((v) => Object.values(v).some((n) => n > 0));

  return card('Trainingsvolumen',
    el('span', { class: 'chip', text: `${VOLUME_WEEKS} Wochen` }),
    !anyVolume
      ? emptyHint('Noch keine Sätze geloggt. Der Reiter Training füllt das.')
      : el('div', null,
        el('div', { class: 'spark-grid' },
          TRACKED_MUSCLES.map((key) =>
            sparkBars({
              label: MUSCLE_GROUPS[key],
              values: perWeek.map((v) => v[key] ?? 0),
            }))),
        el('p', { class: 'insight' },
          'Ein Verlauf je Muskelgruppe statt eines gestapelten Balkens. ',
          'Sechs Gruppen in einem Stapel bräuchten sechs unterscheidbare ',
          'Farben — und die Frage lautet ohnehin „steigt mein Schultervolumen", ',
          'nicht „wie teilt sich diese Woche auf".'),
        el('p', { class: 'field__hint' },
          `Jeder Balken ist eine Woche, der letzte ist die laufende. `
          + `Eine Hauptmuskelgruppe zählt einen Satz, eine Nebengruppe einen halben.`)));
}

/* ─── Zusammenhänge ──────────────────────────────────────────────────────── */

function insightCard(state, keys) {
  const summary = summarize(state, keys, { kind: 'range' });
  const sleepEffect = summary.insights.sleepVsReadiness;

  const items = [];

  if (sleepEffect.difference !== null) {
    const punkte = Math.abs(Math.round(sleepEffect.difference));
    items.push(el('p', { class: 'insight' },
      `An Tagen nach einer Nacht unter ${dec(SHORT_SLEEP_H, 1)} Stunden lag deine `,
      'Bereitschaft im Schnitt ',
      el('b', { text: `${punkte} Punkte` }),
      sleepEffect.difference < 0 ? ' niedriger' : ' höher',
      `. Verglichen wurden ${sleepEffect.inGroup} kurze gegen `,
      `${sleepEffect.outGroup} normale Nächte.`));
  }

  if (summary.weight.delta !== null && summary.nutrition.kcalAvg !== null) {
    const richtung = summary.weight.delta < 0 ? 'gefallen' : 'gestiegen';
    items.push(el('p', { class: 'insight' },
      `Bei durchschnittlich ${int(summary.nutrition.kcalAvg)} kcal ist dein `,
      `Gewichtsschnitt um ${dec(Math.abs(summary.weight.delta), 1)} kg ${richtung}. `,
      'Wenn das über zwei Wochen nicht zum Ziel passt, liegt es meistens an den ',
      'Aktivitätsfaktoren im Profil — nicht an der Formel.'));
  }

  if (items.length === 0) {
    items.push(emptyHint(
      'Für Zusammenhänge braucht es mehrere Wochen Daten. Nach zwei Wochen '
      + 'täglichem Check-in steht hier der erste Befund.'));
  }

  return card('Was zusammenhängt', null, ...items);
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();
  const keys = lastDays(today, RANGE_DAYS);

  return el('div', { class: 'view' },
    el('h1', { text: 'Trends' }),
    el('p', { class: 'field__hint' },
      `Die letzten ${RANGE_DAYS} Tage. Jeder Chart zeigt genau eine Größe — `,
      'Zusammenhänge stehen als Satz darunter, nicht als zweite Linie im Bild.'),
    el('div', { style: 'height: var(--space-4)' }),

    weightCard(state, keys),
    readinessCard(state, keys),
    sleepCard(state, keys),
    nutritionCard(state, keys),
    volumeCard(state, today),
    insightCard(state, keys));
}
