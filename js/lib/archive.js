/* Monatsabschluss, Export und Import.
 *
 * Flockes Kernanforderung an die Datenhaltung: innerhalb des Monats liegt
 * jeder Tag einzeln, am Monatsende wird alles zu EINEM Datensatz verdichtet
 * und als Datei gesichert, danach startet der neue Monat leer.
 *
 * DIE SPERRE IST DER KERN DIESER DATEI. "Monat abschließen" ist so lange
 * blockiert, bis der Export tatsächlich erzeugt wurde — nicht als Hinweis,
 * den man wegklickt, sondern als Bedingung im Code. Ein Monat Daten darf
 * nicht an einem Fehltipp hängen.
 *
 * Warum das Verdichten überhaupt? Weil iOS Safari den Speicher einer Web-App
 * nach längerer Pause löschen kann. Die Exportdateien sind die einzige Kopie,
 * die das überlebt — und die App bleibt klein und schnell.
 */

import { monthKey, monthDays, todayKey, addMonths, formatMonth } from './dates.js';
import { monthSummary } from './aggregate.js';
import { SCHEMA_VERSION, migrate } from './state.js';

/** Format der Exportdatei. Unabhängig von der Schemaversion des Zustands. */
export const EXPORT_VERSION = 1;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ─── Rollover-Erkennung ─────────────────────────────────────────────────── */

/**
 * Steht ein Monatsabschluss an?
 *
 * Verglichen wird der gespeicherte Monat mit dem heutigen. Der Vergleich
 * läuft über Strings im Format YYYY-MM — die sind lexikografisch sortierbar,
 * ein Zeitzonenproblem kann es dabei nicht geben.
 */
export function needsRollover(state, today = todayKey()) {
  const current = state?.currentMonth;
  if (typeof current !== 'string') return false;
  return current < monthKey(today);
}

/**
 * Wurde seit dem Monatswechsel exportiert?
 *
 * Ein Export von vor drei Monaten zählt nicht. Maßgeblich ist, ob die Datei
 * NACH dem letzten Tag des abzuschließenden Monats erzeugt wurde.
 */
export function hasFreshExport(state) {
  const stamp = state?.lastExportAt;
  if (typeof stamp !== 'string') return false;
  const exported = new Date(stamp);
  if (Number.isNaN(exported.getTime())) return false;

  const days = monthDays(state.currentMonth);
  const lastDay = days[days.length - 1];
  const [y, m, d] = lastDay.split('-').map(Number);
  // Ende des letzten Monatstags, lokale Zeit.
  return exported.getTime() >= new Date(y, m - 1, d, 23, 59, 59).getTime();
}

/**
 * Darf der Monat abgeschlossen werden?
 *
 * @returns {{allowed: boolean, reason: string}}
 */
export function canCloseMonth(state, today = todayKey()) {
  if (!needsRollover(state, today)) {
    return { allowed: false, reason: `${formatMonth(state.currentMonth)} läuft noch.` };
  }
  if (!hasFreshExport(state)) {
    return {
      allowed: false,
      reason: 'Erst sichern. Ohne Exportdatei wird nichts gelöscht — ein Monat '
            + 'Daten darf nicht an einem Fehltipp hängen.',
    };
  }
  return { allowed: true, reason: 'Export liegt vor, der Monat kann abgeschlossen werden.' };
}

/* ─── Vorschau ───────────────────────────────────────────────────────────── */

/** Was steckt im abzuschließenden Monat? */
export function rolloverPreview(state) {
  const mk = state.currentMonth;
  const summary = monthSummary(state, mk);
  const dayKeys = Object.keys(state.days ?? {})
    .filter((k) => monthKey(k) === mk)
    .sort();

  return {
    month: mk,
    label: formatMonth(mk),
    dayKeys,
    dayCount: dayKeys.length,
    summary,
  };
}

/* ─── Export ─────────────────────────────────────────────────────────────── */

/**
 * Vollständige Sicherung eines Monats.
 *
 * Enthält BEIDES: jeden Tag im Detail und die verdichtete Summary. Das Detail,
 * damit sich der Monat vollständig wiederherstellen lässt; die Summary, damit
 * die Datei auch ohne die App etwas aussagt.
 */
export function buildExport(state, mk = state.currentMonth, stamp) {
  monthDays(mk); // wirft bei ungültigem Monatsschlüssel

  const days = Object.fromEntries(
    Object.entries(state.days ?? {}).filter(([key]) => monthKey(key) === mk)
  );
  const schedule = Object.fromEntries(
    Object.entries(state.schedule ?? {}).filter(([key]) => monthKey(key) === mk)
  );

  return {
    exportVersion: EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    app: 'Lebenstracker',
    month: mk,
    exportedAt: stamp,
    profile: state.profile,
    days,
    /* Verschobene Trainingstage dieses Monats. Ohne sie ließe sich nach einem
       Wiederherstellen nicht mehr erkennen, warum am Freitag ein Push-Training
       geloggt ist. */
    schedule,
    /* Wochenschnitte und Reviews vollständig, nicht nur die des Monats: sie
       sind wenige Kilobyte und eine Woche liegt regelmäßig über der
       Monatsgrenze. */
    weeks: state.weeks ?? {},
    reviews: state.reviews ?? [],
    summary: monthSummary(state, mk),
    previousMonths: state.months ?? [],
  };
}

export function exportFilename(mk) {
  return `lebenstracker-${mk}.json`;
}

/** Zeitstempel im Zustand vermerken — die Sperre hängt daran. */
export function withExportStamp(state, stamp) {
  if (typeof stamp !== 'string' || Number.isNaN(new Date(stamp).getTime())) {
    throw new TypeError(`Ungültiger Zeitstempel: ${stamp}`);
  }
  return { ...state, lastExportAt: stamp };
}

/* ─── Abschluss ──────────────────────────────────────────────────────────── */

/**
 * Monat verdichten, Tage leeren, neuen Monat beginnen.
 *
 * Wirft, wenn die Sperre nicht offen ist. Das ist Absicht: die Prüfung soll
 * nicht davon abhängen, dass eine Ansicht sie vorher aufgerufen hat.
 */
export function closeMonth(state, today = todayKey()) {
  const check = canCloseMonth(state, today);
  if (!check.allowed) {
    throw new Error(`Monatsabschluss gesperrt: ${check.reason}`);
  }

  const mk = state.currentMonth;
  const summary = monthSummary(state, mk);

  // Tage anderer Monate bleiben unberührt — nach einem Import können ältere
  // Tage im Zustand liegen, die nichts mit diesem Abschluss zu tun haben.
  const keptDays = Object.fromEntries(
    Object.entries(state.days ?? {}).filter(([key]) => monthKey(key) !== mk)
  );
  // Verschiebungen gehören zu ihren Tagen und gehen mit ihnen weg.
  const keptSchedule = Object.fromEntries(
    Object.entries(state.schedule ?? {}).filter(([key]) => monthKey(key) !== mk)
  );

  const months = [...(state.months ?? []).filter((m) => m.month !== mk),
    { month: mk, closedAt: today, summary }]
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    ...state,
    days: keptDays,
    schedule: keptSchedule,
    months,
    currentMonth: monthKey(today),
  };
}

/* ─── Import ─────────────────────────────────────────────────────────────── */

/** Eine Exportdatei prüfen, bevor irgendetwas angefasst wird. */
export function inspectImport(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('Das ist keine Lebenstracker-Sicherung.');
  }
  if (raw.app !== 'Lebenstracker') {
    throw new Error('Diese Datei stammt nicht aus dem Lebenstracker.');
  }
  if (!Number.isInteger(raw.exportVersion) || raw.exportVersion > EXPORT_VERSION) {
    throw new Error(
      `Die Datei hat Exportformat ${raw.exportVersion}, diese App-Version kennt `
      + `höchstens ${EXPORT_VERSION}.`
    );
  }
  if (typeof raw.month !== 'string') {
    throw new Error('In der Datei fehlt die Monatsangabe.');
  }
  monthDays(raw.month);

  const dayCount = Object.keys(raw.days ?? {}).length;
  return {
    month: raw.month,
    label: formatMonth(raw.month),
    dayCount,
    exportedAt: raw.exportedAt ?? null,
    hasProfile: Boolean(raw.profile),
    summary: raw.summary ?? null,
  };
}

/**
 * Tage aus einer Sicherung zurückspielen.
 *
 * Der laufende Monat wird NICHT verändert und bestehende Tage werden nur
 * überschrieben, wenn `overwrite` gesetzt ist. Ein Import soll ergänzen,
 * nicht überraschend löschen.
 */
export function applyImport(state, raw, { overwrite = false } = {}) {
  inspectImport(raw);

  const incoming = raw.days ?? {};
  const days = { ...state.days };
  let added = 0;
  let skipped = 0;

  for (const [key, day] of Object.entries(incoming)) {
    if (!overwrite && days[key]) { skipped += 1; continue; }
    days[key] = day;
    added += 1;
  }

  // Monats-Summaries zusammenführen, ohne Dubletten.
  const months = [...(state.months ?? [])];
  const known = new Set(months.map((m) => m.month));
  for (const m of raw.previousMonths ?? []) {
    if (!known.has(m.month)) { months.push(m); known.add(m.month); }
  }
  if (raw.summary && !known.has(raw.month) && raw.month !== state.currentMonth) {
    months.push({ month: raw.month, closedAt: null, summary: raw.summary });
  }
  months.sort((a, b) => a.month.localeCompare(b.month));

  /* Verschiebungen und Wochenschnitte folgen derselben Regel wie die Tage:
     Vorhandenes bleibt stehen, sofern nicht ausdrücklich überschrieben wird. */
  const schedule = { ...(state.schedule ?? {}) };
  for (const [key, planId] of Object.entries(raw.schedule ?? {})) {
    if (overwrite || !(key in schedule)) schedule[key] = planId;
  }

  const weeks = { ...(state.weeks ?? {}) };
  for (const [key, macros] of Object.entries(raw.weeks ?? {})) {
    if (overwrite || !(key in weeks)) weeks[key] = macros;
  }

  // Reviews: je Monat einer. Ein vorhandener bleibt, er enthält Antworten.
  const reviews = [...(state.reviews ?? [])];
  const reviewed = new Set(reviews.map((r) => r.month));
  for (const record of raw.reviews ?? []) {
    if (!record?.month) continue;
    if (!reviewed.has(record.month)) { reviews.push(record); reviewed.add(record.month); }
  }
  reviews.sort((a, b) => a.month.localeCompare(b.month));

  return {
    state: migrate({ ...state, days, months, schedule, weeks, reviews }, state.currentMonth),
    added,
    skipped,
  };
}

/* ─── Erinnerung ─────────────────────────────────────────────────────────── */

/** Nach so vielen Tagen ohne Export wird erinnert. */
export const EXPORT_REMINDER_DAYS = 7;

/**
 * Soll an den Export erinnert werden?
 *
 * iOS Safari löscht die Daten von Web-Apps, die rund 7 Wochen nicht geöffnet
 * wurden. Die Erinnerung kommt deutlich früher, damit im Ernstfall höchstens
 * ein paar Tage fehlen.
 */
export function exportReminder(state, today = todayKey()) {
  const stamp = state?.lastExportAt;
  const now = new Date(`${today}T12:00:00`);

  if (typeof stamp !== 'string') {
    const dayCount = Object.keys(state?.days ?? {}).length;
    return {
      due: dayCount >= EXPORT_REMINDER_DAYS,
      daysSince: null,
      text: 'Noch nie gesichert. Die Daten liegen ausschließlich auf diesem Gerät.',
    };
  }

  const exported = new Date(stamp);
  const days = Math.floor((now - exported) / 86400000);

  /* „vor 0 Tagen" ist keine Auskunft. Der Text ist außerdem die einzige
     Bestätigung nach einem Export — die Ansicht zeichnet sich dabei neu, eine
     Meldung im Screen wäre sofort wieder weg (siehe js/views/archive.js). */
  const text = days >= EXPORT_REMINDER_DAYS
    ? `Letzte Sicherung vor ${days} Tagen.`
    : days <= 0
      ? 'Heute gesichert.'
      : `Zuletzt gesichert vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}.`;

  return { due: days >= EXPORT_REMINDER_DAYS, daysSince: days, text };
}
