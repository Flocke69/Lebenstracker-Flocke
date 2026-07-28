/* Trends — was sich über Wochen bewegt.
 *
 * DREI ABSCHNITTE: Training, Essen, Gewicht. Sechs Charts hintereinander sind
 * auf einem Handydisplay kein Überblick, sondern eine Strecke. Zugeklappt steht
 * pro Abschnitt ein Urteil, aufgeklappt liegen die Charts darin.
 *
 * Die Zuordnung folgt der Frage, die man hat: Bereitschaft und Schlaf sagen
 * etwas über das TRAINING, nicht über den Schlaf an sich — deshalb stehen sie
 * dort und nicht in einem eigenen Abschnitt.
 *
 * Bunt und kurz, das war Flockes Vorgabe. Deshalb:
 *
 *   EINE FARBE JE MESSGRÖSSE. Gewicht blau, Bereitschaft grün, Schlaf
 *   violett, Kalorien orange, Protein pink, Volumen gelb. Über alle Screens
 *   dieselbe — man erkennt den Chart an der Farbe, bevor man den Titel liest.
 *
 *   EIN SATZ JE CHART, nicht drei. Der erste Entwurf erklärte unter jedem
 *   Bild, warum es so gebaut ist. Das gehört in den Quelltext, nicht auf den
 *   Screen. Was bleibt, ist der BEFUND: die Zahl mit Richtung und Urteil.
 *
 *   KEINE DOPPELACHSE. Zwei Messgrößen sind zwei Charts.
 *
 * Die Charts brauchen Wochen, um etwas zu zeigen. Solange die Daten dünn sind,
 * sagt die App das offen statt eine Linie aus zwei Punkten zu zeichnen.
 */

import { todayKey, weekStartKey, addDays } from '../lib/dates.js';
import {
  lastDays, series, movingAverage, summarize,
  SHORT_SLEEP_H, LOW_READINESS, WEIGHT_WINDOW, mean, countKnown,
} from '../lib/aggregate.js';
import { getDay, weightOn, dayTypeFor } from '../lib/state.js';
import { dayTargets, ageOn } from '../lib/energy.js';
import { MUSCLE_GROUPS } from '../../data/exercises.js';
import { setsPerMuscle } from '../lib/volume.js';
import { weekPlan } from '../lib/schedule.js';
import { lineChart, barChart, sparkBars, chartTable } from './chart.js';
import { ratioRing } from './gauge.js';
import { el, card, panel, int, dec } from './dom.js';

/** Zeitfenster der Charts. 28 Tage zeigen einen Trainingsblock. */
const RANGE_DAYS = 28;
/** So viele Wochen zeigen die Volumen-Verläufe. */
const VOLUME_WEEKS = 6;
/** Muskelgruppen, die als Small Multiples auftauchen. */
const TRACKED_MUSCLES = ['back', 'chest', 'shoulders', 'biceps', 'triceps', 'quads'];
/** Unter so vielen Werten wird nicht bewertet, nur gezeigt. */
const MIN_FOR_VERDICT = 8;

/**
 * Karte mit Statusfarbe und Kennzahl im Kopf.
 *
 * Der Kopf trägt Farbe UND Wort. Ohne das Wort wäre die Farbe die einzige
 * Kodierung — und damit für jeden mit Rot-Grün-Schwäche keine.
 */
function toneCard(title, { tone = 'idle', badge = null }, ...children) {
  return el('div', { class: `card card--tone card--${tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: title }),
      badge ? el('span', { class: `chip chip--${tone}`, text: badge }) : null),
    ...children);
}

function thin(text) {
  return el('p', { class: 'field__hint', text });
}

/** Der Befund unter einem Chart: eine große Zahl, ein kurzer Satz. */
function verdict(value, unit, text, tone) {
  return el('p', { class: `verdict verdict--${tone}` },
    el('b', { text: `${value}${unit ? ` ${unit}` : ''}` }),
    ` ${text}`);
}

/* ─── Gewicht ────────────────────────────────────────────────────────────── */

function weightCard(state, keys) {
  const raw = series(state, keys, (d) => d.weightKg);
  const avg = movingAverage(raw, WEIGHT_WINDOW);
  const known = avg.filter((v) => typeof v === 'number');
  const delta = known.length >= 2 ? known[known.length - 1] - known[0] : null;
  const measured = countKnown(raw);

  if (measured === 0) {
    return toneCard('Gewicht', { tone: 'idle' },
      thin('Noch nichts gewogen. Der Reiter Heute füllt diesen Chart.'));
  }

  /* Bei Recomp ist stabil das Ziel. Deshalb ist wenig Bewegung "gut" und viel
     "auffällig" — nicht umgekehrt. */
  const tone = delta === null ? 'idle'
    : Math.abs(delta) <= 0.5 ? 'good'
      : Math.abs(delta) <= 1.2 ? 'ok' : 'bad';

  return toneCard('Gewicht', { tone, badge: `${measured} von ${keys.length} Tagen` },
    lineChart({
      keys, raw, avg, series: 'weight',
      title: 'Gewicht in Kilogramm', unit: 'kg', digits: 1,
    }),
    delta !== null
      ? verdict(`${delta > 0 ? '+' : ''}${dec(delta, 1)}`, 'kg',
        `im 7-Tage-Schnitt über ${keys.length} Tage.`, tone)
      : thin('Für einen Trend braucht es Werte an mehreren Tagen.'),
    chartTable(keys, [
      { label: 'kg', values: raw, digits: 1 },
      { label: 'Ø 7 Tage', values: avg, digits: 2 },
    ], 'gewicht'));
}

/* ─── Bereitschaft ───────────────────────────────────────────────────────── */

function readinessCard(state, keys) {
  const values = series(state, keys, (d) => d.readiness);
  const avg = mean(values);
  const count = countKnown(values);
  const low = values.filter((r) => typeof r === 'number' && r < LOW_READINESS).length;
  const good = values.filter((r) => typeof r === 'number' && r >= 75).length;

  if (count === 0) {
    return toneCard('Bereitschaft', { tone: 'idle' },
      thin('Noch keine Check-ins erfasst.'));
  }

  const tone = count < MIN_FOR_VERDICT ? 'idle'
    : avg >= 70 ? 'good' : avg >= 60 ? 'ok' : 'bad';

  /* Der Befund muss zur Farbe passen. Vorher stand in Grün "6 Tage unter der
     Schwelle" — die Zahl sagte schlecht, die Farbe gut. Bei gutem Schnitt wird
     deshalb das Erfreuliche gezählt, sonst das Auffällige. */
  const finding = tone === 'good'
    ? verdict(String(good), good === 1 ? 'Tag' : 'Tage',
      'mit vollem Programm. Der Schnitt trägt.', 'good')
    : verdict(String(low), low === 1 ? 'Tag' : 'Tage',
      'unter der Schwelle. Hält das zwei Wochen an, ist die Gesamtbelastung '
      + 'zu hoch — nicht die Disziplin zu niedrig.', tone);

  return toneCard('Bereitschaft', { tone, badge: `${count} Check-ins` },
    el('div', { class: 'ring-row' },
      ratioRing(good / count, { label: 'gute Tage', tone: 'good' }),
      ratioRing(low / count, { label: 'schlechte Tage', tone: 'bad' })),
    lineChart({
      keys, raw: values, avg: movingAverage(values, 7), series: 'ready',
      title: 'Bereitschaft im Verlauf', digits: 0, fromZero: true,
      // Die Skala endet bei 100. Ohne Deckel stand dort "108".
      maxCap: 100,
      /* Wörter statt Zahlen an den Schwellen: der Check-in erzeugt für Flocke
         keine Punktzahl, also soll auch die Achse keine Marke bei "75"
         behaupten, mit der er etwas anfangen müsste. */
      refs: [
        { value: 75, label: 'gut' },
        { value: LOW_READINESS, label: 'schlecht' },
      ],
    }),
    count < MIN_FOR_VERDICT
      ? thin(`Noch ${MIN_FOR_VERDICT - count} Check-ins, dann wird hier bewertet.`)
      : finding,
    chartTable(keys, [{ label: 'Bereitschaft', values, digits: 0 }], 'bereitschaft'));
}

/* ─── Schlaf ─────────────────────────────────────────────────────────────── */

function sleepCard(state, keys) {
  const values = series(state, keys, (d) => d.checkin?.sleepHours);
  const avg = mean(values);
  const count = countKnown(values);
  const short = values.filter((h) => typeof h === 'number' && h < SHORT_SLEEP_H).length;

  if (count === 0) {
    return toneCard('Schlaf', { tone: 'idle' },
      thin('Noch keine Schlafdaten. Der Check-in füllt das.'));
  }

  const tone = count < MIN_FOR_VERDICT ? 'idle'
    : avg >= 7.5 ? 'good' : avg >= SHORT_SLEEP_H ? 'ok' : 'bad';

  return toneCard('Schlaf', { tone, badge: `Ø ${dec(avg, 1)} h` },
    barChart({
      keys, values, series: 'sleep',
      title: 'Schlafdauer in Stunden', unit: 'h', digits: 1,
      highlightIndex: keys.length - 1,
      refs: [{ value: SHORT_SLEEP_H, label: `${dec(SHORT_SLEEP_H, 1)} h` }],
    }),
    verdict(String(short), short === 1 ? 'Nacht' : 'Nächte',
      `unter ${dec(SHORT_SLEEP_H, 1)} Stunden.`, tone),
    chartTable(keys, [{ label: 'Stunden', values, digits: 1 }], 'schlaf'));
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
    return toneCard('Ernährung pro Tag', { tone: 'idle' },
      thin('Die Tageswerte sind freiwillig — die Auswertung läuft über den '
         + 'Wochenschnitt im Reiter Essen.'));
  }

  const proteinAvg = mean(protein);
  const tone = proteinAvg === null || proteinTargetAvg === null ? 'idle'
    : proteinAvg / proteinTargetAvg >= 0.9 ? 'good'
      : proteinAvg / proteinTargetAvg >= 0.8 ? 'ok' : 'bad';

  return toneCard('Ernährung pro Tag', { tone, badge: `${countKnown(kcal)} Tage` },
    el('h3', { text: 'Kalorien' }),
    barChart({
      keys, values: kcal, series: 'kcal',
      title: 'Kalorien pro Tag', unit: 'kcal', digits: 0,
      highlightIndex: keys.length - 1,
      refs: kcalTargetAvg !== null
        ? [{ value: kcalTargetAvg, label: `Ø Ziel ${int(kcalTargetAvg)}` }]
        : [],
    }),
    el('div', { style: 'height: var(--space-5)' }),
    el('h3', { text: 'Protein' }),
    barChart({
      keys, values: protein, series: 'protein',
      title: 'Protein pro Tag', unit: 'g', digits: 0,
      highlightIndex: keys.length - 1,
      refs: proteinTargetAvg !== null
        ? [{ value: proteinTargetAvg, label: `Ziel ${int(proteinTargetAvg)} g` }]
        : [],
    }),
    proteinAvg !== null
      ? verdict(int(proteinAvg), 'g', 'Protein im Schnitt.', tone)
      : null,
    chartTable(keys, [
      { label: 'kcal', values: kcal, digits: 0 },
      { label: 'Protein g', values: protein, digits: 0 },
    ], 'ernaehrung'));
}

/* ─── Volumen je Muskelgruppe ────────────────────────────────────────────── */

function volumeCard(state, today) {
  const weekStarts = Array.from({ length: VOLUME_WEEKS }, (_, i) =>
    addDays(weekStartKey(today), (i - VOLUME_WEEKS + 1) * 7));

  const perWeek = weekStarts.map((start) => {
    /* Über weekPlan, nicht über die sieben Kalendertage: verschobene Einheiten
       sollen in der Woche zählen, in der sie tatsächlich stattgefunden haben. */
    const keys = weekPlan(state, start).map((e) => e.dayKey).filter(Boolean);
    const extra = Array.from({ length: 7 }, (_, i) => addDays(start, i))
      .filter((k) => !keys.includes(k));
    const sessions = [...keys, ...extra].flatMap((key) => getDay(state, key).sessions ?? []);
    return setsPerMuscle(sessions);
  });

  const anyVolume = perWeek.some((v) => Object.values(v).some((n) => n > 0));

  if (!anyVolume) {
    return toneCard('Trainingsvolumen', { tone: 'idle' },
      thin('Noch keine Sätze geloggt. Der Reiter Training füllt das.'));
  }

  const total = perWeek[perWeek.length - 1];
  const previous = perWeek[perWeek.length - 2] ?? {};
  const sumNow = Object.values(total).reduce((a, b) => a + b, 0);
  const sumBefore = Object.values(previous).reduce((a, b) => a + b, 0);
  const tone = sumBefore === 0 ? 'idle'
    : sumNow >= sumBefore ? 'good' : sumNow >= sumBefore * 0.7 ? 'ok' : 'bad';

  return toneCard('Trainingsvolumen', { tone, badge: `${VOLUME_WEEKS} Wochen` },
    el('div', { class: 'spark-grid' },
      TRACKED_MUSCLES.map((key) =>
        sparkBars({
          label: MUSCLE_GROUPS[key],
          values: perWeek.map((v) => v[key] ?? 0),
        }))),
    el('p', { class: 'field__hint' },
      'Jeder Balken ist eine Woche, der letzte die laufende.'));
}

/* ─── Zusammenhänge ──────────────────────────────────────────────────────── */

/**
 * Der Schlaf-Befund, ohne Punktzahl.
 *
 * Vorher stand hier „im Schnitt 21 Punkte niedriger" — und damit war die
 * Punktzahl zurück, die aus dem Check-in bewusst verschwunden ist. Gezählt
 * werden deshalb SCHLECHTE TAGE in beiden Gruppen: „nach kurzen Nächten war
 * jeder zweite Tag schlecht, sonst jeder fünfte" ist dieselbe Information in
 * einer Einheit, mit der man etwas anfangen kann.
 */
function sleepEffectSentence(state, keys) {
  const sleep = series(state, keys, (d) => d.checkin?.sleepHours);
  const readiness = series(state, keys, (d) => d.readiness);

  let shortNights = 0;
  let shortBad = 0;
  let normalNights = 0;
  let normalBad = 0;

  keys.forEach((_, i) => {
    const h = sleep[i];
    const r = readiness[i];
    if (typeof h !== 'number' || typeof r !== 'number') return;
    const bad = r < LOW_READINESS;
    if (h < SHORT_SLEEP_H) {
      shortNights += 1;
      if (bad) shortBad += 1;
    } else {
      normalNights += 1;
      if (bad) normalBad += 1;
    }
  });

  // Unter zwei Nächten je Gruppe ist der Vergleich Zufall.
  if (shortNights < 2 || normalNights < 2) return null;

  const shortShare = Math.round((shortBad / shortNights) * 100);
  const normalShare = Math.round((normalBad / normalNights) * 100);

  return el('p', { class: 'insight' },
    `Nach einer Nacht unter ${dec(SHORT_SLEEP_H, 1)} Stunden war `,
    el('b', { text: `${shortShare} %` }),
    ` der Tage schlecht — nach längeren Nächten ${normalShare} %. `,
    `(${shortNights} kurze gegen ${normalNights} normale Nächte.)`);
}

function insightCard(state, keys) {
  const summary = summarize(state, keys, { kind: 'range' });
  const items = [];

  const sleepSentence = sleepEffectSentence(state, keys);
  if (sleepSentence) items.push(sleepSentence);

  if (summary.weight.delta !== null && summary.nutrition.kcalAvg !== null) {
    items.push(el('p', { class: 'insight' },
      `Bei Ø ${int(summary.nutrition.kcalAvg)} kcal hat sich der Gewichtsschnitt um `,
      el('b', { text: `${dec(summary.weight.delta, 1)} kg` }),
      ' bewegt.'));
  }

  if (items.length === 0) {
    return toneCard('Was zusammenhängt', { tone: 'idle' },
      thin('Für Zusammenhänge braucht es mehrere Wochen Daten. Nach zwei Wochen '
         + 'täglichem Check-in steht hier der erste Befund.'));
  }

  return toneCard('Was zusammenhängt', { tone: 'idle' }, ...items);
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

/**
 * Ein ehrlicher Hinweis, solange die Datenlage dünn ist.
 *
 * Ohne den liest man dünne Charts als „nichts passiert" statt als „noch nicht
 * genug erfasst" — und das sind zwei sehr verschiedene Aussagen.
 */
function fillHint(state, keys) {
  const days = countKnown(series(state, keys, (d) => d.readiness));
  const weeksFilled = Math.floor(days / 7);
  if (weeksFilled >= 3) return null;

  return el('div', { class: 'notice notice--warn' },
    el('span', { class: 'notice__title', text: 'Die Charts füllen sich noch' }),
    `${days} von ${keys.length} Tagen erfasst. Ab etwa drei Wochen täglichem `,
    'Check-in werden Trends ablesbar — vorher zeigen die Linien vor allem ',
    'Zufall. Bis dahin gilt: eintragen und nichts umstellen.');
}

/* ─── Urteil je Abschnitt ────────────────────────────────────────────────────
 *
 * Steht auf dem zugeklappten Kopf. Ohne das müsste man jeden Abschnitt öffnen,
 * um zu wissen, ob sich das Öffnen lohnt — und dann ist die Aufteilung nur eine
 * zusätzliche Hürde.
 */

function trainingStatus(state, keys) {
  const readiness = series(state, keys, (d) => d.readiness);
  const count = countKnown(readiness);
  if (count === 0) return { tone: 'idle', chip: 'noch keine Daten' };
  if (count < MIN_FOR_VERDICT) return { tone: 'idle', chip: `${count} Check-ins` };
  const avg = mean(readiness);
  const tone = avg >= 70 ? 'good' : avg >= 60 ? 'ok' : 'bad';
  return {
    tone,
    chip: { good: 'trägt', ok: 'grenzwertig', bad: 'zu viel Last' }[tone],
  };
}

function foodStatus(state, keys) {
  const kcal = series(state, keys, (d) => d.nutrition?.kcal);
  const protein = series(state, keys, (d) => d.nutrition?.proteinG);
  if (countKnown(kcal) === 0 && countKnown(protein) === 0) {
    return { tone: 'idle', chip: 'Tageswerte freiwillig' };
  }
  return { tone: 'idle', chip: `${countKnown(kcal)} Tage erfasst` };
}

function weightStatus(state, keys) {
  const raw = series(state, keys, (d) => d.weightKg);
  if (countKnown(raw) === 0) return { tone: 'idle', chip: 'nichts gewogen' };
  const avg = movingAverage(raw, WEIGHT_WINDOW).filter((v) => typeof v === 'number');
  if (avg.length < 2) return { tone: 'idle', chip: 'zu wenig Werte' };
  const delta = avg[avg.length - 1] - avg[0];
  const tone = Math.abs(delta) <= 0.5 ? 'good' : Math.abs(delta) <= 1.2 ? 'ok' : 'bad';
  return { tone, chip: `${delta > 0 ? '+' : ''}${dec(delta, 1)} kg` };
}

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();
  const keys = lastDays(today, RANGE_DAYS);

  const training = trainingStatus(state, keys);
  const food = foodStatus(state, keys);
  const weight = weightStatus(state, keys);

  return el('div', { class: 'view' },
    el('h1', { text: 'Trends' }),
    el('p', { class: 'field__hint', text: `Die letzten ${RANGE_DAYS} Tage. Antippen öffnet einen Abschnitt.` }),
    el('div', { style: 'height: var(--space-4)' }),

    fillHint(state, keys),

    panel({
      title: 'Training',
      keep: 'trends-training',
      chip: training.chip,
      tone: training.tone,
      note: 'Bereitschaft, Schlaf und Volumen stehen hier zusammen: sie sagen '
          + 'etwas über die Belastung, nicht über sich selbst.',
    },
      readinessCard(state, keys),
      sleepCard(state, keys),
      volumeCard(state, today)),

    panel({
      title: 'Essen',
      keep: 'trends-essen',
      chip: food.chip,
      tone: food.tone,
      note: 'Die maßgebliche Zahl ist der Yazio-Wochenschnitt im Reiter Essen. '
          + 'Diese Charts zeigen die freiwilligen Tageswerte.',
    },
      nutritionCard(state, keys)),

    panel({
      title: 'Gewicht',
      keep: 'trends-gewicht',
      chip: weight.chip,
      tone: weight.tone,
      note: 'Bei Recomp ist stabil das Ziel — wenig Bewegung ist hier das gute '
          + 'Ergebnis, nicht das langweilige.',
    },
      weightCard(state, keys)),

    insightCard(state, keys));
}
