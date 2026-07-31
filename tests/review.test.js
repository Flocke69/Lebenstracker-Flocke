import { suite, test, eq, close, deepEq, isTrue, isFalse } from './harness.js';
import { emptyState, withProfile, withDay, withSet } from '../js/lib/state.js';
import { addDays, weekStartKey } from '../js/lib/dates.js';
import { weekSummary } from '../js/lib/aggregate.js';
import {
  THRESHOLDS, estimatedMax, bestEffort, stagnatingExercises, volumeTrend,
  buildFlags, weeklyReview, monthlyReview,
} from '../js/lib/review.js';

const PROFILE = {
  sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
  matchDayWeekday: 0, teamTrainingWeekdays: [3], gymWeekdays: [1, 2, 4],
};
const base = () => withProfile(emptyState('2026-07'), PROFILE);
const MO = '2026-07-27';

/** Woche mit gleichmäßigen Werten füllen. */
function fillWeek(state, weekStart, { sleep = 8, readiness = 80, soreness = 2,
                                      kcal = 2200, protein = 180, weight = 80 } = {}) {
  let s = state;
  for (let i = 0; i < 7; i++) {
    s = withDay(s, addDays(weekStart, i), {
      weightKg: weight,
      checkin: { sleepHours: sleep, sleepQuality: 4, mood: 4, energy: 4, soreness, stress: 2 },
      readiness,
      nutrition: { kcal, proteinG: protein, carbsG: 200, fatG: 60 },
    });
  }
  return s;
}

const flagIds = (flags) => flags.map((f) => f.id);
const findFlag = (flags, id) => flags.find((f) => f.id === id);

suite('review — geschätzte Maximalkraft', () => {
  test('Epley: kg mal (1 + Wdh / 30)', () => {
    close(estimatedMax({ reps: 10, kg: 60 }), 60 * (1 + 10 / 30), 0.001);
    close(estimatedMax({ reps: 1, kg: 100 }), 100 * (1 + 1 / 30), 0.001);
  });

  test('macht verschiedene Wiederholungszahlen vergleichbar', () => {
    // Ohne das könnte man nicht sagen, ob 5x24 besser ist als 10x20.
    const zehnMal20 = estimatedMax({ reps: 10, kg: 20 });
    const fuenfMal24 = estimatedMax({ reps: 5, kg: 24 });
    isTrue(fuenfMal24 > zehnMal20, `${fuenfMal24} muss über ${zehnMal20} liegen`);
  });

  test('Sätze ohne Gewicht ergeben null statt 0', () => {
    eq(estimatedMax({ reps: 30, kg: null }), null);
    eq(estimatedMax({ reps: 30, kg: 0 }), null);
    eq(estimatedMax(null), null);
  });

  test('bestEffort findet den besten Satz im Zeitraum', () => {
    let s = base();
    s = withSet(s, MO, 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    s = withSet(s, MO, 'a-push', 'ohp_db', 1, { reps: 6, kg: 25 });
    const keys = [MO];
    close(bestEffort(s, keys, 'ohp_db'), 25 * (1 + 6 / 30), 0.001);
  });

  test('ohne Daten kommt null', () => {
    eq(bestEffort(base(), [MO], 'ohp_db'), null);
  });
});

suite('review — Stagnation', () => {
  function dreiWochen(gewichte) {
    let s = base();
    gewichte.forEach((kg, i) => {
      const tag = addDays(weekStartKey(MO), (i - gewichte.length + 1) * 7);
      s = withSet(s, tag, 'a-push', 'ohp_db', 0, { reps: 8, kg });
    });
    return s;
  }

  test('gleiches Gewicht über drei Wochen gilt als Stillstand', () => {
    const s = dreiWochen([25, 25, 25]);
    const out = stagnatingExercises(s, MO);
    isTrue(out.some((e) => e.exId === 'ohp_db'), `war: ${out.map((e) => e.exId)}`);
  });

  test('steigendes Gewicht ist kein Stillstand', () => {
    const s = dreiWochen([22.5, 25, 27.5]);
    isFalse(stagnatingExercises(s, MO).some((e) => e.exId === 'ohp_db'));
  });

  test('winzige Schwankungen gelten nicht als Fortschritt', () => {
    // 0,2 % Zuwachs ist Rauschen, kein Trainingsfortschritt.
    const s = dreiWochen([25, 25, 25.05]);
    isTrue(stagnatingExercises(s, MO).some((e) => e.exId === 'ohp_db'));
  });

  test('Übungen ohne genug Geschichte werden nicht bewertet', () => {
    // Zwei Wochen sind zu wenig, um von Stillstand zu sprechen.
    const s = dreiWochen([25, 25]);
    isFalse(stagnatingExercises(s, MO).some((e) => e.exId === 'ohp_db'));
  });
});

suite('review — Regelwerk', () => {
  test('zu wenig erfasste Tage wird zuerst gemeldet', () => {
    let s = base();
    s = withDay(s, MO, { weightKg: 80, readiness: 80 });
    const flags = weeklyReview(s, MO).flags;
    isTrue(flagIds(flags).includes('logging'), `war: ${flagIds(flags)}`);
    const f = findFlag(flags, 'logging');
    isTrue(f.detail.includes('1 von 7'), f.detail);
  });

  test('zu wenig Schlaf ist ein Alarm mit Zahl', () => {
    const s = fillWeek(base(), weekStartKey(MO), { sleep: 5.5 });
    const f = findFlag(weeklyReview(s, MO).flags, 'sleep-low');
    isTrue(Boolean(f), 'Befund fehlt');
    eq(f.severity, 'alarm');
    isTrue(f.detail.includes('5,5'), f.detail);
  });

  test('genug Schlaf löst keinen Befund aus', () => {
    const s = fillWeek(base(), weekStartKey(MO), { sleep: 8 });
    isFalse(flagIds(weeklyReview(s, MO).flags).includes('sleep-low'));
  });

  test('mehrere Tage unter 50 werden gemeldet', () => {
    let s = fillWeek(base(), weekStartKey(MO), { readiness: 80 });
    for (let i = 0; i < 3; i++) {
      s = withDay(s, addDays(weekStartKey(MO), i), { readiness: 40 });
    }
    isTrue(flagIds(weeklyReview(s, MO).flags).includes('readiness-low-days'));
  });

  test('dauerhaft niedrige Bereitschaft empfiehlt einen Deload', () => {
    const s = fillWeek(base(), weekStartKey(MO), { readiness: 55 });
    const f = findFlag(weeklyReview(s, MO).flags, 'readiness-avg-low');
    isTrue(Boolean(f));
    isTrue(f.action.toLowerCase().includes('deload'), f.action);
  });

  test('dauerhafter Muskelkater wird gemeldet', () => {
    const s = fillWeek(base(), weekStartKey(MO), { soreness: 4 });
    isTrue(flagIds(weeklyReview(s, MO).flags).includes('soreness'));
  });

  test('verfehltes Protein ist im Defizit ein Alarm, sonst eine Warnung', () => {
    const mager = fillWeek(base(), weekStartKey(MO), { protein: 80 });
    eq(findFlag(weeklyReview(mager, MO).flags, 'protein').severity, 'warn');

    const imDefizit = withProfile(mager, { kcalOffset: -500 });
    const f = findFlag(weeklyReview(imDefizit, MO).flags, 'protein');
    eq(f.severity, 'alarm', 'im Defizit wiegt Protein schwerer');
    isTrue(f.action.includes('Muskeln'), f.action);
  });

  test('geplanter Gewichtsverlust wird gelobt statt bemängelt', () => {
    // Wer absichtlich im Defizit ist, soll keine Warnung fuer fallendes
    // Gewicht bekommen -- das ist ja der Zweck.
    let s = withProfile(base(), { kcalOffset: -500 });
    s = fillWeek(s, weekStartKey(MO), { weight: 80 });
    for (let i = 4; i < 7; i++) {
      s = withDay(s, addDays(weekStartKey(MO), i), { weightKg: 78.5 });
    }
    const f = findFlag(weeklyReview(s, MO).flags, 'weight-drift');
    if (f) {
      eq(f.severity, 'good', `war: ${f.severity} — ${f.detail}`);
      isTrue(f.action.includes('Nichts ändern'), f.action);
    }
  });

  test('eine saubere Woche bekommt eine ausdrückliche Entwarnung', () => {
    const s = fillWeek(base(), weekStartKey(MO), {});
    const flags = weeklyReview(s, MO).flags;
    isTrue(flagIds(flags).includes('all-clear'), `war: ${flagIds(flags)}`);
  });

  test('Befunde sind nach Dringlichkeit sortiert', () => {
    const s = fillWeek(base(), weekStartKey(MO), { sleep: 5, protein: 60, soreness: 5 });
    const flags = weeklyReview(s, MO).flags;
    const rang = { alarm: 0, warn: 1, info: 2, good: 3 };
    const werte = flags.map((f) => rang[f.severity]);
    deepEq(werte, [...werte].sort((a, b) => a - b));
  });

  test('jeder Befund nennt eine konkrete Handlung', () => {
    const s = fillWeek(base(), weekStartKey(MO), { sleep: 5, protein: 60 });
    for (const f of weeklyReview(s, MO).flags) {
      isTrue(typeof f.action === 'string' && f.action.length > 20,
             `${f.id}: "${f.action}"`);
    }
  });
});

suite('review — Deload-Erkennung', () => {
  test('steigendes Volumen bei fallender Bereitschaft löst Deload aus', () => {
    let s = base();
    const saetze = [3, 5, 7];
    const bereit = [80, 70, 58];
    saetze.forEach((n, w) => {
      const start = addDays(weekStartKey(MO), (w - 2) * 7);
      for (let i = 0; i < 7; i++) {
        s = withDay(s, addDays(start, i), {
          readiness: bereit[w],
          checkin: { sleepHours: 8, sleepQuality: 4, mood: 4, energy: 4, soreness: 2, stress: 2 },
        });
      }
      for (let i = 0; i < n; i++) {
        s = withSet(s, start, 'a-push', 'lateral_raise', i, { reps: 15, kg: 8 });
      }
    });
    const f = findFlag(weeklyReview(s, MO).flags, 'deload');
    isTrue(Boolean(f), 'Deload-Befund fehlt');
    eq(f.severity, 'alarm');
    isTrue(f.detail.includes('→'), f.detail);
  });

  test('steigendes Volumen bei STEIGENDER Bereitschaft ist kein Problem', () => {
    let s = base();
    const saetze = [3, 5, 7];
    const bereit = [60, 70, 82];
    saetze.forEach((n, w) => {
      const start = addDays(weekStartKey(MO), (w - 2) * 7);
      for (let i = 0; i < 7; i++) {
        s = withDay(s, addDays(start, i), {
          readiness: bereit[w],
          checkin: { sleepHours: 8, sleepQuality: 4, mood: 4, energy: 4, soreness: 2, stress: 2 },
        });
      }
      for (let i = 0; i < n; i++) {
        s = withSet(s, start, 'a-push', 'lateral_raise', i, { reps: 15, kg: 8 });
      }
    });
    isFalse(flagIds(weeklyReview(s, MO).flags).includes('deload'),
            'das ist genau der gewollte Verlauf');
  });
});

suite('review — Defizit-Wächter', () => {
  test('großes Defizit plus fallende Bereitschaft wird gemeldet', () => {
    let s = withProfile(base(), { kcalOffset: -500 });
    s = fillWeek(s, addDays(weekStartKey(MO), -7), { readiness: 75 });
    s = fillWeek(s, weekStartKey(MO), { readiness: 60 });
    const f = findFlag(weeklyReview(s, MO).flags, 'deficit-cost');
    isTrue(Boolean(f), 'Wächter hat nicht angeschlagen');
    isTrue(f.action.includes('−300') || f.action.includes('aussetzen'), f.action);
  });

  test('ohne Defizit schlägt der Wächter nicht an', () => {
    let s = base();
    s = fillWeek(s, addDays(weekStartKey(MO), -7), { readiness: 75 });
    s = fillWeek(s, weekStartKey(MO), { readiness: 60 });
    isFalse(flagIds(weeklyReview(s, MO).flags).includes('deficit-cost'));
  });
});

suite('review — Monats-Review', () => {
  test('umfasst den ganzen Monat und vergleicht mit dem Vormonat', () => {
    let s = base();
    s = fillWeek(s, '2026-07-06', {});
    s = fillWeek(s, '2026-07-13', {});
    const r = monthlyReview(s, '2026-07');
    eq(r.kind, 'month');
    eq(r.summary.period.dayCount, 31);
    eq(r.title, 'Juli 2026');
    isTrue(Boolean(r.previous), 'Vormonat fehlt');
  });

  test('zieht frühere Monate aus dem Archiv heran', () => {
    const s = {
      ...base(),
      months: [{ month: '2026-06', summary: { weight: { last: 82 },
                                              readiness: { avg: 71 },
                                              training: { sets: 190 } } }],
    };
    const r = monthlyReview(s, '2026-07');
    eq(r.archive.length, 1);
    close(r.archive[0].weightLast, 82, 0.001);
    close(r.archive[0].readinessAvg, 71, 0.001);
    eq(r.archive[0].sets, 190);
  });
});
