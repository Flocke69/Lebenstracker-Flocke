/* Der Yazio-Wochenschnitt gegen das Wochenziel.
 *
 * Flocke trägt seine Makros nicht hier ein, sondern in Yazio. Was er
 * herbringt, ist der WOCHENDURCHSCHNITT — vier Zahlen, einmal pro Woche.
 * Diese Datei beantwortet damit die einzige Frage, auf die es ankommt: passt
 * das zum Ziel, und wenn nicht, um wie viel muss es sich ändern.
 *
 * Warum der Wochenschnitt und nicht der Tageswert: an Spieltagen isst man
 * mehr, an Ruhetagen weniger, und ein einzelner Tag sagt über beides nichts.
 * Das Ziel der App ist ohnehin periodisiert — verglichen wird deshalb der
 * Wochenschnitt des Ziels gegen den Wochenschnitt der Wirklichkeit.
 *
 * DIE APP ÄNDERT NICHTS VON ALLEIN. Sie rechnet den Vorschlag und begründet
 * ihn; das Kalorienziel im Profil bleibt eine bestätigte Entscheidung.
 *
 * Kein DOM, keine Rundung. Geprüft in tests/weekly.test.js.
 */

import { weekKeys, weekStartKey, addDays, weekdayOf, formatDayShort, todayKey }
  from './dates.js';
import { getDay, weightOn, dayTypeFor, getWeekMacros, firstTrackedDay } from './state.js';
import { dayTargets, ageOn, DRIFT_THRESHOLD_KG, KCAL_ADJUST_STEP } from './energy.js';
import { mean, movingAverage, series, WEIGHT_WINDOW } from './aggregate.js';

/** Innerhalb dieser Spanne um das Ziel gilt der Wochenschnitt als getroffen. */
export const KCAL_TOLERANCE = 0.05;      // ±5 % — auf die Woche gerechnet eng
/** Protein gilt ab diesem Anteil des Ziels als erfüllt, nach oben offen. */
export const PROTEIN_FLOOR = 0.9;
/** Fett darf nicht unter diesen Anteil fallen — Hormonhaushalt. */
export const FAT_FLOOR = 0.8;

/** Die vier Felder in Anzeigereihenfolge. */
export const WEEK_FIELDS = Object.freeze([
  { key: 'kcal', target: 'kcal', label: 'Kalorien', unit: 'kcal', rule: 'band' },
  { key: 'proteinG', target: 'proteinG', label: 'Protein', unit: 'g', rule: 'floor' },
  { key: 'carbsG', target: 'carbsG', label: 'Kohlenhydrate', unit: 'g', rule: 'band' },
  { key: 'fatG', target: 'fatG', label: 'Fett', unit: 'g', rule: 'fatFloor' },
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ─── Wochenziel ─────────────────────────────────────────────────────────── */

/**
 * Der Ziel-Wochenschnitt: Mittel der sieben Tagesziele.
 *
 * Nicht das Ziel eines Durchschnittstags — die Tagestypen der konkreten Woche
 * gehen ein. Eine Woche mit zwei Spielen hat ein anderes Wochenziel als eine
 * ohne.
 */
export function weekTargetAverage(state, anyDayKey) {
  const p = state?.profile;
  if (!p) return null;

  const perDay = weekKeys(anyDayKey).map((key) => {
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
  }).filter(Boolean);

  if (perDay.length === 0) return null;

  return {
    days: perDay.length,
    kcal: mean(perDay.map((t) => t.kcal)),
    proteinG: mean(perDay.map((t) => t.proteinG)),
    carbsG: mean(perDay.map((t) => t.carbsG)),
    fatG: mean(perDay.map((t) => t.fatG)),
  };
}

/* ─── Urteil je Makro ────────────────────────────────────────────────────── */

/**
 * Ein Feld bewerten: `good`, `ok` oder `bad`, plus ein Wort dazu.
 *
 * Drei Regeln, weil die drei Makros unterschiedlich funktionieren:
 *   band     — beidseitig, ein Band um das Ziel (Kalorien, Kohlenhydrate)
 *   floor     — nur nach unten begrenzt (Protein)
 *   fatFloor  — wie floor, aber mit eigener Schwelle (Fett)
 */
export function judgeField(field, actual, target) {
  if (!isNum(actual) || !isNum(target) || target <= 0) {
    return { tone: 'idle', word: 'nichts eingetragen', ratio: null, delta: null };
  }

  const ratio = actual / target;
  const delta = actual - target;

  if (field.rule === 'floor' || field.rule === 'fatFloor') {
    const floor = field.rule === 'floor' ? PROTEIN_FLOOR : FAT_FLOOR;
    if (ratio >= floor) return { tone: 'good', word: 'erreicht', ratio, delta };
    if (ratio >= floor - 0.1) return { tone: 'ok', word: 'knapp drunter', ratio, delta };
    return { tone: 'bad', word: 'zu wenig', ratio, delta };
  }

  const inside = Math.abs(ratio - 1) <= KCAL_TOLERANCE;
  if (inside) return { tone: 'good', word: 'im Ziel', ratio, delta };
  const near = Math.abs(ratio - 1) <= KCAL_TOLERANCE * 2;
  return {
    tone: near ? 'ok' : 'bad',
    word: delta > 0 ? 'zu viel' : 'zu wenig',
    ratio,
    delta,
  };
}

/* ─── Gewichtstrend der Woche ────────────────────────────────────────────── */

/**
 * Änderung des 7-Tage-Gewichtsschnitts über die letzten zwei Wochen.
 *
 * Zwei Wochen, weil eine einzelne zu kurz ist: der gleitende Schnitt braucht
 * selbst sieben Tage, bis er etwas aussagt. `null`, solange nicht genug
 * gewogen wurde — das ist eine ehrliche Antwort und keine 0.
 */
export function weightDrift(state, anyDayKey) {
  const end = weekKeys(anyDayKey)[6];
  const keys = Array.from({ length: 21 }, (_, i) => addDays(end, i - 20));
  const avg = movingAverage(series(state, keys, (d) => d.weightKg), WEIGHT_WINDOW);

  // Der Schnitt von heute gegen den von vor 14 Tagen.
  const last = avg[avg.length - 1];
  const before = avg[avg.length - 15];
  if (!isNum(last) || !isNum(before)) {
    const measured = keys.filter((k) => isNum(getDay(state, k).weightKg)).length;
    return { deltaKg: null, from: null, to: last ?? null, measured };
  }
  return { deltaKg: last - before, from: before, to: last, measured: 21 };
}

/* ─── Zusammenführung ────────────────────────────────────────────────────── */

/**
 * Kalorienvorschlag aus Wochenschnitt UND Gewichtstrend.
 *
 * Die Reihenfolge ist wichtig und bewusst so:
 *
 *   1. Wurde das Ziel überhaupt getroffen? Wenn nicht, ist der Gewichtstrend
 *      kein Argument fürs Ziel — er sagt nur, dass etwas anderes gegessen
 *      wurde. Dann lautet der Vorschlag: erst das Ziel treffen.
 *   2. Erst wenn das Ziel steht und das Gewicht trotzdem wegläuft, wird am
 *      Ziel gedreht.
 *
 * Ohne diese Reihenfolge korrigiert die App eine Zahl, die nie erreicht wurde —
 * und jagt sich selbst.
 */
export function suggestFromWeek({ kcalJudgement, drift, currentOffset = 0 }) {
  const hitTarget = kcalJudgement?.tone === 'good';

  if (kcalJudgement?.tone === 'idle') {
    return {
      change: 0,
      newOffset: currentOffset,
      tone: 'idle',
      reason: 'Ohne Wochenschnitt gibt es nichts zu vergleichen. Trag die vier '
            + 'Zahlen aus Yazio ein.',
    };
  }

  if (!hitTarget) {
    const richtung = kcalJudgement.delta > 0 ? 'über' : 'unter';
    return {
      change: 0,
      newOffset: currentOffset,
      tone: kcalJudgement.tone,
      reason: `Der Wochenschnitt lag ${Math.abs(Math.round(kcalJudgement.delta))} kcal `
            + `${richtung} dem Ziel. Am Ziel wird deshalb nichts geändert — erst `
            + 'treffen, dann anpassen. Sonst korrigiert die App eine Zahl, die '
            + 'nie erreicht wurde.',
    };
  }

  if (!isNum(drift?.deltaKg)) {
    return {
      change: 0,
      newOffset: currentOffset,
      tone: 'good',
      reason: 'Ziel getroffen. Für eine Anpassung fehlt noch der Gewichtstrend — '
            + 'dafür braucht es rund drei Wochen täglichen Wiegens.',
    };
  }

  if (Math.abs(drift.deltaKg) <= DRIFT_THRESHOLD_KG) {
    return {
      change: 0,
      newOffset: currentOffset,
      tone: 'good',
      reason: `Ziel getroffen und das Gewicht steht (${drift.deltaKg >= 0 ? '+' : ''}`
            + `${drift.deltaKg.toFixed(1)} kg über zwei Wochen). Nichts ändern.`,
    };
  }

  const change = drift.deltaKg > 0 ? -KCAL_ADJUST_STEP : KCAL_ADJUST_STEP;
  return {
    change,
    newOffset: currentOffset + change,
    tone: 'ok',
    reason: `Ziel getroffen, aber der Gewichtsschnitt ist über zwei Wochen um `
          + `${Math.abs(drift.deltaKg).toFixed(1)} kg `
          + `${drift.deltaKg > 0 ? 'gestiegen' : 'gefallen'}. Vorschlag: `
          + `${change > 0 ? '+' : ''}${change} kcal pro Tag.`,
  };
}

/**
 * Alles zu einer Woche an einem Stück — für die Ansicht und für das Review.
 *
 * @returns {{weekStart, target, actual, fields, drift, suggestion, hasEntry}}
 */
export function weekCheck(state, anyDayKey) {
  const weekStart = weekStartKey(anyDayKey);
  const target = weekTargetAverage(state, weekStart);
  const actual = getWeekMacros(state, weekStart);

  const fields = WEEK_FIELDS.map((field) => ({
    field,
    actual: actual[field.key],
    target: target?.[field.target] ?? null,
    ...judgeField(field, actual[field.key], target?.[field.target] ?? null),
  }));

  const drift = weightDrift(state, weekStart);
  const suggestion = suggestFromWeek({
    kcalJudgement: fields[0],
    drift,
    currentOffset: state?.profile?.kcalOffset ?? 0,
  });

  return {
    weekStart,
    target,
    actual,
    fields,
    drift,
    suggestion,
    hasEntry: WEEK_FIELDS.some((f) => isNum(actual[f.key])),
  };
}

/* ─── Erinnerung: der Wochenschnitt fehlt noch ───────────────────────────── */

/** Steht für diese Woche überhaupt eine Zahl in der App? */
export function hasWeekEntry(state, weekStart) {
  const macros = getWeekMacros(state, weekStart);
  return WEEK_FIELDS.some((f) => isNum(macros[f.key]));
}

/**
 * Bis wann nach dem Wochenende gilt der Wochenschnitt noch als nachtragbar.
 * Mittwoch ist die Grenze: danach ist die neue Woche schon halb vorbei.
 */
const ENTRY_GRACE_WEEKDAY = 3;

/**
 * Fehlt der Yazio-Wochenschnitt?
 *
 * Der Sonntagabend ist der Moment: die Woche ist zu Ende, Yazio hat ihren
 * Schnitt, und ohne diese vier Zahlen kann die App über das Essen NICHTS
 * sagen — weder im Wochen- noch im Monats-Review. Deshalb ist das die einzige
 * wiederkehrende Eingabe, an die die App von sich aus erinnert.
 *
 * Zwei Fälle, wie beim Monats-Review:
 *
 *   SONNTAG — die laufende Woche endet heute. Der richtige Moment.
 *   MONTAG BIS MITTWOCH — die Woche davor fehlt noch. Wer am Sonntag keine
 *   Zeit hatte, soll nicht durchs Raster fallen. Ab Donnerstag ist Schluss:
 *   eine Erinnerung, die eine ganze Woche steht, wird zu Tapete.
 *
 * `today` ist ein Parameter, damit die Regel ohne Kalender prüfbar bleibt.
 *
 * @returns {{due: boolean, weekStart: string|null, kind: string, text: string}}
 */
export function weekEntryDue(state, today = todayKey()) {
  /* Eine leere App fragt nach nichts. `firstTrackedDay` fällt ohne Daten auf
     den Monatsersten zurück — damit läge die Vorwoche formal im erlaubten
     Bereich, und eine frisch eingerichtete App würde am Montag sofort nach
     einer Woche fragen, die es für sie nie gab. */
  if (Object.keys(state?.days ?? {}).length === 0) {
    return { due: false, weekStart: null, kind: 'none', text: '' };
  }

  const floor = firstTrackedDay(state, today);
  const weekday = weekdayOf(today);
  const thisWeek = weekStartKey(today);

  if (weekday === 0 && thisWeek >= floor && !hasWeekEntry(state, thisWeek)) {
    return {
      due: true,
      weekStart: thisWeek,
      kind: 'today',
      text: 'Die Woche ist zu Ende. Hol dir den Wochenschnitt aus Yazio — '
        + 'ohne die vier Zahlen kann ich über dein Essen nichts sagen.',
    };
  }

  const previous = addDays(thisWeek, -7);
  if (weekday >= 1 && weekday <= ENTRY_GRACE_WEEKDAY
      && previous >= floor && !hasWeekEntry(state, previous)) {
    return {
      due: true,
      weekStart: previous,
      kind: 'overdue',
      text: `Für die Woche ab ${formatDayShort(previous)} fehlt der `
        + 'Wochenschnitt aus Yazio. Solange er fehlt, hat die Woche kein Essen.',
    };
  }

  return { due: false, weekStart: null, kind: 'none', text: '' };
}

/**
 * Die letzten n Wochen, älteste zuerst.
 *
 * Wochen, die VOR dem ersten erfassten Monat beginnen, fallen weg. Ohne diese
 * Grenze standen in der Tabelle Zeilen wie „Woche ab 22.06. — — — —" für einen
 * Monat, den es in der App nicht mehr gibt. Eine leere Zeile aus einer Zeit
 * ohne Daten liest man als Lücke, nicht als Nichtexistenz.
 *
 * `today` ist ein Parameter, damit die Grenze testbar bleibt.
 */
export function weekHistory(state, anyDayKey, count = 6, today = anyDayKey) {
  const start = weekStartKey(anyDayKey);
  const floor = firstTrackedDay(state, today);

  return Array.from({ length: count }, (_, i) => addDays(start, (i - count + 1) * 7))
    .filter((weekStart) => weekStart >= floor)
    .map((weekStart) => ({ weekStart, macros: getWeekMacros(state, weekStart) }));
}
