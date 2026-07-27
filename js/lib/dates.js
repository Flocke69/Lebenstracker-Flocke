/* Datumsrechnung.
 *
 * Zwei Fallen, um die sich diese Datei kümmert:
 *
 * 1. ZEITZONE. `new Date('2026-07-27')` wird als UTC-Mitternacht gelesen und
 *    rutscht in westlichen Zeitzonen auf den 26. Alle Schlüssel hier werden
 *    deshalb über `new Date(jahr, monat, tag)` als LOKALES Datum gebaut.
 *
 * 2. SOMMERZEIT. Abstände zwischen Tagen dürfen nicht in Millisekunden
 *    gerechnet werden — an Umstellungstagen hat der Tag 23 oder 25 Stunden.
 *    `daysBetween` normalisiert deshalb vorher auf UTC-Mitternacht.
 *
 * Ein Tagesschlüssel ist immer 'YYYY-MM-DD', ein Monatsschlüssel 'YYYY-MM'.
 * Ungültige Eingaben werfen, statt still ein falsches Datum zu liefern.
 */

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86400000;

/** Wochentagsnamen, Index nach JS-Konvention (0 = Sonntag). */
export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_LONG = [
  'Sonntag', 'Montag', 'Dienstag', 'Mittwoch',
  'Donnerstag', 'Freitag', 'Samstag',
];
export const MONTHS_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const pad = (n, len = 2) => String(n).padStart(len, '0');

/* ─── Umwandlung ─────────────────────────────────────────────────────────── */

/** Date → 'YYYY-MM-DD', in lokaler Zeit. */
export function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`dateKey erwartet ein gültiges Date, erhielt: ${date}`);
  }
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM-DD' → lokales Date um Mitternacht. Wirft bei Unsinn. */
export function parseKey(key) {
  if (typeof key !== 'string') {
    throw new TypeError(`Datumsschlüssel muss ein String sein, war: ${key}`);
  }
  const m = DAY_KEY.exec(key);
  if (!m) {
    throw new RangeError(`Datumsschlüssel muss YYYY-MM-DD sein, war: "${key}"`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) {
    throw new RangeError(`Monat außerhalb 1–12: "${key}"`);
  }
  const date = new Date(year, month - 1, day);
  // Fängt Tage ab, die es nicht gibt: der 30.02. würde sonst zum 02.03.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new RangeError(`Dieses Datum existiert nicht: "${key}"`);
  }
  return date;
}

/** Tagesschlüssel oder Date → Monatsschlüssel 'YYYY-MM'. */
export function monthKey(keyOrDate) {
  if (keyOrDate instanceof Date) return dateKey(keyOrDate).slice(0, 7);
  parseKey(keyOrDate); // validieren, nicht nur abschneiden
  return keyOrDate.slice(0, 7);
}

/** Heute als Tagesschlüssel, lokale Zeit. */
export function todayKey() {
  return dateKey(new Date());
}

/* ─── Rechnen ────────────────────────────────────────────────────────────── */

/** Tagesschlüssel um n Tage verschieben. n darf negativ sein. */
export function addDays(key, n) {
  if (!Number.isInteger(n)) {
    throw new TypeError(`addDays erwartet eine ganze Zahl, erhielt: ${n}`);
  }
  const d = parseKey(key);
  // Über den Date-Konstruktor, nicht über Millisekunden: der Konstruktor
  // normalisiert Monats- und Jahresüberläufe und ist sommerzeitfest.
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Auf UTC-Mitternacht normalisieren, damit Sommerzeit nichts verfälscht. */
function utcMidnight(key) {
  const d = parseKey(key);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Tage von a nach b. Positiv, wenn b später liegt. */
export function daysBetween(a, b) {
  return Math.round((utcMidnight(b) - utcMidnight(a)) / MS_PER_DAY);
}

/* ─── Wochen ─────────────────────────────────────────────────────────────── */

function assertWeekday(weekday) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError(`Wochentag muss 0–6 sein (0 = Sonntag), war: ${weekday}`);
  }
  return weekday;
}

/** Wochentag nach JS-Konvention: 0 = Sonntag, 1 = Montag, … 6 = Samstag. */
export function weekdayOf(key) {
  return parseKey(key).getDay();
}

/** Montag der Woche, in der dieser Tag liegt. */
export function weekStartKey(key) {
  // getDay() liefert 0 für Sonntag. (wd + 6) % 7 dreht das auf
  // Montag = 0 … Sonntag = 6, damit die Woche am Montag beginnt.
  const offset = (weekdayOf(key) + 6) % 7;
  return addDays(key, -offset);
}

/** Die 7 Tagesschlüssel der Woche, Montag bis Sonntag. */
export function weekKeys(key) {
  const start = weekStartKey(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * Tage BIS zum nächsten Auftreten dieses Wochentags. 0, wenn heute.
 *
 * Für Trainingsregeln ist das die Frage nach der Frische: wie viel Zeit
 * bleibt noch, um sich bis zum Spiel zu erholen.
 */
export function daysUntilWeekday(key, weekday) {
  assertWeekday(weekday);
  return (weekday - weekdayOf(key) + 7) % 7;
}

/**
 * Tage SEIT dem letzten Auftreten dieses Wochentags. 0, wenn heute.
 *
 * Die Gegenfrage: wie weit ist das Spiel her, also wie erholt bin ich
 * überhaupt schon wieder.
 */
export function daysSinceWeekday(key, weekday) {
  assertWeekday(weekday);
  return (weekdayOf(key) - weekday + 7) % 7;
}

/**
 * Kleinster Abstand zu diesem Wochentag, vorwärts oder rückwärts (0–3).
 *
 * NUR FÜR DIE ANZEIGE ("Spieltag ist in 3 Tagen"). Für Trainingsregeln ist
 * dieser Wert ungeeignet, weil er zwei verschiedene Dinge vermischt:
 *
 *   Vor dem Spiel zählt Frische   → daysUntilWeekday, Schwelle 3
 *   Nach dem Spiel zählt Erholung → daysSinceWeekday, Schwelle 2
 *
 * Mit einem gemeinsamen Wert bekämen Dienstag und Freitag bei einem
 * Sonntagsspiel denselben Abstand 2 — obwohl Dienstag 5 Tage VOR dem Spiel
 * liegt und Freitag nur 2. Siehe tests/dates.test.js.
 */
export function daysToNearestWeekday(key, weekday) {
  const forward = daysUntilWeekday(key, weekday);
  if (forward === 0) return 0;
  return Math.min(forward, 7 - forward);
}

/* ─── Monate ─────────────────────────────────────────────────────────────── */

function parseMonthKey(mk) {
  if (typeof mk !== 'string') {
    throw new TypeError(`Monatsschlüssel muss ein String sein, war: ${mk}`);
  }
  const m = MONTH_KEY.exec(mk);
  if (!m) {
    throw new RangeError(`Monatsschlüssel muss YYYY-MM sein, war: "${mk}"`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    throw new RangeError(`Monat außerhalb 1–12: "${mk}"`);
  }
  return { year, month };
}

/** Anzahl der Tage im Monat. */
export function daysInMonth(mk) {
  const { year, month } = parseMonthKey(mk);
  // Tag 0 des Folgemonats ist der letzte Tag dieses Monats.
  return new Date(year, month, 0).getDate();
}

/** Alle Tagesschlüssel des Monats, aufsteigend. */
export function monthDays(mk) {
  const { year, month } = parseMonthKey(mk);
  const n = daysInMonth(mk);
  return Array.from({ length: n }, (_, i) => dateKey(new Date(year, month - 1, i + 1)));
}

/** Liegen beide Tage im selben Kalendermonat? */
export function isSameMonth(a, b) {
  return monthKey(a) === monthKey(b);
}

/** Monatsschlüssel um n Monate verschieben. */
export function addMonths(mk, n) {
  if (!Number.isInteger(n)) {
    throw new TypeError(`addMonths erwartet eine ganze Zahl, erhielt: ${n}`);
  }
  const { year, month } = parseMonthKey(mk);
  const d = new Date(year, month - 1 + n, 1);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}`;
}

/* ─── Anzeige ────────────────────────────────────────────────────────────── */

/** 'Mo', 'Di', … für das Wochenband. */
export function weekdayShort(key) {
  return WEEKDAYS_SHORT[weekdayOf(key)];
}

/** '27.07.' — kurz, für Achsen und Listen. */
export function formatDayShort(key) {
  const d = parseKey(key);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

/** 'Montag, 27. Juli 2026' — für Überschriften. */
export function formatDayLong(key) {
  const d = parseKey(key);
  return `${WEEKDAYS_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** 'Juli 2026' — für Monatsabschluss und Archiv. */
export function formatMonth(mk) {
  const { year, month } = parseMonthKey(mk);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}
