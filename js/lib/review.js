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
 * DIE APP URTEILT SELBST. Hier standen einmal zehn Fragen fürs Monatsgespräch
 * und ein Markdown-Block zum Kopieren. Beides ist raus: ein Review, das erst
 * durch Tippen und einen Chat entsteht, findet am Monatsende nicht statt.
 * `overallVerdict` sagt stattdessen in einem Wort, ob es passt — aus denselben
 * Regeln, die auch die Befunde erzeugen, und mit denselben nachlesbaren
 * Schwellen.
 */

import {
  weekSummary, previousWeekSummary, monthSummary, compare,
  SHORT_SLEEP_H, LOW_READINESS,
} from './aggregate.js';
import {
  weekStartKey, addDays, formatDayShort, formatMonth, monthKey, addMonths,
  monthDays, todayKey,
} from './dates.js';
import { getDay, getWeekMacros, firstTrackedMonth } from './state.js';
import { EXERCISES } from '../../data/exercises.js';
import { SESSIONS, sessionExercises } from '../../data/plan-default.js';
import { DRIFT_THRESHOLD_KG, suggestKcalAdjustment } from './energy.js';

/* ─── Schwellen, alle an einer Stelle ────────────────────────────────────── */

export const THRESHOLDS = Object.freeze({
  /** Unter dieser Trefferquote gilt Protein als nicht erreicht. */
  proteinHitRate: 0.7,
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

/**
 * Zu welchem der vier Fenster gehört ein Befund?
 *
 * Das Review ist nach Themen sortiert — Gewicht, Essen, Training, Erholung —
 * und jeder Befund muss wissen, unter welcher Überschrift er steht. Sonst
 * bliebe nur die alte lange Liste, in der alles durcheinanderfällt.
 *
 * `data` ist der Auffangbehälter für Befunde ÜBER die Erfassung selbst. Die
 * gehören in keins der vier Fenster, sondern nach ganz oben: wenn zu wenig
 * erfasst ist, stehen alle anderen Urteile auf dünnem Eis.
 */
export const FLAG_TOPIC = Object.freeze({
  logging: 'data',
  'all-clear': 'data',
  'weight-drift': 'weight',
  protein: 'food',
  'deficit-cost': 'food',
  deload: 'training',
  stagnation: 'training',
  'sessions-missed': 'training',
  'sleep-low': 'recovery',
  'readiness-low-days': 'recovery',
  'readiness-avg-low': 'recovery',
  soreness: 'recovery',
});

/** Die vier Themen in Anzeigereihenfolge, mit Überschrift. */
export const TOPICS = Object.freeze([
  { key: 'weight', label: 'Gewicht' },
  { key: 'food', label: 'Essen' },
  { key: 'training', label: 'Training' },
  { key: 'recovery', label: 'Erholung' },
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const de = (v, d = 1) => (isNum(v) ? v.toLocaleString('de-DE',
  { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const pct = (v) => (isNum(v) ? `${Math.round(v * 100)} %` : '—');

/**
 * Ein Befund.
 *
 * Drei Längen für drei Orte: `short` steht als Stichpunkt im Themenfenster,
 * `detail` erklärt aufgeklappt die Zahlen dahinter, `action` sagt, was zu tun
 * ist. Eine Länge, die für alles herhalten muss, ist überall die falsche.
 *
 * `topic` kommt aus der Tabelle oben und nicht als Parameter: die Zuordnung
 * gehört an EINE Stelle, sonst muss man sie an zwölf Aufrufen nachpflegen.
 */
function flag(id, severity, title, short, detail, action = null) {
  return {
    id,
    severity,
    tone: SEVERITY_TONE[severity],
    topic: FLAG_TOPIC[id] ?? 'data',
    title, short, detail, action,
  };
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

/**
 * Kennzahlen eines Monats — live aus den Tagen, sonst aus dem Archiv.
 *
 * Nach dem Monatsabschluss sind die Tage verdichtet und gelöscht; ihre
 * Summary liegt dann in `state.months`. Ohne diesen Rückgriff wäre genau der
 * ausdrücklich unterstützte Fall „Review nachholen" (monthReviewDue, Zweig
 * `overdue`) immer leer: Kacheln ohne Zahlen, Fragen ohne Datenlage.
 */
function summaryFor(state, mk) {
  const live = monthSummary(state, mk);
  const counted = live.logging.daysWithCheckin + live.logging.daysWithWeight
    + live.logging.daysWithNutrition + live.logging.daysWithTraining;
  if (counted > 0) return live;

  /* Nur eine VOLLSTÄNDIGE archivierte Summary taugt als Ersatz — eine aus
     fremder Quelle könnte Teile vermissen, und dann ist die leere Live-Form
     der sicherere Boden als ein Absturz mitten im Review. */
  const archived = (state.months ?? []).find((m) => m.month === mk)?.summary;
  const complete = ['period', 'logging', 'weight', 'sleep', 'readiness',
    'soreness', 'nutrition', 'training', 'football']
    .every((part) => archived?.[part]);
  return complete ? archived : live;
}

/** Monats-Review inklusive Vergleich zum Vormonat. */
export function monthlyReview(state, mk) {
  const summary = summaryFor(state, mk);
  const previous = summaryFor(state, addMonths(mk, -1));
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

/* ─── Das Urteil über den ganzen Zeitraum ────────────────────────────────── */

/** Ab so vielen erfassten Tagen im Verhältnis zum Zeitraum trägt ein Urteil. */
export const VERDICT_MIN_COVERAGE = 0.5;

/**
 * Passt es? Ein Wort, ein Satz, höchstens drei Gründe.
 *
 * Das ist die Antwort, für die es früher zehn Fragen und ein Gespräch brauchte.
 * Sie wird nicht zusätzlich geraten, sondern aus dem zusammengesetzt, was
 * ohnehin schon geurteilt wird:
 *
 *   die BEFUNDE (buildFlags) — Schlaf, Protein, Bereitschaft, Deload …
 *   das VOLUMENURTEIL (volumeVerdict) — kam genug zusammen?
 *   das FORTSCHRITTSURTEIL (progressVerdict) — geht es voran?
 *
 * Die beiden letzten MÜSSEN mit hinein. Ohne sie stand hier ein grünes „Passt"
 * über einem Monat, in dem zwei Drittel der geplanten Sätze fehlten — die
 * Befunde allein kennen kein Volumen. Ein Urteil, das den größten Ausfall
 * nicht sieht, ist schlimmer als keins.
 *
 *   Eine schwere Sache → „Läuft schief".
 *   Eine leichte       → „Nachjustieren".
 *   Nichts davon       → „Passt".
 *
 * UND EIN VIERTER FALL, der über allem steht: zu wenig erfasst. Dann urteilt
 * die App NICHT. Ein grünes „passt" über acht erfassten Tagen wäre eine Lüge,
 * die sich gut anfühlt — und genau die Sorte Zahl, wegen der man einer App
 * irgendwann nicht mehr glaubt.
 *
 * @returns {{tone, word, headline, reasons, coverage, judged}}
 */
export function overallVerdict(review) {
  const s = review.summary;
  const days = Math.max(s.period.dayCount, 1);
  const logged = Math.max(s.logging.daysWithCheckin, s.logging.daysWithWeight);
  const coverage = logged / days;

  /* `level` 0 ist schwer, 1 ist leicht — dieselbe Rangfolge für Befunde und
     für die beiden Trainingsurteile, damit sie sich vergleichen lassen. */
  const concerns = review.flags
    .filter((f) => f.severity === 'alarm' || f.severity === 'warn')
    .map((f) => ({
      level: SEVERITY_ORDER[f.severity],
      title: f.title, short: f.short, tone: f.tone, topic: f.topic,
    }));

  for (const v of [volumeVerdict(s), progressVerdict(review)]) {
    if (v.tone !== 'bad' && v.tone !== 'ok') continue;
    concerns.push({
      level: v.tone === 'bad' ? 0 : 1,
      title: v.headline,
      short: v.detail,
      tone: v.tone,
      topic: 'training',
    });
  }

  /* Gar nicht trainiert ist kein „nichts zu bewerten", sondern der Befund
     selbst. volumeVerdict hält sich da bewusst zurück — es kann ein
     nachgetragener Zeitraum sein, und ein Urteil über null Sätze wäre dort
     eine Anmaßung. Das GESAMTURTEIL darf sich nicht so herausreden: eine
     Woche ohne einen einzigen Satz ist keine Woche, die passt. */
  if (s.training.sets === 0 && s.period.dayCount >= 7) {
    concerns.push({
      level: 0,
      title: 'Nicht trainiert',
      short: `Kein einziger Satz in ${s.period.dayCount} Tagen.`,
      tone: 'bad',
      topic: 'training',
    });
  }

  concerns.sort((a, b) => a.level - b.level);
  const reasons = concerns.slice(0, 3).map(({ level, ...rest }) => rest);

  if (coverage < VERDICT_MIN_COVERAGE) {
    return {
      tone: 'idle',
      word: 'Zu dünn',
      headline: `Nur ${logged} von ${days} Tagen haben Daten — dazu sage ich nichts.`,
      reasons,
      coverage,
      judged: false,
    };
  }

  if (concerns.some((c) => c.level === 0)) {
    return {
      tone: 'bad',
      word: 'Läuft schief',
      headline: concerns.length === 1
        ? 'Eine Sache läuft aus dem Ruder — die steht unten.'
        : `${concerns.length} Sachen laufen schief. Die wichtigste zuerst.`,
      reasons,
      coverage,
      judged: true,
    };
  }

  if (concerns.length > 0) {
    return {
      tone: 'ok',
      word: 'Nachjustieren',
      headline: concerns.length === 1
        ? 'Im Großen passt es, an einer Stelle nicht.'
        : `Im Großen passt es, an ${concerns.length} Stellen nicht.`,
      reasons,
      coverage,
      judged: true,
    };
  }

  return {
    tone: 'good',
    word: 'Passt',
    headline: 'Nichts läuft aus dem Ruder. Weitermachen.',
    reasons,
    coverage,
    judged: true,
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

/** Wochenschnitte, deren Montag in diesem Monat liegt. */
export function monthWeekAverages(state, mk) {
  if (typeof mk !== 'string') return [];
  const starts = new Set(
    monthDays(mk).map((key) => weekStartKey(key)).filter((start) => monthKey(start) === mk)
  );
  return [...starts].sort().map((weekStart) => ({
    weekStart,
    ...getWeekMacros(state, weekStart),
  }));
}

/* ─── Monats-Datensatz: der abgehakte Monat ──────────────────────────────── */

/** Format des Monats-Datensatzes. Unabhängig von der Schemaversion. */
export const MONTH_RECORD_VERSION = 1;

/**
 * Die Kennzahlen eines Monats, klein genug zum Behalten.
 *
 * Die volle Summary trägt Tagesreihen mit sich (Gewicht je Tag, Bereitschaft je
 * Tag). Die gehören in die Exportdatei — hier steht nur, was den Monat auf
 * einen Blick beschreibt.
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
 * Der Datensatz eines abgehakten Monats.
 *
 * Er hält fest, WAS war und WIE die App es beurteilt hat — Zahlen, Befunde,
 * stehende Übungen, Urteil. Früher standen hier auch zehn Fragen mit Flockes
 * Antworten; die sind raus, weil sie am Monatsende nicht beantwortet wurden.
 * Ein Ritual, das man auslässt, ist kein Ritual.
 *
 * `questions` bleibt als leeres Feld stehen: Datensätze aus der Zeit davor
 * tragen Antworten, und die dürfen beim Einlesen nicht durchs Raster fallen.
 */
export function buildMonthRecord(review, state, createdAt) {
  if (review.kind !== 'month') {
    throw new Error('Ein Monats-Datensatz braucht ein Monats-Review.');
  }
  const verdict = overallVerdict(review);
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
    verdict: { tone: verdict.tone, word: verdict.word, headline: verdict.headline },
    questions: [],
  };
}

