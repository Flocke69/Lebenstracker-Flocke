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

/* Version 2 bringt vier Dinge dazu:
 *
 *   state.schedule   verschobene Trainingstage  { 'YYYY-MM-DD': planId | 'none' }
 *   state.weeks      Yazio-Wochenschnitt        { 'YYYY-MM-DD' (Montag): {…} }
 *   state.reviews    gespeicherte Monats-Reviews
 *   sessions[].startedAt / endedAt   Trainingsdauer
 *
 * Die Migration von 1 legt die Behälter leer an. Nichts wird umgeschrieben:
 * ein v1-Zustand ist ein v2-Zustand ohne diese vier Angaben.
 */
export const SCHEMA_VERSION = 2;

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
    /** Verschobene Trainingstage: Tagesschlüssel → Plan-Kennung oder 'none'. */
    schedule: {},
    /** Yazio-Wochenschnitt: Montagsschlüssel → { kcal, proteinG, carbsG, fatG }. */
    weeks: {},
    /** Abgeschlossene Monats-Reviews samt Antworten. */
    reviews: [],
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

  /* Schritt 1 → 2: nichts umschreiben, nur die neuen Behälter anlegen. Das
     passiert unten durch `?? {}` bzw. `?? []` ganz von allein — ein
     v1-Zustand ist ein v2-Zustand ohne Verschiebungen, Wochenschnitte und
     Reviews. Deshalb steht hier kein eigener Migrationsschritt.
     Künftige Schritte, die Daten tatsächlich umformen, kommen hier hin. */

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
    schedule: isPlainObject(raw.schedule) ? raw.schedule : {},
    weeks: isPlainObject(raw.weeks) ? raw.weeks : {},
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
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
  if (isPlainObject(patch.nutrition)) {
    const limits = { kcal: 8000, proteinG: 600, carbsG: 1200, fatG: 400 };
    for (const [field, max] of Object.entries(limits)) {
      const value = patch.nutrition[field];
      if (value !== null && value !== undefined) {
        assertNumber(value, `nutrition.${field}`, 0, max);
      }
    }
  }
  return patch;
}

/** Kalorien aus den Makros, für Plausibilitätshinweise. */
export function kcalFromMacros(nutrition) {
  if (!isPlainObject(nutrition)) return null;
  const { proteinG, carbsG, fatG } = nutrition;
  if ([proteinG, carbsG, fatG].some((v) => typeof v !== 'number')) return null;
  return proteinG * 4 + carbsG * 4 + fatG * 9;
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

/* ─── Trainingseinheiten ─────────────────────────────────────────────────── */

/** Leere Einheit. `startedAt`/`endedAt` tragen die Trainingsdauer,
 *  `lastSetAt` den Zeitpunkt des letzten geloggten Satzes,
 *  `skipped` die beim Abschließen ausgelassenen Übungen. */
export function emptySession(planId) {
  return {
    planId, exercises: [], sessionRpe: null,
    startedAt: null, endedAt: null, lastSetAt: null, skipped: [],
  };
}

/** Geloggte Einheit zu einer Plan-Kennung, oder null. */
export function getSession(state, dayKey, planId) {
  return getDay(state, dayKey).sessions.find((s) => s.planId === planId) ?? null;
}

/** Trägt diese Einheit mindestens einen geloggten Satz? */
export function hasLoggedSets(session) {
  return (session?.exercises ?? []).some((e) => (e.sets ?? []).some(Boolean));
}

/**
 * Die Übungen, die in DIESER Einheit ausgelassen wurden.
 *
 * Beim Abschließen fragt das Trainingsfenster nach, wenn geplante Übungen
 * ohne einen einzigen Satz dastehen. Wer bestätigt, lässt sie entfallen —
 * die Einheit ist damit vollständig und nicht halb abgebrochen.
 *
 * SELBSTHEILEND: sobald für eine ausgelassene Übung doch ein Satz im Log
 * steht, ist sie keine ausgelassene mehr. Das spart den zweiten
 * Schreibvorgang und kann gar nicht erst auseinanderlaufen — der Satz ist
 * die stärkere Aussage.
 */
export function skippedExercises(session) {
  const logged = new Set(
    (session?.exercises ?? [])
      .filter((e) => (e.sets ?? []).some(Boolean))
      .map((e) => e.exId)
  );
  return (session?.skipped ?? []).filter((id) => !logged.has(id));
}

/**
 * Eine Einheit komplett entfernen.
 *
 * Für die leeren Hüllen, die der Startknopf anlegt: wer ein Training öffnet
 * und ohne einen Satz wieder beendet, hat nicht trainiert — und eine Einheit
 * ohne Sätze würde in Reviews und Archiv trotzdem als Trainingstag zählen.
 */
export function withoutSession(state, dayKey, planId) {
  const day = getDay(state, dayKey);
  const sessions = day.sessions.filter((s) => s.planId !== planId);
  if (sessions.length === day.sessions.length) return state;
  return withDay(state, dayKey, { sessions });
}

/**
 * Angaben an einer Einheit ändern, ohne die Sätze anzufassen.
 *
 * Wird für Start und Ende des Trainings gebraucht. Die Einheit wird angelegt,
 * wenn es sie noch nicht gibt — "Training starten" ist der erste Schreibvorgang
 * des Tages, da existiert noch kein Satz.
 */
export function withSessionMeta(state, dayKey, planId, patch) {
  parseKey(dayKey);
  if (!isPlainObject(patch)) {
    throw new TypeError(`Einheiten-Patch muss ein Objekt sein, war: ${patch}`);
  }
  for (const field of ['startedAt', 'endedAt', 'lastSetAt']) {
    const value = patch[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
      throw new TypeError(`${field} muss ein gültiger Zeitstempel sein, war: ${value}`);
    }
  }
  if ('sessionRpe' in patch && patch.sessionRpe !== null) {
    assertNumber(patch.sessionRpe, 'sessionRpe', 1, 10);
  }
  if ('skipped' in patch) {
    if (!Array.isArray(patch.skipped) || patch.skipped.some((id) => typeof id !== 'string')) {
      throw new TypeError(
        `skipped muss eine Liste von Übungskennungen sein, war: ${patch.skipped}`
      );
    }
  }

  const day = getDay(state, dayKey);
  const sessions = [...day.sessions];
  const index = sessions.findIndex((s) => s.planId === planId);

  if (index === -1) sessions.push({ ...emptySession(planId), ...patch });
  else sessions[index] = { ...sessions[index], ...patch };

  return withDay(state, dayKey, { sessions });
}

/**
 * Trainingsdauer in Minuten, oder null.
 *
 * Läuft die Einheit noch, wird gegen `now` gerechnet — deshalb ist die Zeit
 * hier ein Parameter und kein `Date.now()` im Körper: sonst wäre die Funktion
 * nicht testbar.
 */
export function sessionMinutes(session, now = Date.now()) {
  const start = session?.startedAt ? new Date(session.startedAt).getTime() : null;
  if (start === null || Number.isNaN(start)) return null;
  const end = session.endedAt ? new Date(session.endedAt).getTime() : now;
  if (Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 60000);
}

/**
 * Vergessene Trainingsuhren schließen und leere Hüllen wegräumen.
 *
 * Das Wegwischen des Trainingsfensters beendet die Einheit NICHT — die Uhr
 * läuft weiter, damit „weiterführen" die echte Dauer behält. Der Preis: wer
 * nie auf „Training abschließen" tippt, hätte eine ewig laufende Uhr.
 * Deshalb räumt jeder App-Start auf:
 *
 *   Eine LAUFENDE Einheit eines vergangenen Tages wird geschlossen —
 *   rückwirkend auf den letzten geloggten Satz, den ehrlichsten bekannten
 *   Endpunkt. Ohne einen einzigen Satz war sie kein Training und verschwindet.
 *
 *   Eine BEENDETE Einheit ganz ohne Sätze (Artefakt aus Versehen oder
 *   Altversion) verschwindet ebenfalls — egal an welchem Tag. Sie würde
 *   sonst als „fertige Einheit" den Startknopf verdecken und in keiner
 *   Auswertung etwas Wahres beitragen.
 *
 * Die laufende Einheit von HEUTE (oder einem noch kommenden Tag) bleibt
 * unangetastet — die gehört dem, der gerade trainiert.
 */
export function withStaleSessionsClosed(state, today) {
  parseKey(today);
  let next = state;
  for (const [dayKey, day] of Object.entries(state.days ?? {})) {
    for (const session of day.sessions ?? []) {
      const empty = !hasLoggedSets(session) && session.sessionRpe == null;
      const running = Boolean(session.startedAt && !session.endedAt);

      if (running && dayKey < today) {
        next = empty
          ? withoutSession(next, dayKey, session.planId)
          : withSessionMeta(next, dayKey, session.planId, {
            endedAt: session.lastSetAt ?? session.startedAt,
          });
      } else if (empty && session.endedAt) {
        next = withoutSession(next, dayKey, session.planId);
      }
    }
  }
  return next;
}

/** Die geloggten Sätze einer Übung an einem Tag. Nie undefined. */
export function getSets(state, dayKey, planId, exId) {
  const session = getSession(state, dayKey, planId);
  return session?.exercises.find((e) => e.exId === exId)?.sets ?? [];
}

function validateSet(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError(`Satz muss ein Objekt sein, war: ${patch}`);
  }
  if (patch.reps !== null && patch.reps !== undefined) {
    assertNumber(patch.reps, 'reps', 1, 500);
  }
  if (patch.kg !== null && patch.kg !== undefined) {
    assertNumber(patch.kg, 'kg', 0, 500);
  }
  if (patch.rpe !== null && patch.rpe !== undefined) {
    assertNumber(patch.rpe, 'rpe', 1, 10);
  }
  return patch;
}

/**
 * Einen Satz schreiben.
 *
 * Einheit und Übung werden bei Bedarf angelegt. Lücken zwischen den Sätzen
 * werden mit `null` aufgefüllt: wer erst Satz 3 einträgt, soll nicht daran
 * scheitern — gezählt werden später nur die tatsächlich gefüllten.
 */
export function withSet(state, dayKey, planId, exId, setIndex, patch) {
  parseKey(dayKey);
  validateSet(patch);
  if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex > 49) {
    throw new RangeError(`setIndex muss 0–49 sein, war: ${setIndex}`);
  }

  const day = getDay(state, dayKey);
  const sessions = [...day.sessions];

  let sessionIndex = sessions.findIndex((s) => s.planId === planId);
  if (sessionIndex === -1) {
    sessions.push(emptySession(planId));
    sessionIndex = sessions.length - 1;
  }

  const session = { ...sessions[sessionIndex] };
  const exercises = [...session.exercises];

  let exIndex = exercises.findIndex((e) => e.exId === exId);
  if (exIndex === -1) {
    exercises.push({ exId, sets: [] });
    exIndex = exercises.length - 1;
  }

  const sets = [...exercises[exIndex].sets];
  while (sets.length <= setIndex) sets.push(null);
  sets[setIndex] = { reps: null, kg: null, rpe: null, ...(sets[setIndex] ?? {}), ...patch };

  exercises[exIndex] = { ...exercises[exIndex], sets };
  session.exercises = exercises;
  sessions[sessionIndex] = session;

  return withDay(state, dayKey, { sessions });
}

/** Einen Satz wieder entfernen. Leere Übungen und Einheiten fallen mit weg. */
export function withoutSet(state, dayKey, planId, exId, setIndex) {
  const day = getDay(state, dayKey);
  const sessions = day.sessions
    .map((session) => {
      if (session.planId !== planId) return session;
      const exercises = session.exercises
        .map((entry) => {
          if (entry.exId !== exId) return entry;
          const sets = entry.sets.filter((_, i) => i !== setIndex);
          return { ...entry, sets };
        })
        .filter((entry) => entry.sets.some(Boolean));
      return { ...session, exercises };
    })
    .filter((session) => session.exercises.length > 0);

  return withDay(state, dayKey, { sessions });
}

/**
 * Wann wurde diese Übung zuletzt gemacht, und mit was?
 *
 * Das ist die "letztes Mal"-Anzeige im Logger. Ohne sie ist Progression
 * Ratespiel — man erinnert sich nicht an das Gewicht von vor einer Woche.
 * Der heutige Tag wird ausgeklammert, sonst zeigt die Anzeige den Satz, den
 * man gerade eingetragen hat.
 */
export function lastPerformance(state, beforeDayKey, exId) {
  parseKey(beforeDayKey);
  const keys = Object.keys(state.days ?? {})
    .filter((k) => k < beforeDayKey)
    .sort()
    .reverse();

  for (const key of keys) {
    for (const session of state.days[key].sessions ?? []) {
      const entry = session.exercises?.find((e) => e.exId === exId);
      const sets = (entry?.sets ?? []).filter(Boolean);
      if (sets.length > 0) return { dayKey: key, sets };
    }
  }
  return null;
}

/* ─── Verschobene Trainingstage ──────────────────────────────────────────── */

/** Kennung für „an diesem Tag ausdrücklich kein Training". */
export const NO_SESSION = 'none';

/**
 * Eine Einheit auf einen anderen Tag legen — oder eine Verschiebung aufheben.
 *
 * `planId === null` löscht den Eintrag und lässt wieder den Wochentag aus dem
 * Plan gelten. Das ist wichtig: sonst könnte man eine Verschiebung nie
 * zurücknehmen, ohne zu wissen, was vorher galt.
 */
export function withScheduleOverride(state, dayKey, planId) {
  parseKey(dayKey);
  const schedule = { ...(state.schedule ?? {}) };
  if (planId === null) delete schedule[dayKey];
  else schedule[dayKey] = planId;
  return { ...state, schedule };
}

/* ─── Yazio-Wochenschnitt ────────────────────────────────────────────────── */

const WEEK_MACRO_LIMITS = { kcal: 8000, proteinG: 600, carbsG: 1200, fatG: 400 };

/**
 * Wochenschnitt der Makros schreiben.
 *
 * Getragen wird der MONTAGSSCHLÜSSEL der Woche. Flocke liest die Zahlen aus
 * Yazio ab; die App rechnet sie nicht aus den Tageswerten, weil dort nur
 * steht, was er hier von Hand einträgt.
 */
export function withWeekMacros(state, weekStart, patch) {
  parseKey(weekStart);
  if (!isPlainObject(patch)) {
    throw new TypeError(`Wochen-Patch muss ein Objekt sein, war: ${patch}`);
  }
  for (const [field, max] of Object.entries(WEEK_MACRO_LIMITS)) {
    const value = patch[field];
    if (value !== null && value !== undefined) {
      assertNumber(value, `weeks.${field}`, 0, max);
    }
  }

  const weeks = { ...(state.weeks ?? {}) };
  weeks[weekStart] = { ...(weeks[weekStart] ?? {}), ...patch };
  return { ...state, weeks };
}

/** Wochenschnitt lesen. Nie undefined. */
export function getWeekMacros(state, weekStart) {
  parseKey(weekStart);
  return {
    kcal: null, proteinG: null, carbsG: null, fatG: null, note: null,
    ...(state.weeks?.[weekStart] ?? {}),
  };
}

/* ─── Monats-Reviews ─────────────────────────────────────────────────────── */

/**
 * Einen Monats-Review-Datensatz ablegen oder ersetzen.
 *
 * Ein Monat kann nur einen Datensatz haben — ein zweites Review desselben
 * Monats ist eine Korrektur, keine zusätzliche Meinung.
 */
export function withReviewRecord(state, record) {
  if (!isPlainObject(record) || typeof record.month !== 'string') {
    throw new TypeError('Ein Monats-Review braucht mindestens einen Monatsschlüssel.');
  }
  const reviews = [...(state.reviews ?? []).filter((r) => r.month !== record.month), record]
    .sort((a, b) => a.month.localeCompare(b.month));
  return { ...state, reviews };
}

/** Review eines Monats, oder null. */
export function getReviewRecord(state, mk) {
  return (state.reviews ?? []).find((r) => r.month === mk) ?? null;
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

  // Tagestypen, an denen die Kalorienkorrektur ausgesetzt wird.
  p.offsetExemptDayTypes = [...new Set(p.offsetExemptDayTypes ?? [])];
  for (const type of p.offsetExemptDayTypes) {
    if (!DAY_TYPES.includes(type)) {
      throw new RangeError(`Unbekannter Tagestyp in offsetExemptDayTypes: "${type}"`);
    }
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

/**
 * Der früheste Monat, den die App überhaupt kennt.
 *
 * Er wird ABGELEITET, nicht eingestellt: der früheste Monat, in dem es Tage,
 * eine Monats-Summary oder ein Review gibt. Damit gibt es keine zweite
 * Wahrheit, die man pflegen müsste — wer einen Monat löscht, verschiebt damit
 * auch den Anfang, und wer alte Daten einspielt, holt sie sich zurück.
 *
 * Gebraucht wird das überall, wo die App rückwärts blickt: das Review darf
 * nicht vor diesen Monat blättern, es darf für einen Monat davor kein Review
 * verlangen, und die Wochentabelle im Reiter Essen darf keine Wochen davor
 * auflisten. Leere Zeilen aus einer Zeit ohne Daten liest man als Fehler.
 *
 * Steht hier und nicht in review.js, weil es eine Frage an den ZUSTAND ist und
 * keine an eine Auswertung — sonst müsste weekly.js das Review importieren.
 */
export function firstTrackedMonth(state, today) {
  const months = [];

  for (const key of Object.keys(state?.days ?? {})) {
    try {
      months.push(toMonthKey(key));
    } catch { /* kaputter Schlüssel — der zählt hier nicht */ }
  }
  for (const m of state?.months ?? []) {
    if (typeof m?.month === 'string') months.push(m.month);
  }
  for (const r of state?.reviews ?? []) {
    if (typeof r?.month === 'string') months.push(r.month);
  }

  const valid = months.filter((mk) => /^\d{4}-(0[1-9]|1[0-2])$/.test(mk)).sort();
  const current = toMonthKey(today);

  // Ohne jede Daten fängt die Zeitrechnung heute an.
  if (valid.length === 0) return current;

  /* Nie in der Zukunft: ein nachgetragener Tag im nächsten Monat verschiebt den
     Anfang nicht nach vorn. */
  return valid[0] < current ? valid[0] : current;
}

/** Der erste Tag, den die App kennt — die Untergrenze jedes Rückblicks. */
export function firstTrackedDay(state, today) {
  return `${firstTrackedMonth(state, today)}-01`;
}
