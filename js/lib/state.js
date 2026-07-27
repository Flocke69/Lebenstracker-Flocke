/* Zustandsform, Migration und abgeleitete Werte.
 *
 * Reine Funktionen, kein localStorage — das liegt in js/store.js. Der Zustand
 * wird UNVERÄNDERLICH behandelt: jede Schreibfunktion gibt ein neues Objekt
 * zurück. Damit kann eine Ansicht alten und neuen Zustand vergleichen, und
 * ein Fehler beim Schreiben hinterlässt keinen halb geänderten Zustand.
 *
 * Grundhaltung bei fehlenden Werten: `null`, nie `0`. Ein Gewicht von 0 kg
 * wäre ein Messwert, kein fehlender Wert — und würde jeden Durchschnitt
 * verfälschen.
 */

import {
  daysInMonth,
  parseKey,
  weekdayOf,
  monthKey as toMonthKey,
} from './dates.js';
import { DAY_TYPES, DEFAULT_FACTORS, DEFAULT_PROTEIN_PER_KG, DEFAULT_FAT_PER_KG }
  from './energy.js';

export const SCHEMA_VERSION = 1;

/** Felder, ohne die die App nicht rechnen kann. */
export const REQUIRED_PROFILE_FIELDS = Object.freeze([
  'sex',            // Mifflin-St Jeor
  'birthYear',      // Mifflin-St Jeor
  'heightCm',       // Mifflin-St Jeor
  'startWeightKg',  // Startwert, bis der erste Wiegetag da ist
  'matchDayWeekday',// die Woche wird um den Spieltag gebaut
]);

/* ─── Prüfhelfer ─────────────────────────────────────────────────────────── */

function assertNumber(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} muss eine endliche Zahl sein, war: ${value}`);
  }
  if (value < min || value > max) {
    throw new RangeError(`${name} liegt außerhalb ${min}–${max}: ${value}`);
  }
  return value;
}

function assertWeekday(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new RangeError(`${name} muss 0–6 sein (0 = Sonntag), war: ${value}`);
  }
  return value;
}

function assertWeekdayList(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} muss ein Array von Wochentagen sein, war: ${value}`);
  }
  value.forEach((d, i) => assertWeekday(d, `${name}[${i}]`));
  return [...new Set(value)].sort((a, b) => a - b);
}

const isPlainObject = (v) =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/* ─── Leere Formen ───────────────────────────────────────────────────────── */

export function emptyDay() {
  return {
    checkin: null,     // { sleepHours, sleepQuality, mood, energy, soreness, stress, note }
    weightKg: null,
    readiness: null,
    nutrition: null,   // { kcal, proteinG, carbsG, fatG }
    dayType: null,     // null = aus dem Profil ableiten
    sessions: [],
  };
}

export function emptyState(currentMonth) {
  daysInMonth(currentMonth); // wirft bei ungültigem Monatsschlüssel
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: null,
    currentMonth,
    days: {},
    months: [],
    plan: null,
    lastExportAt: null,
  };
}

/* ─── Migration ──────────────────────────────────────────────────────────── */

/**
 * Gespeicherten Zustand in die aktuelle Form bringen.
 *
 * Unbrauchbare Eingaben ergeben einen frischen Zustand — besser ein leerer
 * Start als ein Absturz beim App-Start. Eine NEUERE Schemaversion wirft
 * dagegen bewusst: dann hat eine spätere App-Version geschrieben, und die
 * ältere darf die Daten nicht überschreiben.
 */
export function migrate(raw, fallbackMonth) {
  const fresh = emptyState(fallbackMonth);
  if (!isPlainObject(raw)) return fresh;

  const version = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Gespeicherte Daten haben Schemaversion ${version}, diese App-Version ` +
      `kennt nur ${SCHEMA_VERSION}. Bitte die App neu laden — die Daten ` +
      `bleiben unangetastet.`
    );
  }

  // Künftige Schemaschritte kommen hier hin:
  //   if (version < 2) { ...raw = upgradeTo2(raw) }

  const days = isPlainObject(raw.days) ? raw.days : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: isPlainObject(raw.profile) ? raw.profile : null,
    currentMonth: typeof raw.currentMonth === 'string' ? raw.currentMonth : fresh.currentMonth,
    days: Object.fromEntries(
      Object.entries(days).map(([k, v]) => [k, { ...emptyDay(), ...(isPlainObject(v) ? v : {}) }])
    ),
    months: Array.isArray(raw.months) ? raw.months : [],
    plan: raw.plan ?? null,
    lastExportAt: typeof raw.lastExportAt === 'string' ? raw.lastExportAt : null,
  };
}

/* ─── Tage ───────────────────────────────────────────────────────────────── */

/** Tag lesen. Unbekannte Tage kommen als leerer Tag zurück, nicht als undefined. */
export function getDay(state, key) {
  parseKey(key);
  return { ...emptyDay(), ...(state.days?.[key] ?? {}) };
}

function validateDayPatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError(`Tages-Patch muss ein Objekt sein, war: ${patch}`);
  }
  if ('weightKg' in patch && patch.weightKg !== null) {
    assertNumber(patch.weightKg, 'weightKg', 20, 400);
  }
  if ('readiness' in patch && patch.readiness !== null) {
    assertNumber(patch.readiness, 'readiness', 0, 100);
  }
  if ('dayType' in patch && patch.dayType !== null && !DAY_TYPES.includes(patch.dayType)) {
    throw new RangeError(
      `Unbekannter Tagestyp "${patch.dayType}". Erlaubt: ${DAY_TYPES.join(', ')}`
    );
  }
  if ('sessions' in patch && !Array.isArray(patch.sessions)) {
    throw new TypeError(`sessions muss ein Array sein, war: ${patch.sessions}`);
  }
  return patch;
}

/**
 * Tag schreiben. Führt zusammen statt zu ersetzen, eine Ebene tief auch für
 * `checkin` und `nutrition` — sonst würde ein Teil-Update („nur die Stimmung")
 * den Rest des Check-ins löschen.
 */
export function withDay(state, key, patch) {
  parseKey(key);
  validateDayPatch(patch);

  const current = getDay(state, key);
  const next = { ...current, ...patch };

  for (const nested of ['checkin', 'nutrition']) {
    if (isPlainObject(patch[nested])) {
      next[nested] = { ...(current[nested] ?? {}), ...patch[nested] };
    }
  }

  return { ...state, days: { ...state.days, [key]: next } };
}

/* ─── Profil ─────────────────────────────────────────────────────────────── */

/** Profil prüfen und mit Standardwerten auffüllen. */
export function normalizeProfile(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError(`Profil muss ein Objekt sein, war: ${patch}`);
  }

  const p = { ...patch };

  if (typeof p.sex !== 'string' || !['m', 'w'].includes(p.sex)) {
    throw new RangeError(`sex muss 'm' oder 'w' sein, war: ${p.sex}`);
  }
  assertNumber(p.birthYear, 'birthYear', 1920, new Date().getFullYear() - 10);
  assertNumber(p.heightCm, 'heightCm', 100, 250);
  assertNumber(p.startWeightKg, 'startWeightKg', 20, 400);
  assertWeekday(p.matchDayWeekday, 'matchDayWeekday');

  p.teamTrainingWeekdays = assertWeekdayList(
    p.teamTrainingWeekdays ?? [], 'teamTrainingWeekdays'
  );
  p.gymWeekdays = assertWeekdayList(p.gymWeekdays ?? [], 'gymWeekdays');

  // Ein Gym-Tag am Spieltag wäre ein Widerspruch in sich: die App würde dort
  // gleichzeitig eine Einheit einplanen und jedes Beinvolumen sperren.
  if (p.gymWeekdays.includes(p.matchDayWeekday)) {
    throw new RangeError(
      'Der Spieltag kann kein Gym-Tag sein. Am Spieltag gehören die Beine ' +
      'dem Spiel.'
    );
  }

  p.proteinPerKg = assertNumber(
    p.proteinPerKg ?? DEFAULT_PROTEIN_PER_KG, 'proteinPerKg', 0.5, 5
  );
  p.fatPerKg = assertNumber(p.fatPerKg ?? DEFAULT_FAT_PER_KG, 'fatPerKg', 0.3, 3);
  p.kcalOffset = assertNumber(p.kcalOffset ?? 0, 'kcalOffset', -1500, 1500);

  p.activityFactors = { ...DEFAULT_FACTORS, ...(p.activityFactors ?? {}) };
  for (const type of DAY_TYPES) {
    assertNumber(p.activityFactors[type], `activityFactors.${type}`, 1, 3);
  }

  return p;
}

/** Profil schreiben. Führt mit dem bestehenden Profil zusammen. */
export function withProfile(state, patch) {
  const merged = { ...(state.profile ?? {}), ...patch };
  return { ...state, profile: normalizeProfile(merged) };
}

/**
 * Welche Pflichtfelder fehlen noch?
 *
 * Prüft nur Anwesenheit und wirft nie — das Onboarding braucht diese Antwort
 * auch für halb gefüllte Formulare.
 */
export function missingProfileFields(profile) {
  if (!isPlainObject(profile)) return [...REQUIRED_PROFILE_FIELDS];
  return REQUIRED_PROFILE_FIELDS.filter(
    (f) => profile[f] === undefined || profile[f] === null || profile[f] === ''
  );
}

/** Kann die App rechnen? */
export function isProfileComplete(profile) {
  return missingProfileFields(profile).length === 0;
}

/* ─── Abgeleitete Werte ──────────────────────────────────────────────────── */

/**
 * Maßgebliches Gewicht an einem Tag.
 *
 * Es wird nicht jeden Tag gewogen, die Makros brauchen aber jeden Tag ein
 * Gewicht. Reihenfolge: eigener Messwert → letzter Messwert davor →
 * Startgewicht aus dem Profil. Messwerte aus der Zukunft werden ignoriert,
 * sonst würde ein nachträglich eingetragener Tag die Vergangenheit verändern.
 */
export function weightOn(state, key) {
  parseKey(key);
  const measured = Object.keys(state.days ?? {})
    .filter((k) => k <= key && typeof state.days[k]?.weightKg === 'number')
    .sort();
  if (measured.length > 0) return state.days[measured[measured.length - 1]].weightKg;
  return state.profile?.startWeightKg ?? null;
}

/**
 * Tagestyp: von Hand gesetzt, sonst aus dem Profil abgeleitet.
 *
 * Rangfolge bei der Ableitung: Spieltag > Mannschaftstraining > Gym > Ruhetag.
 * Der Spieltag gewinnt, weil er die höchste Belastung trägt.
 */
export function dayTypeFor(state, key) {
  const day = getDay(state, key);
  if (day.dayType) return day.dayType;

  const p = state.profile;
  if (!p) return 'rest';

  const weekday = weekdayOf(key);
  if (weekday === p.matchDayWeekday) return 'match';
  if ((p.teamTrainingWeekdays ?? []).includes(weekday)) return 'team';
  if ((p.gymWeekdays ?? []).includes(weekday)) return 'gym';
  return 'rest';
}

/** Alle Tagesschlüssel des laufenden Monats, die tatsächlich Daten tragen. */
export function loggedDayKeys(state) {
  const month = state.currentMonth;
  return Object.keys(state.days ?? {})
    .filter((k) => toMonthKey(k) === month)
    .sort();
}
