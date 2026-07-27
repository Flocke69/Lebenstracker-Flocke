/* Platzierung der Krafteinheiten rund um den Fußball.
 *
 * Das ist die Sicherheitsregel der App. Der Fehler, den sie verhindert:
 * schwere Beinarbeit so kurz vor dem Spiel, dass die Beine am Spieltag
 * platt sind — oder so kurz danach, dass auf müde Beine noch draufgepackt
 * wird.
 *
 * ZWEI SCHWELLEN, NICHT EINE. Das ist der entscheidende Punkt:
 *
 *   Vor dem Spiel zählt Frische.  → mindestens 3 Tage Abstand
 *   Nach dem Spiel zählt Erholung. → mindestens 2 Tage Abstand
 *
 * Ein gemeinsamer Wert würde beides vermischen: bei einem Sonntagsspiel
 * haben Dienstag und Freitag denselben "nächsten Abstand" von 2 Tagen,
 * obwohl Dienstag 5 Tage VOR dem Spiel liegt und Freitag nur 2. Dienstag
 * wäre also fälschlich gesperrt und Freitag fälschlich milde behandelt.
 *
 * Dazu kommt eine dritte Bedingung: am Tag VOR dem Mannschaftstraining
 * gibt es kein schweres Beintraining, sonst leidet das Training selbst.
 *
 * Nicht zu verwechseln — Beintraining ganz zu streichen wäre die riskantere
 * Variante. Exzentrische Hamstring-Arbeit ist der wirksamste bekannte Schutz
 * gegen die häufigste Fußballverletzung. Deshalb bleibt Stufe "light" (der
 * Prophylaxeblock) an jedem Tag außer Spieltag und Vortag erlaubt: er kostet
 * praktisch keine Erholung.
 */

import { weekdayOf, WEEKDAYS_LONG } from './dates.js';

/** Mindestabstand VOR dem Spiel für schwere Beinarbeit, in Tagen. */
export const LEG_MIN_DAYS_BEFORE_MATCH = 3;

/** Mindestabstand NACH dem Spiel für schwere Beinarbeit, in Tagen. */
export const LEG_MIN_DAYS_AFTER_MATCH = 2;

/** Unter diesem Abstand zum Spiel ist jedes Beinvolumen gesperrt. */
export const NO_LEG_VOLUME_WITHIN_DAYS = 2;

/**
 * Die drei Stufen:
 *   none  — gar nichts für die Beine
 *   light — nur Prophylaxe und Mobilität (Nordic Curls, Copenhagen, Waden)
 *   heavy — schwere Sätze bei niedrigem Volumen
 */
export const LEG_LEVELS = Object.freeze(['none', 'light', 'heavy']);

/* ─── Eingabeprüfung ─────────────────────────────────────────────────────── */

function assertWeekday(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new RangeError(`${name} muss 0–6 sein (0 = Sonntag), war: ${value}`);
  }
  return value;
}

function assertConfig({ matchDayWeekday, teamTrainingWeekdays = [] } = {}) {
  assertWeekday(matchDayWeekday, 'matchDayWeekday');
  if (!Array.isArray(teamTrainingWeekdays)) {
    throw new TypeError(
      `teamTrainingWeekdays muss ein Array sein, war: ${teamTrainingWeekdays}`
    );
  }
  teamTrainingWeekdays.forEach((d, i) =>
    assertWeekday(d, `teamTrainingWeekdays[${i}]`)
  );
  return { matchDayWeekday, teamTrainingWeekdays };
}

function assertGymWeekdays(gymWeekdays) {
  if (!Array.isArray(gymWeekdays) || gymWeekdays.length === 0) {
    throw new RangeError(
      `gymWeekdays muss mindestens einen Wochentag enthalten, war: ${gymWeekdays}`
    );
  }
  gymWeekdays.forEach((d, i) => assertWeekday(d, `gymWeekdays[${i}]`));
  return [...new Set(gymWeekdays)];
}

/* ─── Abstände im Wochentagsraum ─────────────────────────────────────────── */

const until = (from, to) => (to - from + 7) % 7;
const since = (from, to) => (from - to + 7) % 7;

/** Ringabstand zweier Wochentage, 0–3. Für die Streuung der Gym-Tage. */
function circularGap(a, b) {
  const d = Math.abs(a - b) % 7;
  return Math.min(d, 7 - d);
}

/* ─── Die Regel ──────────────────────────────────────────────────────────── */

function allowanceForWeekday(weekday, matchDayWeekday, teamTrainingWeekdays) {
  const daysUntilMatch = until(weekday, matchDayWeekday);
  const daysSinceMatch = since(weekday, matchDayWeekday);
  const isTeamTrainingDay = teamTrainingWeekdays.includes(weekday);
  const daysUntilTeamTraining = teamTrainingWeekdays.length
    ? Math.min(...teamTrainingWeekdays.map((t) => until(weekday, t)))
    : null;

  const dayName = WEEKDAYS_LONG[weekday];
  const base = {
    weekday, dayName, daysUntilMatch, daysSinceMatch,
    isTeamTrainingDay, daysUntilTeamTraining,
  };

  // 1. Harte Sperre: Spieltag und Vortag.
  if (daysUntilMatch < NO_LEG_VOLUME_WITHIN_DAYS) {
    return {
      ...base,
      level: 'none',
      reason:
        daysUntilMatch === 0
          ? 'Spieltag. Die Beine gehören dem Spiel.'
          : 'Morgen ist Spiel. Heute nichts für die Beine, auch nichts Leichtes.',
    };
  }

  // 2. Zu kurz nach dem Spiel: die Erholung läuft noch.
  if (daysSinceMatch < LEG_MIN_DAYS_AFTER_MATCH) {
    return {
      ...base,
      level: 'light',
      reason:
        `Das Spiel war vor ${daysSinceMatch} Tag${daysSinceMatch === 1 ? '' : 'en'}. ` +
        'Nur Prophylaxe und Mobilität — schwere Sätze auf müde Beine bringen nichts.',
    };
  }

  // 3. Zu kurz vor dem Spiel: es bleibt nicht genug Zeit zum Erholen.
  if (daysUntilMatch < LEG_MIN_DAYS_BEFORE_MATCH) {
    return {
      ...base,
      level: 'light',
      reason:
        `Nur ${daysUntilMatch} Tage bis zum Spiel. Für schwere Beinarbeit ` +
        `brauchst du ${LEG_MIN_DAYS_BEFORE_MATCH} — sonst stehst du am Sonntag ` +
        'mit Muskelkater auf dem Platz.',
    };
  }

  // 4. Am Tag vor dem Mannschaftstraining bleibt es leicht.
  if (daysUntilTeamTraining === 1) {
    return {
      ...base,
      level: 'light',
      reason:
        'Morgen ist Mannschaftstraining. Schwere Beine heute würden das ' +
        'Training ruinieren — nur Prophylaxe.',
    };
  }

  // 5. Freie Bahn.
  return {
    ...base,
    level: 'heavy',
    reason: isTeamTrainingDay
      ? `${daysUntilMatch} Tage bis zum Spiel. Schwere Sätze möglich — heute ` +
        'ist ohnehin Mannschaftstraining, harter Tag bleibt hart.'
      : `${daysUntilMatch} Tage bis zum Spiel, ${daysSinceMatch} Tage danach. ` +
        'Guter Tag für schwere Sätze bei niedrigem Volumen.',
  };
}

/**
 * Welches Beinvolumen ist an diesem Tag erlaubt?
 *
 * @param {string} key Tagesschlüssel 'YYYY-MM-DD'
 * @returns {{level, reason, weekday, dayName, daysUntilMatch, daysSinceMatch,
 *            isTeamTrainingDay, daysUntilTeamTraining}}
 */
export function legVolumeAllowance(key, config) {
  const { matchDayWeekday, teamTrainingWeekdays } = assertConfig(config);
  return allowanceForWeekday(weekdayOf(key), matchDayWeekday, teamTrainingWeekdays);
}

/** Dieselbe Regel, aber direkt auf einem Wochentag statt einem Datum. */
export function legVolumeAllowanceForWeekday(weekday, config) {
  const { matchDayWeekday, teamTrainingWeekdays } = assertConfig(config);
  assertWeekday(weekday, 'weekday');
  return allowanceForWeekday(weekday, matchDayWeekday, teamTrainingWeekdays);
}

/** Alle Wochentage, die schweres Beintraining tragen, aufsteigend. */
export function heavyLegWeekdays(config) {
  const { matchDayWeekday, teamTrainingWeekdays } = assertConfig(config);
  const out = [];
  for (let w = 0; w < 7; w += 1) {
    if (allowanceForWeekday(w, matchDayWeekday, teamTrainingWeekdays).level === 'heavy') {
      out.push(w);
    }
  }
  return out;
}

/* ─── Wahl des Bein-Tags ─────────────────────────────────────────────────── */

/*
 * Reihenfolge der Vorlieben:
 *   1. kein Mannschaftstraining am selben Tag (bessere Qualität der Sätze)
 *   2. mehr Abstand zum Spiel   (mehr Zeit zum Erholen)
 *   3. mehr Abstand seit dem Spiel (frischer beim Start)
 */
function rankLegDays(weekdays, matchDayWeekday, teamTrainingWeekdays) {
  return [...weekdays]
    .map((w) => allowanceForWeekday(w, matchDayWeekday, teamTrainingWeekdays))
    .sort(
      (a, b) =>
        Number(a.isTeamTrainingDay) - Number(b.isTeamTrainingDay) ||
        b.daysUntilMatch - a.daysUntilMatch ||
        b.daysSinceMatch - a.daysSinceMatch
    );
}

/**
 * Welcher der geplanten Gym-Tage trägt die schwere Bein-Einheit?
 *
 * Gibt bei einem Konflikt `weekday: null` zurück UND erklärt ihn — die App
 * soll nicht stillschweigend einen ungeeigneten Tag wählen.
 */
export function pickLegDay(config) {
  const { matchDayWeekday, teamTrainingWeekdays } = assertConfig(config);
  const gymWeekdays = assertGymWeekdays(config.gymWeekdays);
  const candidates = heavyLegWeekdays(config);
  const eligible = gymWeekdays.filter((w) => candidates.includes(w));

  if (eligible.length === 0) {
    const candidateNames = candidates.map((w) => WEEKDAYS_LONG[w]).join(' oder ');
    const gymNames = gymWeekdays.map((w) => WEEKDAYS_LONG[w]).join(', ');
    return {
      weekday: null,
      dayName: null,
      sharesTeamTrainingDay: false,
      candidates,
      reason: candidates.length
        ? `Keiner deiner Gym-Tage (${gymNames}) trägt schweres Beintraining. ` +
          `Rund um dein Spiel käme dafür ${candidateNames} in Frage. ` +
          'Ohne passenden Tag bleibt es beim Prophylaxeblock.'
        : `Bei diesem Spiel- und Trainingsrhythmus gibt es keinen Tag mit ` +
          `genug Abstand für schweres Beintraining. Es bleibt beim ` +
          `Prophylaxeblock — der ist ohnehin der wichtigere Teil.`,
    };
  }

  const best = rankLegDays(eligible, matchDayWeekday, teamTrainingWeekdays)[0];
  return {
    weekday: best.weekday,
    dayName: best.dayName,
    sharesTeamTrainingDay: best.isTeamTrainingDay,
    candidates,
    /** Vollständiger Satz, wenn er allein steht (Log, Copy-Block). */
    reason: `Bein-Einheit am ${best.dayName}: ${best.reason}`,
    /** Nur die Begründung — für Anzeigen, die den Tag schon im Titel nennen. */
    detail: best.reason,
  };
}

/* ─── Vorschlag für die Gym-Tage ─────────────────────────────────────────── */

/**
 * Vorschlag, an welchen Wochentagen die Krafteinheiten liegen sollten.
 *
 * Vorgehen: Spieltag und Vortag fallen weg, der Mannschaftstrainingstag
 * bleibt standardmäßig frei, dann wird zuerst der Bein-Tag gesetzt und der
 * Rest so verteilt, dass der kleinste Abstand zwischen zwei Einheiten so
 * groß wie möglich wird.
 *
 * Das ist ein VORSCHLAG für das Onboarding. Flocke kann die Tage im Profil
 * jederzeit ändern.
 */
export function suggestGymWeekdays(config) {
  const { matchDayWeekday, teamTrainingWeekdays } = assertConfig(config);
  const count = config.count ?? 3;
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count muss mindestens 1 sein, war: ${count}`);
  }

  const allowanceOf = (w) =>
    allowanceForWeekday(w, matchDayWeekday, teamTrainingWeekdays);

  // Pool: alles außer Spieltag, Vortag und Mannschaftstrainingstagen.
  const pool = [];
  for (let w = 0; w < 7; w += 1) {
    const a = allowanceOf(w);
    if (a.level !== 'none' && !a.isTeamTrainingDay) pool.push(w);
  }

  if (count > pool.length) {
    throw new RangeError(
      `${count} Gym-Tage angefragt, aber nur ${pool.length} Tage sind frei ` +
      `(Spieltag, Vortag und Mannschaftstraining fallen weg).`
    );
  }

  // Bein-Tag zuerst — er hat die engsten Bedingungen.
  const heavyInPool = pool.filter((w) => allowanceOf(w).level === 'heavy');
  let warning = null;
  let legDay = null;

  if (heavyInPool.length > 0) {
    legDay = rankLegDays(heavyInPool, matchDayWeekday, teamTrainingWeekdays)[0].weekday;
  } else {
    // Rückfall: nur ein Mannschaftstrainingstag trägt schwere Beinarbeit.
    const heavyOnTeamDay = heavyLegWeekdays(config).filter((w) =>
      teamTrainingWeekdays.includes(w)
    );
    if (heavyOnTeamDay.length > 0) {
      legDay = rankLegDays(heavyOnTeamDay, matchDayWeekday, teamTrainingWeekdays)[0].weekday;
      warning =
        `Schweres Beintraining passt nur auf ${WEEKDAYS_LONG[legDay]} — ` +
        'denselben Tag wie das Mannschaftstraining. Das ist ein harter Tag.';
    } else {
      warning =
        'Bei diesem Rhythmus gibt es keinen Tag mit genug Abstand für ' +
        'schweres Beintraining. Es bleibt beim Prophylaxeblock.';
    }
  }

  const chosen = legDay !== null ? [legDay] : [];
  const rest = pool.filter((w) => w !== legDay);

  // Greedy: jeweils den Tag mit dem größten Mindestabstand zu den bereits
  // gewählten dazunehmen. Gleichstand geht an den Tag mit mehr Abstand zum
  // Spiel — so bleiben die Tage direkt vor dem Spiel möglichst frei.
  while (chosen.length < count && rest.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    let bestUntil = -1;
    rest.forEach((w, i) => {
      const score = chosen.length
        ? Math.min(...chosen.map((c) => circularGap(w, c)))
        : 99;
      const u = allowanceOf(w).daysUntilMatch;
      if (score > bestScore || (score === bestScore && u > bestUntil)) {
        bestIdx = i;
        bestScore = score;
        bestUntil = u;
      }
    });
    chosen.push(rest.splice(bestIdx, 1)[0]);
  }

  const gymWeekdays = chosen.sort((a, b) => a - b);
  return {
    gymWeekdays,
    legDay,
    warning,
    days: gymWeekdays.map((w) => allowanceOf(w)),
  };
}
