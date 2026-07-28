/* Welche Einheit steht an welchem Tag — und wohin sie darf, wenn es nicht passt.
 *
 * Der Plan legt Wochentage fest: Push Montag, Pull Dienstag, Beine Donnerstag.
 * Das Leben tut das nicht. Wer am Montag nicht kann, soll die Einheit
 * verschieben können, ohne dass die App danach behauptet, er hätte sie
 * ausgelassen.
 *
 * DIE VERSCHIEBUNG IST EINE AUSNAHME, KEINE PLANÄNDERUNG. Sie gilt für einen
 * einzelnen Tag und liegt in `state.schedule`. Der Plan selbst bleibt
 * unangetastet — nächste Woche steht Push wieder auf Montag.
 *
 * Und die App gibt eine EMPFEHLUNG. "Verschieb es irgendwohin" ist keine
 * Hilfe: die Frage ist, welcher Tag am wenigsten kostet. Dafür wird jeder Tag
 * der Woche bewertet, und die Begründung wird mitgeliefert — eine Empfehlung
 * ohne Grund ist ein Orakel.
 *
 * Diese Datei kennt kein DOM. Sie ist in tests/schedule.test.js geprüft.
 */

import {
  weekKeys, weekdayOf, weekdayShort, formatDayShort, todayKey, daysBetween, WEEKDAYS_LONG,
} from './dates.js';
import { NO_SESSION } from './state.js';
import { legVolumeAllowance } from './planner.js';
import { SESSIONS, sessionById, sessionForWeekday } from '../../data/plan-default.js';
import { EXERCISES } from '../../data/exercises.js';

/** Punkte, die ein Tag verliert. Höherer Malus = schlechterer Tag. */
export const PENALTY = Object.freeze({
  /** Der Tag fällt ganz weg. */
  blocked: Infinity,
  /** Schwere Beinarbeit ohne genug Abstand zum Spiel. */
  legsWithoutRoom: 1000,
  /** Zwei Krafteinheiten am selben Tag. */
  alreadyTaken: 800,
  /** Ein Tag in der Vergangenheit. */
  inThePast: 400,
  /** Oberkörper am Tag vor dem Spiel. */
  dayBeforeMatch: 120,
  /** Auf dem Mannschaftstraining drauf. */
  onTeamTraining: 60,
  /** Direkt neben einer anderen Krafteinheit. */
  adjacentSession: 30,
  /** Direkt vor dem Mannschaftstraining. */
  beforeTeamTraining: 25,
});

const isLegSession = (session) =>
  session.blocks.some((b) => b.exercises.some((e) => EXERCISES[e.id]?.loadsLegs));

/* ─── Welche Einheit steht an diesem Tag? ────────────────────────────────── */

/**
 * Einheit für einen Tag: Verschiebung zuerst, sonst der Wochentag aus dem Plan.
 *
 * `'none'` in `state.schedule` heißt „hier ausdrücklich nichts" — das braucht
 * es, wenn eine Einheit weggeschoben wurde und der ursprüngliche Wochentag
 * nicht wieder von selbst eine Einheit anzeigen soll.
 */
export function sessionForDay(state, dayKey) {
  const override = state?.schedule?.[dayKey];
  if (override === NO_SESSION) return null;
  if (typeof override === 'string') return sessionById(override) ?? null;

  /* Ohne eigenen Eintrag gilt der Wochentag — es sei denn, dieselbe Einheit
     wurde in dieser Woche woandershin verschoben. Sonst stünde Push nach dem
     Verschieben zweimal in der Woche. */
  const planned = sessionForWeekday(weekdayOf(dayKey));
  if (!planned) return null;
  if (movedToInWeek(state, dayKey, planned.id) !== null) return null;
  return planned;
}

/** Wohin wurde diese Einheit in der Woche dieses Tages verschoben? Sonst null. */
export function movedToInWeek(state, anyDayKey, planId) {
  for (const key of weekKeys(anyDayKey)) {
    if (state?.schedule?.[key] === planId) return key;
  }
  return null;
}

/** Alle Einheiten der Woche mit dem Tag, an dem sie tatsächlich stehen. */
export function weekPlan(state, anyDayKey) {
  const keys = weekKeys(anyDayKey);
  return SESSIONS.map((session) => {
    const moved = movedToInWeek(state, anyDayKey, session.id);
    const dayKey = moved ?? keys.find((k) => weekdayOf(k) === session.weekday) ?? null;
    return {
      session,
      dayKey,
      isMoved: moved !== null,
      /** Der Tag, an dem sie laut Plan stehen würde. */
      plannedDayKey: keys.find((k) => weekdayOf(k) === session.weekday) ?? null,
    };
  });
}

/* ─── Bewertung eines Ausweichtags ───────────────────────────────────────── */

function describe(malus, reasons) {
  if (malus === Infinity) return reasons[0] ?? 'Geht nicht.';
  if (reasons.length === 0) return 'Freier Tag, nichts spricht dagegen.';
  return reasons.join(' ');
}

/**
 * Einen einzelnen Tag als Ziel bewerten.
 *
 * Gibt Malus UND Begründung zurück. Der Malus ordnet, die Begründung erklärt —
 * und nur mit beidem kann Flocke die Empfehlung überstimmen, wenn er einen
 * Grund hat, den die App nicht kennt.
 */
export function rateMoveTarget(state, planId, targetKey, { today = todayKey() } = {}) {
  const session = sessionById(planId);
  if (!session) throw new RangeError(`Unbekannte Einheit "${planId}".`);

  const profile = state?.profile ?? {};
  const allowance = legVolumeAllowance(targetKey, {
    matchDayWeekday: profile.matchDayWeekday,
    teamTrainingWeekdays: profile.teamTrainingWeekdays ?? [],
  });

  const legs = isLegSession(session);
  const reasons = [];
  let malus = 0;

  const blocked = (reason) => ({
    dayKey: targetKey,
    weekday: weekdayOf(targetKey),
    label: `${weekdayShort(targetKey)} ${formatDayShort(targetKey)}`,
    malus: PENALTY.blocked,
    possible: false,
    reason,
    allowance,
  });

  /* 1. Spieltag: für jede Einheit gesperrt. */
  if (allowance.daysUntilMatch === 0) {
    return blocked('Spieltag. Heute gehört alles dem Spiel.');
  }

  /* 2. Der Tag vor dem Spiel trennt nach Einheit — und das ist der Punkt, an
        dem eine gemeinsame Regel falsch wäre. Beinarbeit ist dort gesperrt,
        auch leichte. Drücken und Ziehen dagegen kosten die Beine nichts: das
        ist erlaubt, nur teuer, damit die Empfehlung es meidet, solange es
        Alternativen gibt.

        Vorher lief beides über dieselbe Sperre — und ein Pull-Training wurde
        am Samstag mit „die Beine gehören dem Spiel" abgelehnt. Die Begründung
        hatte mit der Einheit nichts zu tun. */
  if (allowance.daysUntilMatch === 1) {
    if (legs) {
      return blocked('Morgen ist Spiel. Beinarbeit fällt aus, auch leichte.');
    }
    malus += PENALTY.dayBeforeMatch;
    reasons.push('Morgen ist Spiel. Oberkörper geht, aber nichts, was müde macht.');
  }

  /* 3. Der Beintag braucht Abstand zum Spiel. Ohne den ist es kein Beintag. */
  if (legs && allowance.level !== 'heavy') {
    malus += PENALTY.legsWithoutRoom;
    reasons.push(allowance.reason);
  }

  /* 4. Steht dort schon eine andere Einheit? */
  const occupant = sessionForDay(state, targetKey);
  if (occupant && occupant.id !== planId) {
    malus += PENALTY.alreadyTaken;
    reasons.push(`Dort liegt schon ${occupant.name}. Zwei Einheiten an einem Tag `
      + 'heißt in der Praxis: die zweite fällt aus.');
  }

  /* 5. Mannschaftstraining */
  const teamDays = profile.teamTrainingWeekdays ?? [];
  const weekday = weekdayOf(targetKey);
  if (teamDays.includes(weekday)) {
    malus += PENALTY.onTeamTraining;
    reasons.push('Am Mannschaftstraining wird das ein langer Tag.');
  }
  if (teamDays.includes((weekday + 1) % 7)) {
    malus += PENALTY.beforeTeamTraining;
    reasons.push('Morgen ist Mannschaftstraining.');
  }

  /* 6. Nachbarschaft zu den anderen Krafteinheiten — Erholung braucht Abstand.
        Über Tagesschlüssel gerechnet, nicht über Wochentagsnummern: Samstag
        und Sonntag hätten dort den Abstand 6 statt 1. */
  const neighbours = weekPlan(state, targetKey)
    .filter((entry) => entry.session.id !== planId && entry.dayKey)
    .filter((entry) => Math.abs(daysBetween(entry.dayKey, targetKey)) === 1);
  if (neighbours.length > 0) {
    malus += PENALTY.adjacentSession * neighbours.length;
    reasons.push(`Direkt neben ${neighbours.map((n) => n.session.name).join(' und ')}.`);
  }

  /* 7. Vergangenheit. Möglich (Nachtragen), aber nie eine Empfehlung. */
  if (targetKey < today) {
    malus += PENALTY.inThePast;
    reasons.push('Liegt in der Vergangenheit.');
  }

  /* 8. Feinschliff: mehr Abstand zum Spiel ist besser. Entscheidet nur bei
        Gleichstand, deshalb ein einstelliger Betrag. */
  malus += Math.max(0, 4 - allowance.daysUntilMatch);

  return {
    dayKey: targetKey,
    weekday,
    label: `${weekdayShort(targetKey)} ${formatDayShort(targetKey)}`,
    malus,
    possible: true,
    reason: describe(malus, reasons),
    allowance,
  };
}

/**
 * Alle Tage der Woche als Ausweichziel, bester zuerst.
 *
 * Der aktuelle Tag der Einheit fällt weg — ihn „auszuwählen" wäre keine
 * Verschiebung.
 */
export function moveTargets(state, planId, fromKey, options = {}) {
  return weekKeys(fromKey)
    .filter((key) => key !== fromKey)
    .map((key) => rateMoveTarget(state, planId, key, options))
    .sort((a, b) => a.malus - b.malus || a.dayKey.localeCompare(b.dayKey));
}

/**
 * Die Empfehlung: bester möglicher Tag, oder null.
 *
 * `null` ist ein gültiges Ergebnis und bedeutet: in dieser Woche gibt es
 * keinen brauchbaren Ausweichtag. Dann ist die ehrliche Antwort „lass die
 * Einheit ausfallen", nicht ein Tag, der alles kaputt macht.
 */
export function recommendMove(state, planId, fromKey, options = {}) {
  /* Schwelle ist die VERGANGENHEIT, nicht der belegte Tag: gestern nachtragen
     geht von Hand (Schritt 7 erlaubt es), aber empfohlen wird es nie — eine
     Empfehlung zeigt nach vorn. Alles ab dieser Schwelle (Vergangenheit,
     belegte Tage, Beine ohne Abstand) fällt damit automatisch raus. */
  const targets = moveTargets(state, planId, fromKey, options)
    .filter((t) => t.possible && t.malus < PENALTY.inThePast);
  if (targets.length === 0) return null;

  const best = targets[0];
  const session = sessionById(planId);

  /* Der beste Tag ist nicht immer ein guter Tag. Trägt er noch einen Einwand,
     wird der als Einwand gekennzeichnet — sonst liest sich „Direkt neben
     Beintag" unter der Überschrift „Empfehlung" wie ein Argument dafür. */
  const clean = best.malus <= 4;   // nur noch der Feinschliff aus Schritt 8
  return {
    ...best,
    headline: `${session.name} auf ${WEEKDAYS_LONG[best.weekday]}`,
    isClean: clean,
    detail: clean
      ? 'Freier Tag, nichts spricht dagegen.'
      : `Bester verfügbarer Tag. Was dagegen spricht: ${best.reason}`,
  };
}

/**
 * Ist diese Einheit in der Woche schon erledigt?
 *
 * Gezählt wird an geloggten Sätzen, nicht am Startknopf: eine Einheit, bei der
 * nichts eingetragen wurde, hat nicht stattgefunden.
 */
export function sessionDoneInWeek(state, anyDayKey, planId) {
  for (const key of weekKeys(anyDayKey)) {
    const day = state?.days?.[key];
    const logged = (day?.sessions ?? []).find((s) => s.planId === planId);
    const sets = (logged?.exercises ?? [])
      .reduce((n, e) => n + (e.sets ?? []).filter(Boolean).length, 0);
    if (sets > 0) return key;
  }
  return null;
}
