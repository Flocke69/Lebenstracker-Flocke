/* Kennzahlen über Zeiträume.
 *
 * Eine Quelle für drei Verbraucher: Trends, Reviews und das Monatsarchiv.
 * Was hier herauskommt, ist genau das, was am Monatsende verdichtet
 * gespeichert wird — die Langzeit-Trends laufen später über nichts anderes.
 *
 * Zwei Haltungen ziehen sich durch:
 *
 *   Fehlende Werte sind `null`, nie 0. Ein Tag ohne Wiegen ist kein Tag mit
 *   0 kg. Jede Mittelung überspringt Lücken und sagt dazu, über wie viele
 *   Werte sie gerechnet hat.
 *
 *   Der Tageswert ist Rauschen. Beim Gewicht zählt der gleitende
 *   7-Tage-Schnitt; Wasserhaushalt und Darminhalt schwanken um mehr als das,
 *   was in einer Woche an Fett dazukommt oder weggeht.
 */

import { monthDays, weekKeys, weekStartKey, addDays, parseKey }
  from './dates.js';
import { getDay, weightOn, dayTypeFor, hasLoggedSets } from './state.js';
import { dayTargets, ageOn } from './energy.js';
import { setsPerMuscle, tonnage, totalSets, emptyVolume } from './volume.js';

/** Fenster des gleitenden Gewichtsschnitts, in Tagen. */
export const WEIGHT_WINDOW = 7;
/** Unter dieser Schlafdauer gilt eine Nacht als zu kurz. */
export const SHORT_SLEEP_H = 6.5;
/** Unter diesem Bereitschafts-Wert gilt ein Tag als schlecht. */
export const LOW_READINESS = 50;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ─── Kleine Statistik ───────────────────────────────────────────────────── */

/** Mittelwert über die vorhandenen Werte. null, wenn keiner da ist. */
export function mean(values) {
  const known = (values ?? []).filter(isNum);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0) / known.length;
}

export function minOf(values) {
  const known = (values ?? []).filter(isNum);
  return known.length ? Math.min(...known) : null;
}

export function maxOf(values) {
  const known = (values ?? []).filter(isNum);
  return known.length ? Math.max(...known) : null;
}

export function countKnown(values) {
  return (values ?? []).filter(isNum).length;
}

/**
 * Gleitender Durchschnitt über ein rückwärts gerichtetes Fenster.
 *
 * Lücken werden übersprungen, nicht als 0 gewertet. Enthält ein Fenster gar
 * keinen Wert, steht dort `null` — und nicht der letzte bekannte Wert, denn
 * das würde eine Messung vortäuschen, die es nicht gab.
 */
export function movingAverage(values, window = WEIGHT_WINDOW) {
  if (!Number.isInteger(window) || window < 1) {
    throw new RangeError(`Fenster muss mindestens 1 sein, war: ${window}`);
  }
  return (values ?? []).map((_, i) => {
    const from = Math.max(0, i - window + 1);
    return mean(values.slice(from, i + 1));
  });
}

/**
 * Mittelwertvergleich zweier Gruppen — Grundlage der Korrelations-Hinweise.
 *
 * Bewusst kein Korrelationskoeffizient: "an Tagen mit unter 6,5 h Schlaf lag
 * deine Bereitschaft im Schnitt 22 Punkte niedriger" ist verständlich und
 * handlungsleitend. Ein r von −0,41 ist es nicht.
 */
export function groupDifference(pairs, predicate) {
  const inGroup = [];
  const outGroup = [];
  for (const [x, y] of pairs ?? []) {
    if (!isNum(x) || !isNum(y)) continue;
    (predicate(x) ? inGroup : outGroup).push(y);
  }
  const a = mean(inGroup);
  const b = mean(outGroup);
  if (a === null || b === null || inGroup.length < 2 || outGroup.length < 2) {
    return { difference: null, inGroup: inGroup.length, outGroup: outGroup.length,
             meanIn: a, meanOut: b };
  }
  return { difference: a - b, inGroup: inGroup.length, outGroup: outGroup.length,
           meanIn: a, meanOut: b };
}

/* ─── Reihen ─────────────────────────────────────────────────────────────── */

/** Werte eines Feldes über einen Zeitraum, Lücken als null. */
export function series(state, keys, pick) {
  return keys.map((key) => {
    const value = pick(getDay(state, key), key);
    return isNum(value) ? value : null;
  });
}

/** Gewicht mit gleitendem Schnitt — die eigentliche Trendlinie. */
export function weightSeries(state, keys) {
  const raw = series(state, keys, (day) => day.weightKg);
  return { keys, raw, avg: movingAverage(raw, WEIGHT_WINDOW) };
}

/* ─── Zusammenfassung eines Zeitraums ────────────────────────────────────── */

function nutritionTargets(state, key) {
  const p = state.profile;
  if (!p) return null;
  try {
    return dayTargets({
      sex: p.sex,
      weightKg: weightOn(state, key),
      heightCm: p.heightCm,
      age: ageOn(p.birthYear, key),
      dayType: dayTypeFor(state, key),
      factors: p.activityFactors,
      proteinPerKg: p.proteinPerKg,
      fatPerKg: p.fatPerKg,
      kcalOffset: p.kcalOffset,
      offsetExemptDayTypes: p.offsetExemptDayTypes,
    });
  } catch {
    return null;
  }
}

/**
 * Alle Kennzahlen eines Zeitraums.
 *
 * Genau diese Form wird am Monatsende ins Archiv geschrieben.
 */
export function summarize(state, keys, meta = {}) {
  const days = keys.map((key) => getDay(state, key));

  const weight = series(state, keys, (d) => d.weightKg);
  const sleep = series(state, keys, (d) => d.checkin?.sleepHours);
  const readiness = series(state, keys, (d) => d.readiness);
  const soreness = series(state, keys, (d) => d.checkin?.soreness);
  const kcal = series(state, keys, (d) => d.nutrition?.kcal);
  const protein = series(state, keys, (d) => d.nutrition?.proteinG);

  const avg = movingAverage(weight, WEIGHT_WINDOW);
  const knownAvg = avg.filter(isNum);

  // Ziele je Tag — für Trefferquoten
  let kcalHits = 0;
  let kcalCompared = 0;
  let proteinHits = 0;
  let proteinCompared = 0;
  let targetKcalSum = 0;
  let targetKcalCount = 0;

  keys.forEach((key, i) => {
    const t = nutritionTargets(state, key);
    if (!t) return;
    targetKcalSum += t.kcal;
    targetKcalCount += 1;
    if (isNum(kcal[i])) {
      kcalCompared += 1;
      const ratio = kcal[i] / t.kcal;
      if (ratio >= 0.9 && ratio <= 1.1) kcalHits += 1;
    }
    if (isNum(protein[i])) {
      proteinCompared += 1;
      if (protein[i] / t.proteinG >= 0.9) proteinHits += 1;
    }
  });

  /* Nur Einheiten mit mindestens einem geloggten Satz. Schon der Startknopf
     legt eine Einheit an — wer nur reinschaut und wieder schließt, hat nicht
     trainiert und darf nicht als Trainingstag zählen. */
  const sessions = days.flatMap((d) => d.sessions ?? []).filter(hasLoggedSets);
  const dayTypes = keys.map((key) => dayTypeFor(state, key));

  return {
    period: {
      ...meta,
      start: keys[0] ?? null,
      end: keys[keys.length - 1] ?? null,
      dayCount: keys.length,
    },

    logging: {
      daysWithCheckin: days.filter((d) => d.checkin && Object.keys(d.checkin).length).length,
      daysWithWeight: countKnown(weight),
      daysWithNutrition: countKnown(kcal),
      daysWithTraining: days.filter((d) => (d.sessions ?? []).some(hasLoggedSets)).length,
    },

    weight: {
      values: weight,
      avgSeries: avg,
      first: knownAvg[0] ?? null,
      last: knownAvg[knownAvg.length - 1] ?? null,
      delta: knownAvg.length >= 2 ? knownAvg[knownAvg.length - 1] - knownAvg[0] : null,
      min: minOf(weight),
      max: maxOf(weight),
      measured: countKnown(weight),
    },

    sleep: {
      avg: mean(sleep),
      min: minOf(sleep),
      nightsShort: sleep.filter((h) => isNum(h) && h < SHORT_SLEEP_H).length,
      nights: countKnown(sleep),
    },

    readiness: {
      avg: mean(readiness),
      min: minOf(readiness),
      lowDays: readiness.filter((r) => isNum(r) && r < LOW_READINESS).length,
      days: countKnown(readiness),
      values: readiness,
    },

    soreness: { avg: mean(soreness), max: maxOf(soreness) },

    nutrition: {
      kcalAvg: mean(kcal),
      proteinAvg: mean(protein),
      targetKcalAvg: targetKcalCount ? targetKcalSum / targetKcalCount : null,
      kcalHits,
      kcalCompared,
      kcalHitRate: kcalCompared ? kcalHits / kcalCompared : null,
      proteinHits,
      proteinCompared,
      proteinHitRate: proteinCompared ? proteinHits / proteinCompared : null,
    },

    training: {
      sessionCount: sessions.length,
      sets: totalSets(sessions),
      tonnage: tonnage(sessions),
      volume: sessions.length ? setsPerMuscle(sessions) : emptyVolume(),
    },

    football: {
      matches: dayTypes.filter((t) => t === 'match').length,
      teamSessions: dayTypes.filter((t) => t === 'team').length,
    },

    insights: {
      sleepVsReadiness: groupDifference(
        sleep.map((h, i) => [h, readiness[i]]),
        (h) => h < SHORT_SLEEP_H
      ),
    },
  };
}

/** Kennzahlen der Woche, in der dieser Tag liegt. */
export function weekSummary(state, anyDayKey) {
  const keys = weekKeys(anyDayKey);
  return summarize(state, keys, { kind: 'week', weekStart: weekStartKey(anyDayKey) });
}

/** Kennzahlen der Vorwoche. */
export function previousWeekSummary(state, anyDayKey) {
  return weekSummary(state, addDays(weekStartKey(anyDayKey), -7));
}

/** Kennzahlen eines Kalendermonats. */
export function monthSummary(state, mk) {
  return summarize(state, monthDays(mk), { kind: 'month', month: mk });
}

/**
 * Die letzten n Tage bis einschließlich `endKey`.
 * Für Trends, die nicht an Wochengrenzen hängen sollen.
 */
export function lastDays(endKey, n) {
  parseKey(endKey);
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`n muss mindestens 1 sein, war: ${n}`);
  }
  return Array.from({ length: n }, (_, i) => addDays(endKey, i - n + 1));
}

/**
 * Alle Tage, die im Zustand tatsächlich Daten tragen — aufsteigend.
 * Der Monat des Zustands begrenzt das nicht: nach einem Import können auch
 * ältere Tage vorhanden sein.
 */
export function loggedKeys(state) {
  return Object.keys(state.days ?? {})
    .filter((key) => {
      const d = state.days[key];
      return isNum(d?.weightKg)
        || isNum(d?.readiness)
        || (d?.sessions ?? []).some(hasLoggedSets)
        || isNum(d?.nutrition?.kcal);
    })
    .sort();
}

/** Vergleich zweier Zeiträume — für "gegenüber der Vorwoche". */
export function compare(current, previous) {
  const diff = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
  return {
    readiness: diff(current.readiness.avg, previous.readiness.avg),
    sleep: diff(current.sleep.avg, previous.sleep.avg),
    sets: diff(current.training.sets, previous.training.sets),
    tonnage: diff(current.training.tonnage, previous.training.tonnage),
    kcal: diff(current.nutrition.kcalAvg, previous.nutrition.kcalAvg),
    protein: diff(current.nutrition.proteinAvg, previous.nutrition.proteinAvg),
    weight: diff(current.weight.last, previous.weight.last),
    volume: Object.fromEntries(
      Object.keys(current.training.volume).map((key) => [
        key,
        current.training.volume[key] - (previous.training.volume[key] ?? 0),
      ])
    ),
  };
}
