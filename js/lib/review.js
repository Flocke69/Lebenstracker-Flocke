/* Review — aus Kennzahlen werden Befunde und Empfehlungen.
 *
 * Regelbasiert, nicht statistisch. Jede Regel hat eine Schwelle, die man
 * nachlesen kann, und jeder Befund nennt die Zahl, aus der er entstanden ist.
 * Eine Empfehlung ohne Begründung ist ein Orakel; damit kann man nicht
 * arbeiten.
 *
 * Die App ändert nichts von allein. Sie schlägt vor, Flocke entscheidet —
 * insbesondere bei Kalorien. Ein Werkzeug, das die eigenen Ziele ohne
 * Rückfrage umschreibt, verliert das Vertrauen genau einmal.
 *
 * `toMarkdown` erzeugt den Block für das Gespräch mit Claude. Er enthält
 * bewusst auch die Rohzahlen: die tiefe Auswertung passiert dort, nicht hier.
 */

import {
  weekSummary, previousWeekSummary, monthSummary, compare,
  SHORT_SLEEP_H, LOW_READINESS, mean,
} from './aggregate.js';
import {
  weekStartKey, addDays, formatDayShort, formatMonth, monthKey, addMonths,
  monthDays, weekdayOf, todayKey, WEEKDAYS_LONG,
} from './dates.js';
import { getDay, getWeekMacros, firstTrackedMonth } from './state.js';
import { MUSCLE_GROUPS, EXERCISES } from '../../data/exercises.js';
import { SESSIONS, sessionById, sessionExercises } from '../../data/plan-default.js';
import { DRIFT_THRESHOLD_KG, suggestKcalAdjustment } from './energy.js';

/* ─── Schwellen, alle an einer Stelle ────────────────────────────────────── */

export const THRESHOLDS = Object.freeze({
  /** Unter dieser Trefferquote gilt Protein als nicht erreicht. */
  proteinHitRate: 0.7,
  /** Unter diesem Anteil des Proteinziels wird es deutlich. */
  proteinRatio: 0.85,
  /** Weniger erfasste Tage als das, und die Woche ist nicht auswertbar. */
  minLoggedDays: 5,
  /** Ab so vielen schlechten Tagen wird es ein Befund. */
  lowReadinessDays: 3,
  /** Bereitschaftsschnitt darunter heißt: zu viel Gesamtbelastung. */
  readinessAvgLow: 60,
  /** Steigt das Volumen so viele Wochen bei fallender Bereitschaft → Deload. */
  risingVolumeWeeks: 3,
  /** Muskelkater im Schnitt darüber ist ein Warnzeichen. */
  sorenessAvg: 3.5,
  /** Ab diesem Defizit wird bei fallender Bereitschaft gegengesteuert. */
  aggressiveDeficit: -400,
  /** So viele Wochen ohne Zuwachs gelten als Stillstand. */
  stagnationWeeks: 3,
});

const SEVERITY_ORDER = { alarm: 0, warn: 1, info: 2, good: 3 };

/** Statusfarbe je Dringlichkeit — dieselbe Zuordnung wie im ganzen UI. */
export const SEVERITY_TONE = Object.freeze({
  alarm: 'bad', warn: 'ok', info: 'idle', good: 'good',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const de = (v, d = 1) => (isNum(v) ? v.toLocaleString('de-DE',
  { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const pct = (v) => (isNum(v) ? `${Math.round(v * 100)} %` : '—');

/**
 * Ein Befund.
 *
 * `short` ist neu und der Grund dafür ist die Anzeige: das Review zeigt die
 * Befunde als kurze Stichpunktliste, nicht als sechs Karten mit je vier Sätzen.
 * Der lange `detail` und die `action` bleiben — sie gehen in den Kopierblock
 * fürs Gespräch und in den aufklappbaren Teil. Zwei Längen für zwei Zwecke,
 * statt einer Länge, die für beides falsch ist.
 */
function flag(id, severity, title, short, detail, action = null) {
  return { id, severity, tone: SEVERITY_TONE[severity], title, short, detail, action };
}

/* ─── Progression je Übung ───────────────────────────────────────────────── */

/**
 * Geschätzte Maximalkraft eines Satzes nach Epley: kg × (1 + Wdh / 30).
 *
 * Damit sind 10×20 kg und 5×24 kg vergleichbar — ohne das kann man nicht
 * sagen, ob Progression stattgefunden hat oder nur die Wiederholungszahl
 * gewechselt hat.
 */
export function estimatedMax(set) {
  if (!isNum(set?.reps) || !isNum(set?.kg) || set.kg <= 0) return null;
  return set.kg * (1 + set.reps / 30);
}

/** Bester Satz einer Übung in einem Zeitraum, als geschätzte Maximalkraft. */
export function bestEffort(state, keys, exId) {
  let best = null;
  for (const key of keys) {
    for (const session of getDay(state, key).sessions ?? []) {
      for (const entry of session.exercises ?? []) {
        if (entry.exId !== exId) continue;
        for (const set of entry.sets ?? []) {
          const value = estimatedMax(set);
          if (value !== null && (best === null || value > best)) best = value;
        }
      }
    }
  }
  return best;
}

/**
 * Übungen, die seit mehreren Wochen nicht vorangehen.
 *
 * Bewertet werden nur Übungen, die in den betrachteten Wochen tatsächlich
 * mehrfach vorkamen — eine Übung, die man zweimal gemacht hat, stagniert
 * nicht, sie hat einfach noch keine Geschichte.
 */
export function stagnatingExercises(state, endKey, weeks = THRESHOLDS.stagnationWeeks) {
  const starts = Array.from({ length: weeks }, (_, i) =>
    addDays(weekStartKey(endKey), (i - weeks + 1) * 7));

  const planned = new Set(SESSIONS.flatMap((s) => sessionExercises(s).map((e) => e.id)));
  const out = [];

  for (const exId of planned) {
    const perWeek = starts.map((start) =>
      bestEffort(state, Array.from({ length: 7 }, (_, i) => addDays(start, i)), exId));
    const known = perWeek.filter(isNum);
    if (known.length < weeks) continue;              // zu wenig Geschichte

    const first = known[0];
    const last = known[known.length - 1];
    if (last <= first * 1.005) {                     // unter 0,5 % ist Rauschen
      out.push({
        exId,
        name: EXERCISES[exId].name,
        weeks: known.length,
        from: first,
        to: last,
        perWeek,
      });
    }
  }
  return out;
}

/** Volumenverlauf einer Auswahl von Muskelgruppen über mehrere Wochen. */
export function volumeTrend(state, endKey, weeks = THRESHOLDS.risingVolumeWeeks + 1) {
  const starts = Array.from({ length: weeks }, (_, i) =>
    addDays(weekStartKey(endKey), (i - weeks + 1) * 7));
  return starts.map((start) => {
    const sum = weekSummary(state, start);
    return {
      weekStart: start,
      sets: sum.training.sets,
      readiness: sum.readiness.avg,
      volume: sum.training.volume,
    };
  });
}

/* ─── Regelwerk ──────────────────────────────────────────────────────────── */

/**
 * Befunde für einen Zeitraum.
 *
 * @param {object} summary Ergebnis von weekSummary/monthSummary
 * @param {object} previous Vorperiode, für Vergleiche (optional)
 * @param {object} context { profile, trend, stagnating }
 */
export function buildFlags(summary, previous, context = {}) {
  const flags = [];
  const p = context.profile ?? {};

  /* Erfassung zuerst: ohne Daten sind alle anderen Befunde wertlos. */
  const logged = Math.max(
    summary.logging.daysWithCheckin,
    summary.logging.daysWithWeight
  );
  if (logged < THRESHOLDS.minLoggedDays) {
    flags.push(flag('logging', 'warn',
      'Zu wenig erfasst',
      `nur ${logged} von ${summary.period.dayCount} Tagen mit Daten`,
      `Nur ${logged} von ${summary.period.dayCount} Tagen haben Daten. `
      + 'Darunter ist keine Auswertung möglich — alles Weitere hier steht auf '
      + 'dünnem Eis.',
      'Check-in und Gewicht jeden Morgen, das dauert unter einer Minute.'));
  }

  /* Schlaf */
  if (isNum(summary.sleep.avg) && summary.sleep.avg < SHORT_SLEEP_H) {
    flags.push(flag('sleep-low', 'alarm',
      'Schlaf zu kurz',
      `Ø ${de(summary.sleep.avg)} h, ${summary.sleep.nightsShort} kurze Nächte`,
      `Im Schnitt ${de(summary.sleep.avg)} Stunden, `
      + `${summary.sleep.nightsShort} von ${summary.sleep.nights} Nächten unter `
      + `${de(SHORT_SLEEP_H)}.`,
      'Schlaf ist der wirksamste Hebel, den du hast — vor Training und vor '
      + 'Ernährung. Eine Stunde früher ins Bett bringt mehr als jede '
      + 'Planänderung.'));
  }

  /* Bereitschaft */
  if (summary.readiness.lowDays >= THRESHOLDS.lowReadinessDays) {
    flags.push(flag('readiness-low-days', 'warn',
      'Mehrere schlechte Tage',
      `${summary.readiness.lowDays} Tage unter der Schwelle`,
      `${summary.readiness.lowDays} Tage unter ${LOW_READINESS} Punkten.`,
      'Wenn das keine Ausnahme ist, ist die Gesamtbelastung zu hoch — '
      + 'Fußball plus Gym plus Alltag, nicht nur das Gym.'));
  }

  if (isNum(summary.readiness.avg) && summary.readiness.avg < THRESHOLDS.readinessAvgLow) {
    flags.push(flag('readiness-avg-low', 'warn',
      'Bereitschaft dauerhaft niedrig',
      'im Schnitt zu niedrig — Deload fällig',
      `Schnitt ${Math.round(summary.readiness.avg)} von 100.`,
      'Eine Woche Deload: gleiche Übungen, ein Satz weniger, RPE höchstens 6.'));
  }

  /* Muskelkater */
  if (isNum(summary.soreness.avg) && summary.soreness.avg > THRESHOLDS.sorenessAvg) {
    flags.push(flag('soreness', 'warn',
      'Dauerhafter Muskelkater',
      `Ø ${de(summary.soreness.avg)} von 5`,
      `Im Schnitt ${de(summary.soreness.avg)} von 5.`,
      'Das spricht für zu viel Volumen oder zu wenig Protein — beides prüfen, '
      + 'bevor das Training weiter erhöht wird.'));
  }

  /* Protein */
  if (isNum(summary.nutrition.proteinHitRate)
      && summary.nutrition.proteinHitRate < THRESHOLDS.proteinHitRate) {
    const severity = isNum(p.kcalOffset) && p.kcalOffset <= THRESHOLDS.aggressiveDeficit
      ? 'alarm' : 'warn';
    flags.push(flag('protein', severity,
      'Protein zu oft verfehlt',
      `nur an ${summary.nutrition.proteinHits} von ${summary.nutrition.proteinCompared} `
      + 'Tagen erreicht',
      `Nur an ${summary.nutrition.proteinHits} von ${summary.nutrition.proteinCompared} `
      + `erfassten Tagen erreicht (${pct(summary.nutrition.proteinHitRate)}).`,
      severity === 'alarm'
        ? 'Im Defizit entscheidet Protein darüber, ob du Fett verlierst oder '
          + 'Fett und Muskeln. Das ist gerade die wichtigste Zahl überhaupt.'
        : 'Protein zuerst planen, der Rest des Tages ordnet sich danach.'));
  }

  /* Gewichtsdrift */
  if (isNum(summary.weight.delta) && Math.abs(summary.weight.delta) > DRIFT_THRESHOLD_KG) {
    const vorschlag = suggestKcalAdjustment(summary.weight.delta, p.kcalOffset ?? 0);
    const gewollt = isNum(p.kcalOffset) && p.kcalOffset < 0 && summary.weight.delta < 0;
    flags.push(flag('weight-drift', gewollt ? 'good' : 'info',
      gewollt ? 'Gewicht läuft wie geplant' : 'Gewicht driftet',
      `${summary.weight.delta > 0 ? '+' : ''}${de(summary.weight.delta)} kg im Schnitt`,
      `Der 7-Tage-Schnitt hat sich um ${de(summary.weight.delta)} kg verändert.`,
      gewollt
        ? `Bei ${Math.round(p.kcalOffset)} kcal Korrektur ist das der erwartete `
          + 'Verlauf. Nichts ändern.'
        : vorschlag.reason));
  }

  /* Trainingsvolumen steigend bei fallender Bereitschaft → Deload */
  const trend = context.trend ?? [];
  if (trend.length >= THRESHOLDS.risingVolumeWeeks) {
    const letzte = trend.slice(-THRESHOLDS.risingVolumeWeeks);
    const volumenSteigt = letzte.every((w, i) => i === 0 || w.sets > letzte[i - 1].sets);
    const bereitschaften = letzte.map((w) => w.readiness).filter(isNum);
    const bereitschaftFaellt = bereitschaften.length === letzte.length
      && bereitschaften.every((r, i) => i === 0 || r < bereitschaften[i - 1]);

    if (volumenSteigt && bereitschaftFaellt) {
      flags.push(flag('deload', 'alarm',
        'Deload fällig',
        `${THRESHOLDS.risingVolumeWeeks} Wochen mehr Volumen, weniger Bereitschaft`,
        `Das Volumen ist ${THRESHOLDS.risingVolumeWeeks} Wochen gestiegen `
        + `(${letzte.map((w) => w.sets).join(' → ')} Sätze), die Bereitschaft `
        + `gleichzeitig gefallen (${bereitschaften.map((r) => Math.round(r)).join(' → ')}).`,
        'Das ist das klarste Muster für Übererreichung. Nächste Woche: ein Satz '
        + 'weniger pro Übung, RPE höchstens 6. Danach geht es weiter nach oben.'));
    }
  }

  /* Aggressives Defizit plus fallende Bereitschaft */
  if (isNum(p.kcalOffset) && p.kcalOffset <= THRESHOLDS.aggressiveDeficit
      && previous && isNum(summary.readiness.avg) && isNum(previous.readiness.avg)
      && summary.readiness.avg < previous.readiness.avg - 5) {
    flags.push(flag('deficit-cost', 'warn',
      'Das Defizit kostet gerade Leistung',
      `Bereitschaft gefallen bei ${Math.round(p.kcalOffset)} kcal Korrektur`,
      `Bei ${Math.round(p.kcalOffset)} kcal Korrektur ist die Bereitschaft von `
      + `${Math.round(previous.readiness.avg)} auf ${Math.round(summary.readiness.avg)} `
      + 'gefallen.',
      'Ein Defizit dieser Größe ist neben laufender Saison sportlich teuer. '
      + 'Zwei Möglichkeiten: auf −300 zurück, oder das Defizit an Spiel- und '
      + 'Trainingstagen aussetzen.'));
  }

  /* Stagnation */
  const stagnating = context.stagnating ?? [];
  if (stagnating.length > 0) {
    flags.push(flag('stagnation', 'info',
      'Übungen ohne Fortschritt',
      `${stagnating.length} ${stagnating.length === 1 ? 'Übung' : 'Übungen'} `
      + `seit ${THRESHOLDS.stagnationWeeks} Wochen ohne Zuwachs`,
      stagnating.map((s) => s.name).join(', ')
      + ` — seit ${THRESHOLDS.stagnationWeeks} Wochen kein Zuwachs.`,
      'Erst prüfen, ob Schlaf und Protein stehen. Wenn ja: Wiederholungsbereich '
      + 'wechseln oder die Übung für einen Block tauschen.'));
  }

  /* Trainingsdisziplin */
  const geplant = SESSIONS.length * (summary.period.dayCount / 7);
  if (summary.logging.daysWithTraining > 0 && summary.logging.daysWithTraining < geplant - 0.5) {
    flags.push(flag('sessions-missed', 'info',
      'Einheiten ausgelassen',
      `${summary.logging.daysWithTraining} von ${Math.round(geplant)} Einheiten geloggt`,
      `${summary.logging.daysWithTraining} von ${Math.round(geplant)} geplanten `
      + 'Einheiten geloggt.',
      'Eine kurze Einheit ist besser als keine. Bei Zeitdruck den Hauptteil '
      + 'machen und die Armübungen weglassen — nicht umgekehrt.'));
  }

  /* Wenn nichts auffällt, sagt das Review das auch. */
  if (flags.filter((f) => f.severity !== 'good').length === 0
      && logged >= THRESHOLDS.minLoggedDays) {
    flags.push(flag('all-clear', 'good',
      'Nichts zu beanstanden',
      'Schlaf, Bereitschaft, Protein und Volumen im Rahmen',
      'Schlaf, Bereitschaft, Protein und Volumen liegen im Rahmen.',
      'Weiter so. Bei der nächsten Einheit einen Progressionsversuch wagen.'));
  }

  return flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/* ─── Reviews ────────────────────────────────────────────────────────────── */

/** Wochen-Review für die Woche, in der dieser Tag liegt. */
export function weeklyReview(state, anyDayKey) {
  const summary = weekSummary(state, anyDayKey);
  const previous = previousWeekSummary(state, anyDayKey);
  const trend = volumeTrend(state, anyDayKey);
  const stagnating = stagnatingExercises(state, anyDayKey);

  return {
    kind: 'week',
    title: `Woche ab ${formatDayShort(summary.period.start)}`,
    summary,
    previous,
    comparison: compare(summary, previous),
    trend,
    stagnating,
    flags: buildFlags(summary, previous, { profile: state.profile, trend, stagnating }),
  };
}

/** Monats-Review inklusive Vergleich zum Vormonat. */
export function monthlyReview(state, mk) {
  const summary = monthSummary(state, mk);
  const previous = monthSummary(state, addMonths(mk, -1));
  const lastDay = summary.period.end;
  const trend = volumeTrend(state, lastDay, 5);
  const stagnating = stagnatingExercises(state, lastDay, 4);

  // Vormonate aus dem Archiv, für den Langzeitvergleich
  const archive = (state.months ?? []).map((m) => ({
    month: m.month,
    weightLast: m.summary?.weight?.last ?? null,
    readinessAvg: m.summary?.readiness?.avg ?? null,
    sets: m.summary?.training?.sets ?? null,
  }));

  return {
    kind: 'month',
    title: formatMonth(mk),
    month: mk,
    summary,
    previous,
    comparison: compare(summary, previous),
    trend,
    stagnating,
    archive,
    flags: buildFlags(summary, previous, { profile: state.profile, trend, stagnating }),
  };
}

/* ─── Ein Urteil statt einer Liste ───────────────────────────────────────── */

/** Innerhalb dieser Spanne um das geplante Volumen gilt der Zeitraum als passend. */
export const VOLUME_BAND = 0.15;

/**
 * Passt das Volumen? Eine Antwort, kein Balkenwald.
 *
 * Vorher stand hier eine Liste mit einem Balken je Muskelgruppe — zwölf Zeilen,
 * aus denen man sich die Antwort selbst zusammenrechnen musste. Die Frage lautet
 * aber nicht "wie viele Sätze hat der Trizeps bekommen", sondern "passt es".
 * Die Einzelwerte bleiben erreichbar, aber nicht mehr vorne.
 *
 * Gemessen wird gegen den PLAN, hochgerechnet auf die Länge des Zeitraums.
 *
 * @returns {{tone, headline, detail, ratio, actual, planned}}
 */
export function volumeVerdict(summary) {
  const planned = SESSIONS.reduce(
    (sum, s) => sum + sessionExercises(s).reduce((n, e) => n + e.sets, 0), 0
  ) * (summary.period.dayCount / 7);
  const actual = summary.training.sets;

  if (planned <= 0) {
    return { tone: 'idle', headline: 'Kein Plan', detail: '', ratio: null, actual, planned: 0 };
  }
  if (actual === 0) {
    return {
      tone: 'idle',
      headline: 'Nichts geloggt',
      detail: 'Ohne geloggte Sätze gibt es nichts zu bewerten.',
      ratio: 0, actual, planned,
    };
  }

  const ratio = actual / planned;
  const rounded = Math.round(planned);

  if (Math.abs(ratio - 1) <= VOLUME_BAND) {
    return {
      tone: 'good',
      headline: 'Volumen passt',
      detail: `${actual} von rund ${rounded} geplanten Sätzen — genau im Rahmen.`,
      ratio, actual, planned,
    };
  }
  if (ratio < 1) {
    return {
      tone: ratio >= 0.7 ? 'ok' : 'bad',
      headline: 'Volumen zu niedrig',
      detail: `${actual} von rund ${rounded} geplanten Sätzen. `
        + `${Math.round((1 - ratio) * 100)} % fehlen.`,
      ratio, actual, planned,
    };
  }
  return {
    tone: ratio <= 1.35 ? 'ok' : 'bad',
    headline: 'Volumen über Plan',
    detail: `${actual} statt rund ${rounded} Sätzen. Mehr ist nicht automatisch `
      + 'besser — entscheidend ist, ob die Bereitschaft mithält.',
    ratio, actual, planned,
  };
}

/**
 * Geht es voran? Ebenfalls eine Antwort.
 *
 * Gemessen an den Übungen, die überhaupt eine Geschichte haben: eine Übung, die
 * zweimal vorkam, stagniert nicht — sie hat noch keine Geschichte. Ohne diese
 * Unterscheidung wäre jeder erste Monat ein Stillstand.
 *
 * @returns {{tone, headline, detail, stagnating, tracked}}
 */
export function progressVerdict(review) {
  const stagnating = review.stagnating ?? [];
  const tracked = new Set(SESSIONS.flatMap((s) => sessionExercises(s).map((e) => e.id))).size;

  if (review.summary.training.sets === 0) {
    return {
      tone: 'idle',
      headline: 'Noch kein Fortschritt messbar',
      detail: 'Dafür braucht es dieselbe Übung an mehreren Wochen.',
      stagnating: 0, tracked,
    };
  }
  if (stagnating.length === 0) {
    return {
      tone: 'good',
      headline: 'Es geht voran',
      detail: 'Keine Übung steht seit Wochen still.',
      stagnating: 0, tracked,
    };
  }
  const share = stagnating.length / Math.max(tracked, 1);
  return {
    tone: share <= 0.25 ? 'ok' : 'bad',
    headline: stagnating.length === 1 ? 'Eine Übung steht' : `${stagnating.length} Übungen stehen`,
    detail: stagnating.map((s) => s.name).join(', ')
      + '. Erst Schlaf und Protein prüfen, dann den Wiederholungsbereich wechseln.',
    stagnating: stagnating.length, tracked,
  };
}

/* ─── Rückmeldung in der App ─────────────────────────────────────────────── */

/**
 * Was die App aus Zahlen UND Antworten macht.
 *
 * Zwei Dinge, die diese Funktion NICHT tut, und beides mit Absicht:
 *
 *   Sie liest die Freitext-Antworten nicht aus. Sie kann es nicht, und so zu
 *   tun als ob wäre die schlimmere Variante — eine App, die auf "Handy lag im
 *   Bett" mit einer allgemeinen Schlafhygiene-Predigt antwortet, wird nach dem
 *   zweiten Monat nicht mehr gelesen. Was sie tut: die Antwort auf die letzte
 *   Frage WÖRTLICH zurückgeben, weil das die Entscheidung des Monats ist.
 *
 *   Sie ändert nichts. Kalorienziel und Plan bleiben, wo sie sind.
 *
 * Die Fragen kommen als Parameter herein, nicht aus `review`: sie hängen am
 * Zustand (reviewQuestions braucht ihn), und diese Funktion soll ohne Zustand
 * prüfbar bleiben.
 *
 * @returns {{ready, tone, headline, points, decision, missing}}
 */
export function reviewFeedback(review, questions = [], answers = {}) {
  const answered = questions.filter((q) => String(answers[q.id] ?? '').trim() !== '');
  const missing = questions.length - answered.length;

  const volume = volumeVerdict(review.summary);
  const progress = progressVerdict(review);

  /* Die Prioritäten kommen aus den Befunden, schärfste zuerst — aber höchstens
     drei. Eine Liste mit sieben Prioritäten hat keine. */
  const points = review.flags
    .filter((f) => f.severity === 'alarm' || f.severity === 'warn')
    .slice(0, 3)
    .map((f) => ({ tone: f.tone, title: f.title, text: f.action ?? f.detail }));

  if (points.length < 3 && volume.tone !== 'good' && volume.tone !== 'idle') {
    points.push({ tone: volume.tone, title: volume.headline, text: volume.detail });
  }
  if (points.length < 3 && progress.tone === 'bad') {
    points.push({ tone: progress.tone, title: progress.headline, text: progress.detail });
  }
  if (points.length === 0) {
    points.push({
      tone: 'good',
      title: 'Nichts dringend',
      text: 'Weiter wie bisher und bei der nächsten Einheit einen '
        + 'Progressionsversuch wagen.',
    });
  }

  const decision = String(answers.next ?? '').trim();

  if (answered.length === 0) {
    return {
      ready: false,
      tone: 'idle',
      headline: 'Erst die Fragen',
      points: [],
      decision: '',
      missing,
    };
  }

  return {
    ready: true,
    tone: points[0].tone,
    headline: missing === 0
      ? 'Alle zehn beantwortet — das sagen die Zahlen dazu'
      : `${answered.length} von ${questions.length} beantwortet — das sagen die Zahlen`,
    points,
    decision,
    missing,
  };
}

/* ─── Wann ist ein Monats-Review fällig? ─────────────────────────────────── */

/**
 * Steht ein Monats-Review an?
 *
 * Zwei Fälle, und der zweite ist der wichtigere:
 *
 *   Am LETZTEN TAG des Monats — da ist der Monat vollständig und noch nicht
 *   weggeräumt. Das ist der richtige Moment, und er ist genau einen Tag lang.
 *
 *   DANACH, solange kein Review vorliegt. Wer am 31. keine Zeit hatte, soll
 *   nicht durchs Raster fallen. Ein Review, das nur an einem einzigen Tag
 *   möglich ist, findet in der Praxis nie statt.
 *
 * @returns {{due: boolean, month: string|null, kind: string, text: string}}
 */
export function monthReviewDue(state, today = todayKey()) {
  const has = (mk) => (state?.reviews ?? []).some((r) => r.month === mk);
  const thisMonth = monthKey(today);
  const days = monthDays(thisMonth);
  const isLastDay = today === days[days.length - 1];
  /* Vor dem ersten erfassten Monat wird nichts verlangt. Ohne diese Grenze
     würde ein gelöschter Monat weiter nach einem Review fragen, das es zu
     nichts mehr gäbe. */
  const floor = firstTrackedMonth(state, today);

  if (isLastDay && !has(thisMonth)) {
    return {
      due: true,
      month: thisMonth,
      kind: 'today',
      text: `Heute ist der letzte Tag im ${formatMonth(thisMonth)}. `
        + 'Guter Moment für das Monats-Review — der Monat ist vollständig.',
    };
  }

  /* Der Vormonat, wenn er Daten trägt und noch kein Review hat. Geprüft wird
     an Tagen ODER an einer Monats-Summary: nach dem Abschluss sind die Tage
     verdichtet und weg, das Review fehlt aber trotzdem noch. */
  const previous = addMonths(thisMonth, -1);
  const hasDays = Object.keys(state?.days ?? {}).some((k) => monthKey(k) === previous);
  const hasSummary = (state?.months ?? []).some((m) => m.month === previous);

  if (previous >= floor && (hasDays || hasSummary) && !has(previous)) {
    return {
      due: true,
      month: previous,
      kind: 'overdue',
      text: `Für ${formatMonth(previous)} steht das Review noch aus. `
        + 'Solange es fehlt, hat der Monat Zahlen, aber keine Erklärung.',
    };
  }

  return { due: false, month: null, kind: 'none', text: '' };
}

/* ─── Die zehn Fragen fürs Monatsgespräch ────────────────────────────────── */

/**
 * Genau zehn Fragen, aus den Zahlen des Monats gebaut.
 *
 * Warum zehn und nicht "so viele wie auffällig ist": eine feste Zahl macht das
 * Gespräch planbar. Zehn Fragen sind in einer Viertelstunde beantwortet, und
 * ein Monatsreview, das eine Viertelstunde dauert, findet auch im zweiten Jahr
 * noch statt.
 *
 * Die Fragen sind DATENGETRIEBEN, nicht generisch. "Wie war dein Schlaf?" ist
 * keine Frage, sondern eine Floskel. "Du lagst im Schnitt bei 6,1 Stunden und
 * hattest 14 Nächte unter 6,5 — was hält dich abends auf?" ist eine.
 *
 * `id` ist stabil, damit Antworten aus einem früheren Monat zuordenbar bleiben,
 * auch wenn sich der Fragetext ändert.
 *
 * @returns {Array<{id, topic, question, context}>} immer genau zehn
 */
export function reviewQuestions(review, state = {}) {
  const s = review.summary;
  const c = review.comparison;
  const p = state.profile ?? {};
  const out = [];

  const ask = (id, topic, question, context) => out.push({ id, topic, question, context });

  /* 1. Schlaf. Steht immer an erster Stelle — er ist der Hebel, der auf alles
        andere durchschlägt. */
  if (isNum(s.sleep.avg) && s.sleep.avg < 7) {
    ask('sleep', 'Schlaf',
      'Was hält dich abends auf?',
      `Ø ${de(s.sleep.avg)} h, ${s.sleep.nightsShort} von ${s.sleep.nights} Nächten `
      + `unter ${de(SHORT_SLEEP_H)} h. Kürzeste Nacht ${de(s.sleep.min)} h.`);
  } else {
    ask('sleep', 'Schlaf',
      'Was hat beim Schlaf funktioniert, das du halten willst?',
      `Ø ${de(s.sleep.avg)} h — das ist die Grundlage, auf der alles andere steht.`);
  }

  /* 2. Bereitschaft: das Gesamturteil des Monats über die Belastung. */
  ask('load', 'Belastung',
    s.readiness.lowDays >= 5
      ? 'An den schlechten Tagen — war das Fußball, Gym, Arbeit oder Schlaf?'
      : 'Wie hat sich der Monat körperlich angefühlt, unabhängig von den Zahlen?',
    `${s.readiness.lowDays} von ${s.readiness.days} erfassten Tagen unter der `
    + `Schwelle${isNum(c.readiness) ? `, gegenüber dem Vormonat ${c.readiness > 0 ? '+' : ''}${Math.round(c.readiness)}` : ''}.`);

  /* 3. Gewicht gegen ABSICHT — nicht gegen null.
        Ein Kilo weniger ist bei −500 kcal ein Erfolg und bei Erhaltung eine
        Drift. Ohne den eingestellten Offset ist die Zahl nicht zu bewerten,
        und die Frage danach wäre eine Floskel. */
  const drift = isNum(s.weight.delta) ? s.weight.delta : null;
  const moving = drift !== null && Math.abs(drift) > DRIFT_THRESHOLD_KG;
  const offset = isNum(p.kcalOffset) ? p.kcalOffset : 0;
  const wantsDown = offset < 0;
  const wantsUp = offset > 0;

  let weightQuestion;
  if (moving && ((wantsDown && drift < 0) || (wantsUp && drift > 0))) {
    weightQuestion = 'Das Gewicht läuft wie geplant. Wie fühlt es sich an — '
      + 'Leistung, Hunger, Laune?';
  } else if (moving) {
    weightQuestion = 'Der Gewichtstrend läuft anders als eingestellt — '
      + 'war das so gewollt?';
  } else if (wantsDown || wantsUp) {
    weightQuestion = 'Trotz Korrektur bewegt sich nichts. Wo steckt die Lücke — '
      + 'Wochenende, Getränke, Portionen?';
  } else {
    weightQuestion = 'Das Gewicht steht. Willst du das weiter so, oder soll '
      + 'sich etwas bewegen?';
  }

  ask('weight', 'Gewicht', weightQuestion,
    `7-Tage-Schnitt ${de(s.weight.first)} → ${de(s.weight.last)} kg `
    + `(${drift !== null ? `${drift > 0 ? '+' : ''}${de(drift)}` : '—'} kg) `
    + `bei Ziel ${offset !== 0 ? `${offset > 0 ? '+' : ''}${offset} kcal` : 'Erhaltung'}.`);

  /* 4. Ernährung: der Wochenschnitt aus Yazio ist die maßgebliche Zahl. */
  const weekAverages = monthWeekAverages(state, review.month ?? monthKey(s.period.start));
  const kcalWeeks = weekAverages.filter((w) => isNum(w.kcal));
  ask('nutrition', 'Ernährung',
    kcalWeeks.length === 0
      ? 'Es liegt kein Wochenschnitt vor — woran hat es gehakt?'
      : 'Wie schwer war es, den Wochenschnitt zu treffen?',
    kcalWeeks.length === 0
      ? 'In keiner Woche des Monats wurden die Yazio-Zahlen eingetragen.'
      : `${kcalWeeks.length} ${kcalWeeks.length === 1 ? 'Woche' : 'Wochen'} erfasst: `
        + `${kcalWeeks.map((w) => Math.round(w.kcal)).join(', ')} kcal.`);

  /* 5. Protein: im Defizit die Zahl, an der alles hängt. */
  ask('protein', 'Protein',
    'Wo verlierst du Protein — Frühstück, unterwegs, abends?',
    isNum(s.nutrition.proteinAvg)
      ? `Ø ${Math.round(s.nutrition.proteinAvg)} g pro Tag, erreicht an `
        + `${s.nutrition.proteinHits} von ${s.nutrition.proteinCompared} erfassten Tagen.`
      : 'Keine Tageswerte erfasst — der Wochenschnitt aus Yazio trägt das.');

  /* 6. Disziplin: wie viele Einheiten sind tatsächlich passiert. */
  const geplant = Math.round(SESSIONS.length * (s.period.dayCount / 7));
  ask('sessions', 'Einheiten',
    s.logging.daysWithTraining < geplant
      ? 'Welche Einheit fällt am häufigsten aus, und warum genau die?'
      : 'Was hat es leicht gemacht, jede Einheit zu machen?',
    `${s.logging.daysWithTraining} von ${geplant} geplanten Einheiten geloggt, `
    + `${s.training.sets} Sätze insgesamt.`);

  /* 7. Verschiebungen: die App weiß, DASS verschoben wurde, nie warum. */
  const moves = monthMoves(state, review.month ?? monthKey(s.period.start));
  ask('moves', 'Verschiebungen',
    moves.length === 0
      ? 'Der Plan hat gehalten — passt die Wochenstruktur weiter zu deinem Alltag?'
      : 'Was war der Grund für die Verschiebungen?',
    moves.length === 0
      ? 'Keine Einheit verschoben.'
      : moves.map((m) => `${m.sessionName} → ${WEEKDAYS_LONG[weekdayOf(m.dayKey)]} `
        + `(${formatDayShort(m.dayKey)})`).join(', ') + '.');

  /* 8. Progression: wo geht es nicht voran. */
  ask('progress', 'Progression',
    review.stagnating.length > 0
      ? 'Bei diesen Übungen geht nichts voran — Technik, Kopf oder Erschöpfung?'
      : 'Bei welcher Übung hast du den größten Sprung gemerkt?',
    review.stagnating.length > 0
      ? review.stagnating.map((st) => `${st.name} ${de(st.from)} → ${de(st.to)} kg`).join(', ') + '.'
      : `Tonnage ${Math.round(s.training.tonnage).toLocaleString('de-DE')} kg`
        + `${isNum(c.tonnage) ? `, ${c.tonnage > 0 ? '+' : ''}${Math.round(c.tonnage)} kg zum Vormonat` : ''}.`);

  /* 9. Fußball: das eigentliche Ziel des ganzen Aufwands. */
  ask('football', 'Fußball',
    'Wie hast du dich auf dem Platz gefühlt — Sprints, Zweikämpfe, letzte 20 Minuten?',
    `${s.football.matches} ${s.football.matches === 1 ? 'Spiel' : 'Spiele'}, `
    + `${s.football.teamSessions} Mannschaftstrainings. `
    + `Muskelkater Ø ${de(s.soreness.avg)} von 5.`);

  /* 10. Immer dieselbe letzte Frage. Ein Review ohne Entscheidung ist ein
         Bericht. */
  ask('next', 'Nächster Monat',
    'Was ändert sich im nächsten Monat — genau eine Sache?',
    'Eine Änderung pro Monat lässt sich zuordnen. Drei gleichzeitig nicht.');

  return out;
}

/** Wochenschnitte, deren Montag in diesem Monat liegt. */
function monthWeekAverages(state, mk) {
  if (typeof mk !== 'string') return [];
  const starts = new Set(
    monthDays(mk).map((key) => weekStartKey(key)).filter((start) => monthKey(start) === mk)
  );
  return [...starts].sort().map((weekStart) => ({
    weekStart,
    ...getWeekMacros(state, weekStart),
  }));
}

/** Verschiebungen dieses Monats, ohne die „hier nichts"-Einträge. */
function monthMoves(state, mk) {
  if (typeof mk !== 'string') return [];
  return Object.entries(state.schedule ?? {})
    .filter(([key, planId]) => monthKey(key) === mk && planId && planId !== 'none')
    .map(([dayKey, planId]) => ({
      dayKey,
      planId,
      sessionName: sessionById(planId)?.name ?? planId,
    }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/* ─── Monats-Datensatz: kopieren und zurückimportieren ───────────────────── */

/** Format des Monats-Datensatzes. Unabhängig von der Schemaversion. */
export const MONTH_RECORD_VERSION = 1;

/** Kennung des Codeblocks, in dem der Datensatz steckt. */
export const MONTH_RECORD_FENCE = 'lebenstracker-monat';

/**
 * Die Kennzahlen eines Monats, klein genug zum Kopieren.
 *
 * Die volle Summary trägt Tagesreihen mit sich (Gewicht je Tag, Bereitschaft je
 * Tag). Die gehören in die Exportdatei, nicht in einen Block, den man in einen
 * Chat einfügt — sonst sind es dreißig Zeilen Zahlen, die niemand liest.
 */
export function compactSummary(summary) {
  const s = summary;
  return {
    period: { start: s.period.start, end: s.period.end, dayCount: s.period.dayCount },
    logging: { ...s.logging },
    weight: {
      first: s.weight.first, last: s.weight.last, delta: s.weight.delta,
      min: s.weight.min, max: s.weight.max, measured: s.weight.measured,
    },
    sleep: { ...s.sleep },
    readiness: {
      avg: s.readiness.avg, min: s.readiness.min,
      lowDays: s.readiness.lowDays, days: s.readiness.days,
    },
    soreness: { ...s.soreness },
    nutrition: { ...s.nutrition },
    training: {
      sessionCount: s.training.sessionCount,
      sets: s.training.sets,
      tonnage: s.training.tonnage,
      volume: Object.fromEntries(
        Object.entries(s.training.volume).filter(([, sets]) => sets > 0)
      ),
    },
    football: { ...s.football },
  };
}

/**
 * Der Datensatz, der kopiert und wieder eingelesen wird.
 *
 * Er enthält BEIDES: die Zahlen und die Antworten. Nur so ist ein Monat später
 * noch verwertbar — die Zahlen sagen, was passiert ist, die Antworten sagen,
 * warum.
 */
export function buildMonthRecord(review, state, answers = {}, createdAt) {
  if (review.kind !== 'month') {
    throw new Error('Ein Monats-Datensatz braucht ein Monats-Review.');
  }
  const questions = reviewQuestions(review, state);
  return {
    app: 'Lebenstracker',
    kind: 'monthReview',
    recordVersion: MONTH_RECORD_VERSION,
    month: review.month,
    createdAt: createdAt ?? null,
    profile: {
      kcalOffset: state?.profile?.kcalOffset ?? null,
      proteinPerKg: state?.profile?.proteinPerKg ?? null,
      fatPerKg: state?.profile?.fatPerKg ?? null,
    },
    summary: compactSummary(review.summary),
    flags: review.flags.map((f) => ({ id: f.id, severity: f.severity, title: f.title })),
    stagnating: review.stagnating.map((st) => ({ exId: st.exId, from: st.from, to: st.to })),
    questions: questions.map((q) => ({
      id: q.id,
      topic: q.topic,
      question: q.question,
      context: q.context,
      answer: answers[q.id] ?? null,
    })),
  };
}

/**
 * Aus einem eingefügten Text den Datensatz herausholen.
 *
 * Nimmt den Codeblock, rohes JSON oder einen Text, in dem irgendwo ein
 * JSON-Objekt steckt. Bewusst großzügig: was aus einem Chat kopiert wird, hat
 * gerne noch Text davor und danach, und daran soll ein Import nicht scheitern.
 *
 * Wirft mit lesbarer Begründung, statt undefined zurückzugeben — ein
 * fehlgeschlagener Import muss sagen, was fehlt.
 */
export function parseMonthRecord(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Da ist kein Text zum Einlesen.');
  }

  const fenced = new RegExp(`\`\`\`(?:${MONTH_RECORD_FENCE}|json)?\\s*([\\s\\S]*?)\`\`\``);
  const match = fenced.exec(text);
  let candidate = match ? match[1] : null;

  if (candidate === null) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last <= first) {
      throw new Error('In dem Text steckt kein Datensatz. Kopiere den Block, der '
        + `mit \`\`\`${MONTH_RECORD_FENCE} beginnt.`);
    }
    candidate = text.slice(first, last + 1);
  }

  let raw;
  try {
    raw = JSON.parse(candidate);
  } catch (err) {
    throw new Error(`Der Datensatz ist kein gültiges JSON: ${err.message}`);
  }

  if (raw?.app !== 'Lebenstracker' || raw?.kind !== 'monthReview') {
    throw new Error('Das ist kein Monats-Review aus dem Lebenstracker.');
  }
  if (!Number.isInteger(raw.recordVersion) || raw.recordVersion > MONTH_RECORD_VERSION) {
    throw new Error(
      `Der Datensatz hat Format ${raw.recordVersion}, diese App-Version kennt `
      + `höchstens ${MONTH_RECORD_VERSION}.`
    );
  }
  if (typeof raw.month !== 'string') {
    throw new Error('Im Datensatz fehlt die Monatsangabe.');
  }
  monthDays(raw.month);   // wirft bei Unsinn

  const answered = (raw.questions ?? []).filter((q) => q?.answer).length;
  return { record: raw, answered, questionCount: (raw.questions ?? []).length };
}

/**
 * Der Text zum Kopieren: erst lesbar, dann der Block zum Zurückimportieren.
 *
 * Die Reihenfolge ist Absicht. Oben steht, was ein Mensch (und ich im Gespräch)
 * lesen soll; der Datenblock steht unten, weil er nur für die App ist. Ein
 * Datensatz zuoberst würde jedes Gespräch mit dreißig Zeilen JSON eröffnen.
 */
export function monthRecordToText(record) {
  const s = record.summary;
  const L = [];

  L.push(`# Monats-Review — ${formatMonth(record.month)}`);
  L.push('');
  L.push(`Zeitraum ${s.period.start} bis ${s.period.end} (${s.period.dayCount} Tage)`);
  L.push('');

  L.push('## Die Zahlen');
  L.push(`- Gewicht: ${de(s.weight.first)} → ${de(s.weight.last)} kg `
       + `(${isNum(s.weight.delta) ? `${s.weight.delta > 0 ? '+' : ''}${de(s.weight.delta)}` : '—'} kg)`);
  L.push(`- Schlaf: Ø ${de(s.sleep.avg)} h, ${s.sleep.nightsShort} kurze Nächte`);
  L.push(`- Bereitschaft: Ø ${isNum(s.readiness.avg) ? Math.round(s.readiness.avg) : '—'}, `
       + `${s.readiness.lowDays} schlechte Tage`);
  L.push(`- Training: ${s.logging.daysWithTraining} Einheiten, ${s.training.sets} Sätze, `
       + `${Math.round(s.training.tonnage).toLocaleString('de-DE')} kg Tonnage`);
  L.push(`- Ernährung: Ø ${isNum(s.nutrition.kcalAvg) ? Math.round(s.nutrition.kcalAvg) : '—'} kcal, `
       + `Protein Ø ${isNum(s.nutrition.proteinAvg) ? Math.round(s.nutrition.proteinAvg) : '—'} g`);
  L.push(`- Fußball: ${s.football.matches} Spiele, ${s.football.teamSessions} Mannschaftstrainings`);
  L.push('');

  L.push('## Volumen je Muskelgruppe');
  const volume = Object.entries(s.training.volume).sort((a, b) => b[1] - a[1]);
  if (volume.length === 0) L.push('- nichts geloggt');
  for (const [key, sets] of volume) {
    L.push(`- ${MUSCLE_GROUPS[key] ?? key}: ${de(sets)} Sätze`);
  }
  L.push('');

  L.push('## Befunde der App');
  if (record.flags.length === 0) L.push('- keine');
  for (const f of record.flags) L.push(`- [${f.severity}] ${f.title}`);
  L.push('');

  L.push('## Die zehn Fragen');
  record.questions.forEach((q, i) => {
    L.push(`${i + 1}. **${q.question}** _(${q.topic})_`);
    L.push(`   Datenlage: ${q.context}`);
    L.push(`   Antwort: ${q.answer ? q.answer : '—'}`);
  });
  L.push('');

  L.push('---');
  L.push('Bitte schau dir das an: Was fällt dir auf, was die Regeln der App nicht');
  L.push('sehen können? Und was soll ich im nächsten Monat konkret anders machen?');
  L.push('');
  L.push('<!-- Der Block unten ist für die App. Zum Zurückimportieren mitkopieren. -->');
  L.push('');
  L.push('```' + MONTH_RECORD_FENCE);
  L.push(JSON.stringify(record, null, 2));
  L.push('```');

  return L.join('\n');
}

/* ─── Übergabe an Claude ─────────────────────────────────────────────────── */

function volumeLines(volume) {
  return Object.entries(volume)
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, sets]) => `- ${MUSCLE_GROUPS[key]}: ${de(sets)} Sätze`);
}

/**
 * Der Block für das Gespräch hier.
 *
 * Enthält absichtlich Rohzahlen und nicht nur die Befunde: die App kann nur
 * das erkennen, was vorher als Regel hineingeschrieben wurde. Muster wie
 * "die schlechten Nächte liegen immer donnerstags" fallen ihr nicht auf —
 * mir schon, wenn ich die Zahlen sehe.
 */
export function toMarkdown(review, state) {
  const s = review.summary;
  const c = review.comparison;
  const p = state?.profile ?? {};
  const L = [];

  L.push(`# ${review.kind === 'week' ? 'Wochen' : 'Monats'}-Review — ${review.title}`);
  L.push('');
  L.push(`Zeitraum: ${s.period.start} bis ${s.period.end} (${s.period.dayCount} Tage)`);
  L.push('');

  L.push('## Einstellungen');
  L.push(`- Ziel: ${isNum(p.kcalOffset) && p.kcalOffset !== 0
    ? `${p.kcalOffset > 0 ? '+' : ''}${p.kcalOffset} kcal` : 'Erhaltung'}`);
  if ((p.offsetExemptDayTypes ?? []).length) {
    L.push(`- Korrektur ausgesetzt an: ${p.offsetExemptDayTypes.join(', ')}`);
  }
  L.push(`- Protein: ${de(p.proteinPerKg, 1)} g/kg, Fett ${de(p.fatPerKg, 1)} g/kg`);
  L.push('');

  L.push('## Erfassung');
  L.push(`- Check-in: ${s.logging.daysWithCheckin}/${s.period.dayCount} Tage`);
  L.push(`- Gewicht: ${s.logging.daysWithWeight}/${s.period.dayCount}`);
  L.push(`- Ernährung: ${s.logging.daysWithNutrition}/${s.period.dayCount}`);
  L.push(`- Training: ${s.logging.daysWithTraining} `
       + `${s.logging.daysWithTraining === 1 ? 'Einheit' : 'Einheiten'}`);
  L.push('');

  L.push('## Körper und Befinden');
  L.push(`- Gewicht (7-Tage-Schnitt): ${de(s.weight.first)} → ${de(s.weight.last)} kg `
       + `(${isNum(s.weight.delta) ? `${s.weight.delta > 0 ? '+' : ''}${de(s.weight.delta)}` : '—'} kg)`);
  L.push(`- Spanne der Tageswerte: ${de(s.weight.min)} – ${de(s.weight.max)} kg`);
  L.push(`- Schlaf: Ø ${de(s.sleep.avg)} h, kürzeste ${de(s.sleep.min)} h, `
       + `${s.sleep.nightsShort} Nächte unter ${de(SHORT_SLEEP_H)} h`);
  L.push(`- Bereitschaft: Ø ${isNum(s.readiness.avg) ? Math.round(s.readiness.avg) : '—'}, `
       + `Minimum ${isNum(s.readiness.min) ? Math.round(s.readiness.min) : '—'}, `
       + `${s.readiness.lowDays} Tage unter ${LOW_READINESS}`);
  L.push(`- Muskelkater: Ø ${de(s.soreness.avg)} von 5`);
  if (isNum(c.readiness)) {
    L.push(`- Gegenüber der Vorperiode: Bereitschaft ${c.readiness > 0 ? '+' : ''}`
         + `${Math.round(c.readiness)}, Schlaf ${isNum(c.sleep) ? `${c.sleep > 0 ? '+' : ''}${de(c.sleep)} h` : '—'}`);
  }
  L.push('');

  L.push('## Ernährung');
  L.push(`- Kalorien: Ø ${isNum(s.nutrition.kcalAvg) ? Math.round(s.nutrition.kcalAvg) : '—'} `
       + `(Ziel Ø ${isNum(s.nutrition.targetKcalAvg) ? Math.round(s.nutrition.targetKcalAvg) : '—'})`);
  L.push(`- Kalorien getroffen: ${s.nutrition.kcalHits}/${s.nutrition.kcalCompared} `
       + `(${pct(s.nutrition.kcalHitRate)})`);
  L.push(`- Protein: Ø ${isNum(s.nutrition.proteinAvg) ? Math.round(s.nutrition.proteinAvg) : '—'} g, `
       + `erreicht an ${s.nutrition.proteinHits}/${s.nutrition.proteinCompared} Tagen`);

  /* Der Yazio-Wochenschnitt ist die maßgebliche Zahl, nicht die Tageswerte —
     deshalb steht er hier und nicht in einer Fußnote. */
  const weekStart = weekStartKey(s.period.start);
  const week = getWeekMacros(state ?? {}, weekStart);
  if ([week.kcal, week.proteinG, week.carbsG, week.fatG].some(isNum)) {
    L.push(`- Yazio-Wochenschnitt (Woche ab ${weekStart}): `
         + `${isNum(week.kcal) ? Math.round(week.kcal) : '—'} kcal, `
         + `${isNum(week.proteinG) ? Math.round(week.proteinG) : '—'} g Protein, `
         + `${isNum(week.carbsG) ? Math.round(week.carbsG) : '—'} g KH, `
         + `${isNum(week.fatG) ? Math.round(week.fatG) : '—'} g Fett`);
  }
  L.push('');

  L.push('## Training');
  L.push(`- Einheiten: ${s.logging.daysWithTraining}`);
  L.push(`- Sätze: ${s.training.sets}`
       + (isNum(c.sets) ? ` (${c.sets > 0 ? '+' : ''}${c.sets} zur Vorperiode)` : ''));
  L.push(`- Tonnage: ${Math.round(s.training.tonnage).toLocaleString('de-DE')} kg`);
  L.push('- Volumen je Muskelgruppe:');
  const lines = volumeLines(s.training.volume);
  L.push(...(lines.length ? lines : ['  - nichts geloggt']));
  L.push('');
  L.push(`- Fußball: ${s.football.matches} Spiel(e), ${s.football.teamSessions} Mannschaftstraining(s)`);
  L.push('');

  if (review.stagnating.length) {
    L.push('## Ohne Fortschritt');
    for (const st of review.stagnating) {
      L.push(`- ${st.name}: geschätzte Maximalkraft ${de(st.from)} → ${de(st.to)} kg `
           + `über ${st.weeks} Wochen`);
    }
    L.push('');
  }

  L.push('## Volumenverlauf');
  for (const w of review.trend) {
    L.push(`- ab ${w.weekStart}: ${w.sets} Sätze, Bereitschaft `
         + `${isNum(w.readiness) ? Math.round(w.readiness) : '—'}`);
  }
  L.push('');

  L.push('## Befunde der App');
  if (review.flags.length === 0) L.push('- keine');
  for (const f of review.flags) {
    L.push(`- **[${f.severity}] ${f.title}** — ${f.detail}`);
    if (f.action) L.push(`  Vorschlag: ${f.action}`);
  }
  L.push('');

  if (isNum(s.insights.sleepVsReadiness.difference)) {
    L.push('## Zusammenhang');
    const d = s.insights.sleepVsReadiness;
    L.push(`- Nach Nächten unter ${de(SHORT_SLEEP_H)} h lag die Bereitschaft im `
         + `Schnitt ${Math.round(Math.abs(d.difference))} Punkte `
         + `${d.difference < 0 ? 'niedriger' : 'höher'} `
         + `(${d.inGroup} kurze gegen ${d.outGroup} normale Nächte)`);
    L.push('');
  }

  if (review.archive?.length) {
    L.push('## Frühere Monate');
    for (const m of review.archive) {
      L.push(`- ${m.month}: Gewicht ${de(m.weightLast)} kg, Bereitschaft `
           + `${isNum(m.readinessAvg) ? Math.round(m.readinessAvg) : '—'}, ${m.sets ?? '—'} Sätze`);
    }
    L.push('');
  }

  L.push('---');
  L.push('Bitte schau dir das an: Was fällt dir auf, was die Regeln der App nicht '
       + 'sehen können? Was soll ich in der kommenden Woche konkret anders machen?');

  return L.join('\n');
}

/** Rohdaten der Tage — für tiefere Analysen im Gespräch. */
export function daysToMarkdown(state, keys) {
  const L = ['| Tag | kg | Schlaf | Bereit. | Kater | kcal | Protein | Sätze |',
             '|---|---|---|---|---|---|---|---|'];
  for (const key of keys) {
    const d = getDay(state, key);
    const sets = (d.sessions ?? [])
      .flatMap((s) => s.exercises ?? [])
      .reduce((n, e) => n + (e.sets ?? []).filter(Boolean).length, 0);
    L.push(`| ${key} | ${de(d.weightKg)} | ${de(d.checkin?.sleepHours)} | `
         + `${isNum(d.readiness) ? Math.round(d.readiness) : '—'} | `
         + `${d.checkin?.soreness ?? '—'} | ${d.nutrition?.kcal ?? '—'} | `
         + `${d.nutrition?.proteinG ?? '—'} | ${sets || '—'} |`);
  }
  return L.join('\n');
}
