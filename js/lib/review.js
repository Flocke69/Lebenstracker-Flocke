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
import { weekStartKey, addDays, formatDayShort, formatMonth, monthKey, addMonths }
  from './dates.js';
import { getDay } from './state.js';
import { MUSCLE_GROUPS, EXERCISES } from '../../data/exercises.js';
import { SESSIONS, sessionExercises } from '../../data/plan-default.js';
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

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const de = (v, d = 1) => (isNum(v) ? v.toLocaleString('de-DE',
  { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const pct = (v) => (isNum(v) ? `${Math.round(v * 100)} %` : '—');

function flag(id, severity, title, detail, action = null) {
  return { id, severity, title, detail, action };
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
      `Nur ${logged} von ${summary.period.dayCount} Tagen haben Daten. `
      + 'Darunter ist keine Auswertung möglich — alles Weitere hier steht auf '
      + 'dünnem Eis.',
      'Check-in und Gewicht jeden Morgen, das dauert unter einer Minute.'));
  }

  /* Schlaf */
  if (isNum(summary.sleep.avg) && summary.sleep.avg < SHORT_SLEEP_H) {
    flags.push(flag('sleep-low', 'alarm',
      'Schlaf zu kurz',
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
      `${summary.readiness.lowDays} Tage unter ${LOW_READINESS} Punkten.`,
      'Wenn das keine Ausnahme ist, ist die Gesamtbelastung zu hoch — '
      + 'Fußball plus Gym plus Alltag, nicht nur das Gym.'));
  }

  if (isNum(summary.readiness.avg) && summary.readiness.avg < THRESHOLDS.readinessAvgLow) {
    flags.push(flag('readiness-avg-low', 'warn',
      'Bereitschaft dauerhaft niedrig',
      `Schnitt ${Math.round(summary.readiness.avg)} von 100.`,
      'Eine Woche Deload: gleiche Übungen, ein Satz weniger, RPE höchstens 6.'));
  }

  /* Muskelkater */
  if (isNum(summary.soreness.avg) && summary.soreness.avg > THRESHOLDS.sorenessAvg) {
    flags.push(flag('soreness', 'warn',
      'Dauerhafter Muskelkater',
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
