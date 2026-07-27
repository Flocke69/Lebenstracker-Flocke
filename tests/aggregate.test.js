import { suite, test, eq, close, deepEq, isTrue, isFalse, throws } from './harness.js';
import { emptyState, withProfile, withDay, withSet } from '../js/lib/state.js';
import {
  WEIGHT_WINDOW, SHORT_SLEEP_H, LOW_READINESS,
  mean, minOf, maxOf, countKnown, movingAverage, groupDifference,
  series, weightSeries, summarize, weekSummary, monthSummary,
  lastDays, loggedKeys, compare,
} from '../js/lib/aggregate.js';

const PROFILE = {
  sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
  matchDayWeekday: 0, teamTrainingWeekdays: [3], gymWeekdays: [1, 2, 4],
};

const base = () => withProfile(emptyState('2026-07'), PROFILE);

/* Montag der Testwoche ist der 27.07.2026. */
const MO = '2026-07-27';
const WOCHE = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
               '2026-07-31', '2026-08-01', '2026-08-02'];

suite('aggregate — Statistik mit Lücken', () => {
  test('mean überspringt Lücken statt sie als 0 zu werten', () => {
    close(mean([80, null, 82]), 81, 0.001);
    close(mean([null, null, 5]), 5, 0.001);
  });

  test('ohne einen einzigen Wert kommt null, nicht 0', () => {
    eq(mean([]), null);
    eq(mean([null, null]), null);
    eq(mean(undefined), null);
    eq(minOf([null]), null);
    eq(maxOf([null]), null);
  });

  test('countKnown zählt nur echte Zahlen', () => {
    eq(countKnown([1, null, 2, undefined, NaN, 3]), 3);
  });

  test('min und max ignorieren Lücken', () => {
    close(minOf([80.4, null, 79.1, 81]), 79.1, 0.001);
    close(maxOf([80.4, null, 79.1, 81]), 81, 0.001);
  });
});

suite('aggregate — gleitender Durchschnitt', () => {
  test('das Fenster schaut rückwärts und wächst erst an', () => {
    const out = movingAverage([1, 2, 3, 4], 3);
    close(out[0], 1, 0.001);
    close(out[1], 1.5, 0.001);
    close(out[2], 2, 0.001);
    close(out[3], 3, 0.001, 'Mittel aus 2, 3, 4');
  });

  test('Lücken werden übersprungen, nicht fortgeschrieben', () => {
    // Der letzte bekannte Wert darf NICHT eingesetzt werden — das wäre eine
    // vorgetäuschte Messung.
    const out = movingAverage([80, null, 82], 3);
    close(out[2], 81, 0.001, 'Mittel aus 80 und 82');
  });

  test('ein Fenster ganz ohne Werte ergibt null', () => {
    const out = movingAverage([null, null, null], 2);
    deepEq(out, [null, null, null]);
  });

  test('das Standardfenster für Gewicht ist eine Woche', () => {
    eq(WEIGHT_WINDOW, 7);
  });

  test('der Gleitschnitt glättet Tagesschwankungen', () => {
    // Genau dafür ist er da: Wasserhaushalt schwankt um mehr, als in einer
    // Woche an Fett dazukommt.
    const roh = [80, 81.5, 79.2, 80.8, 79.5, 81, 80.1];
    const avg = movingAverage(roh, 7);
    const spanneRoh = Math.max(...roh) - Math.min(...roh);
    const geglaettet = avg.slice(3);
    const spanneAvg = Math.max(...geglaettet) - Math.min(...geglaettet);
    isTrue(spanneAvg < spanneRoh / 2, `roh ${spanneRoh.toFixed(2)}, glatt ${spanneAvg.toFixed(2)}`);
  });

  test('unsinniges Fenster wirft', () => {
    throws(() => movingAverage([1, 2], 0));
    throws(() => movingAverage([1, 2], 1.5));
  });
});

suite('aggregate — Gruppenvergleich', () => {
  test('rechnet die Differenz der Mittelwerte', () => {
    const pairs = [[5, 40], [6, 50], [8, 80], [8, 90]];
    const r = groupDifference(pairs, (h) => h < 6.5);
    close(r.difference, 45 - 85, 0.001);
    eq(r.inGroup, 2);
    eq(r.outGroup, 2);
  });

  test('bei zu wenig Daten gibt es keine Aussage statt einer erfundenen', () => {
    const r = groupDifference([[5, 40], [8, 80]], (h) => h < 6.5);
    eq(r.difference, null, 'je ein Wert pro Gruppe reicht nicht');
  });

  test('Paare mit Lücken werden verworfen', () => {
    const r = groupDifference([[5, null], [5, 40], [6, 50], [8, 80], [8, 90]],
                              (h) => h < 6.5);
    eq(r.inGroup, 2);
  });
});

suite('aggregate — Reihen aus dem Zustand', () => {
  test('series liefert für jeden Tag einen Wert oder null', () => {
    let s = base();
    s = withDay(s, MO, { weightKg: 80.4 });
    const out = series(s, WOCHE, (d) => d.weightKg);
    eq(out.length, 7);
    close(out[0], 80.4, 0.001);
    eq(out[1], null);
  });

  test('weightSeries liefert Rohwerte und Gleitschnitt', () => {
    let s = base();
    s = withDay(s, WOCHE[0], { weightKg: 80 });
    s = withDay(s, WOCHE[1], { weightKg: 82 });
    const w = weightSeries(s, WOCHE);
    close(w.raw[1], 82, 0.001);
    close(w.avg[1], 81, 0.001, 'geglättet');
  });
});

suite('aggregate — Wochenzusammenfassung', () => {
  function wocheMitDaten() {
    let s = base();
    // Mo bis Fr Check-in und Gewicht
    const gewichte = [80.4, 80.2, 80.5, 80.0, 79.8];
    const schlaf = [6.0, 7.5, 8.0, 6.2, 7.0];
    for (let i = 0; i < 5; i++) {
      s = withDay(s, WOCHE[i], {
        weightKg: gewichte[i],
        checkin: { sleepHours: schlaf[i], sleepQuality: 3, mood: 3, energy: 3, soreness: 2, stress: 2 },
        readiness: i === 0 ? 45 : 70,
        nutrition: { kcal: 2200, proteinG: 170, carbsG: 200, fatG: 65 },
      });
    }
    // Eine Trainingseinheit am Montag
    s = withSet(s, WOCHE[0], 'a-push', 'ohp_db', 0, { reps: 10, kg: 22.5 });
    s = withSet(s, WOCHE[0], 'a-push', 'ohp_db', 1, { reps: 9, kg: 22.5 });
    s = withSet(s, WOCHE[0], 'a-push', 'lateral_raise', 0, { reps: 15, kg: 8 });
    return s;
  }

  const s = wocheMitDaten();
  const sum = weekSummary(s, MO);

  test('der Zeitraum umfasst Montag bis Sonntag', () => {
    eq(sum.period.kind, 'week');
    eq(sum.period.start, '2026-07-27');
    eq(sum.period.end, '2026-08-02');
    eq(sum.period.dayCount, 7);
  });

  test('die Erfassungsquote wird ehrlich gezählt', () => {
    eq(sum.logging.daysWithWeight, 5);
    eq(sum.logging.daysWithCheckin, 5);
    eq(sum.logging.daysWithTraining, 1);
    eq(sum.logging.daysWithNutrition, 5);
  });

  test('Schlaf: Mittel und kurze Nächte', () => {
    close(sum.sleep.avg, (6.0 + 7.5 + 8.0 + 6.2 + 7.0) / 5, 0.001);
    eq(sum.sleep.nightsShort, 2, 'unter 6,5 h waren Montag und Donnerstag');
    close(sum.sleep.min, 6.0, 0.001);
  });

  test('Bereitschaft: Mittel und schlechte Tage', () => {
    close(sum.readiness.avg, (45 + 70 * 4) / 5, 0.001);
    eq(sum.readiness.lowDays, 1, `unter ${LOW_READINESS} war nur der Montag`);
  });

  test('Gewicht: Trend über den Gleitschnitt, nicht über Tageswerte', () => {
    eq(sum.weight.measured, 5);
    close(sum.weight.min, 79.8, 0.001);
    close(sum.weight.max, 80.5, 0.001);
    isTrue(sum.weight.delta < 0, 'die Woche ging nach unten');
  });

  test('Training: Sätze, Tonnage und Volumen je Muskelgruppe', () => {
    eq(sum.training.sets, 3);
    close(sum.training.tonnage, 10 * 22.5 + 9 * 22.5 + 15 * 8, 0.001);
    close(sum.training.volume.shoulders, 2 + 1, 0.001, 'Schulterdrücken 2 + Seitheben 1');
    close(sum.training.volume.triceps, 1, 0.001, '2 Sätze Nebengruppe = 1');
  });

  test('Fußball wird aus dem Profil abgeleitet', () => {
    eq(sum.football.matches, 1, 'Sonntag');
    eq(sum.football.teamSessions, 1, 'Mittwoch');
  });

  test('Ernährung: Trefferquoten gegen die Tagesziele', () => {
    eq(sum.nutrition.kcalCompared, 5);
    isTrue(sum.nutrition.kcalHitRate >= 0 && sum.nutrition.kcalHitRate <= 1);
    close(sum.nutrition.proteinAvg, 170, 0.001);
  });

  test('eine leere Woche stürzt nicht ab und erfindet nichts', () => {
    const leer = weekSummary(base(), MO);
    eq(leer.sleep.avg, null);
    eq(leer.readiness.avg, null);
    eq(leer.weight.delta, null);
    eq(leer.training.sets, 0);
    eq(leer.nutrition.kcalHitRate, null);
    eq(leer.logging.daysWithWeight, 0);
  });
});

suite('aggregate — Monat und Zeiträume', () => {
  test('monthSummary umfasst alle Tage des Monats', () => {
    const sum = monthSummary(base(), '2026-07');
    eq(sum.period.kind, 'month');
    eq(sum.period.dayCount, 31);
    eq(sum.period.start, '2026-07-01');
    eq(sum.period.end, '2026-07-31');
  });

  test('Februar im Schaltjahr hat 29 Tage', () => {
    eq(monthSummary(base(), '2024-02').period.dayCount, 29);
  });

  test('lastDays endet auf dem angegebenen Tag', () => {
    const keys = lastDays('2026-07-27', 3);
    deepEq(keys, ['2026-07-25', '2026-07-26', '2026-07-27']);
  });

  test('lastDays weist unsinnige Längen ab', () => {
    throws(() => lastDays('2026-07-27', 0));
    throws(() => lastDays('quatsch', 3));
  });

  test('loggedKeys findet nur Tage mit echten Daten', () => {
    let s = base();
    s = withDay(s, '2026-07-20', { weightKg: 80 });
    s = withDay(s, '2026-07-21', { dayType: 'rest' });   // kein echter Messwert
    s = withDay(s, '2026-07-22', { readiness: 70 });
    deepEq(loggedKeys(s), ['2026-07-20', '2026-07-22']);
  });
});

suite('aggregate — Vergleich zweier Zeiträume', () => {
  test('compare liefert Differenzen, null bei fehlender Grundlage', () => {
    let a = base();
    a = withDay(a, WOCHE[0], { readiness: 80 });
    a = withSet(a, WOCHE[0], 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });

    let b = base();
    b = withDay(b, WOCHE[0], { readiness: 60 });

    const diff = compare(weekSummary(a, MO), weekSummary(b, MO));
    close(diff.readiness, 20, 0.001);
    eq(diff.sets, 1);
    eq(diff.sleep, null, 'ohne Schlafdaten keine Differenz');
  });

  test('Volumendifferenzen kommen je Muskelgruppe', () => {
    let a = base();
    a = withSet(a, WOCHE[0], 'a-push', 'lateral_raise', 0, { reps: 15, kg: 8 });
    a = withSet(a, WOCHE[0], 'a-push', 'lateral_raise', 1, { reps: 15, kg: 8 });
    const diff = compare(weekSummary(a, MO), weekSummary(base(), MO));
    close(diff.volume.shoulders, 2, 0.001);
    close(diff.volume.quads, 0, 0.001);
  });
});

suite('aggregate — Korrelations-Hinweis', () => {
  test('kurze Nächte gegen den Rest werden verglichen', () => {
    let s = base();
    const daten = [
      [5.0, 30], [6.0, 35], [5.5, 40],       // kurz
      [8.0, 80], [7.5, 75], [8.5, 85],       // lang
    ];
    daten.forEach(([h, r], i) => {
      s = withDay(s, WOCHE[i], { checkin: { sleepHours: h }, readiness: r });
    });
    const sum = weekSummary(s, MO);
    const insight = sum.insights.sleepVsReadiness;
    eq(insight.inGroup, 3);
    eq(insight.outGroup, 3);
    isTrue(insight.difference < -30, `Differenz war ${insight.difference}`);
  });

  test('die Schwelle für kurze Nächte liegt bei 6,5 Stunden', () => {
    eq(SHORT_SLEEP_H, 6.5);
  });
});
