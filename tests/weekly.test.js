import { suite, test, eq, close, deepEq, isTrue, isFalse, throws } from './harness.js';
import {
  WEEK_FIELDS, KCAL_TOLERANCE, PROTEIN_FLOOR, FAT_FLOOR,
  weekTargetAverage, judgeField, weightDrift, suggestFromWeek, weekCheck, weekHistory,
} from '../js/lib/weekly.js';
import { withWeekMacros, getWeekMacros, emptyDay, emptyState } from '../js/lib/state.js';
import { KCAL_ADJUST_STEP, DRIFT_THRESHOLD_KG } from '../js/lib/energy.js';
import { addDays } from '../js/lib/dates.js';

const MO = '2026-07-06';
const SO = '2026-07-12';

function baseState(patch = {}) {
  return {
    ...emptyState('2026-07'),
    profile: {
      sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
      matchDayWeekday: 0,
      teamTrainingWeekdays: [3],
      gymWeekdays: [1, 2, 4],
      proteinPerKg: 2, fatPerKg: 0.8, kcalOffset: 0,
      activityFactors: { rest: 1.35, gym: 1.5, team: 1.65, match: 1.75 },
      offsetExemptDayTypes: [],
    },
    ...patch,
  };
}

/** Tage mit Gewicht füllen: `from` plus n Tage, jeweils um `step` kg verschoben. */
function withWeights(state, from, count, start, step) {
  const days = { ...state.days };
  for (let i = 0; i < count; i += 1) {
    days[addDays(from, i)] = { ...emptyDay(), weightKg: start + i * step };
  }
  return { ...state, days };
}

suite('weekly — Felder und Schwellen', () => {
  test('es sind genau die vier Zahlen aus Yazio', () => {
    deepEq(WEEK_FIELDS.map((f) => f.key), ['kcal', 'proteinG', 'carbsG', 'fatG']);
  });

  test('jedes Feld sagt, nach welcher Regel es bewertet wird', () => {
    const byKey = Object.fromEntries(WEEK_FIELDS.map((f) => [f.key, f]));
    eq(byKey.kcal.rule, 'band', 'Kalorien sind beidseitig begrenzt');
    eq(byKey.carbsG.rule, 'band');
    eq(byKey.proteinG.rule, 'floor', 'Protein ist nach oben offen');
    eq(byKey.fatG.rule, 'fatFloor');
  });

  test('die Kalorientoleranz ist auf die Woche eng gefasst', () => {
    isTrue(KCAL_TOLERANCE <= 0.05,
      'ein Wochenschnitt darf engere Grenzen haben als ein einzelner Tag');
  });
});

suite('weekly — Wochenziel', () => {
  test('das Wochenziel ist das Mittel der sieben Tagesziele', () => {
    const target = weekTargetAverage(baseState(), MO);
    eq(target.days, 7);
    isTrue(target.kcal > 2000 && target.kcal < 4000, `war ${target.kcal}`);
    // Protein und Fett hängen nur am Gewicht, sind also über die Woche konstant.
    close(target.proteinG, 80 * 2, 0.001);
    close(target.fatG, 80 * 0.8, 0.001);
  });

  test('eine Woche mit mehr Belastung hat ein höheres Wochenziel', () => {
    const ruhig = baseState({
      profile: { ...baseState().profile, teamTrainingWeekdays: [] },
    });
    const voll = baseState({
      profile: { ...baseState().profile, teamTrainingWeekdays: [1, 2, 3, 4, 5] },
    });
    isTrue(weekTargetAverage(voll, MO).kcal > weekTargetAverage(ruhig, MO).kcal);
  });

  test('ohne Profil gibt es kein Ziel, aber auch keinen Absturz', () => {
    eq(weekTargetAverage({ ...emptyState('2026-07'), profile: null }, MO), null);
  });
});

suite('weekly — Urteil je Makro', () => {
  const kcal = WEEK_FIELDS[0];
  const protein = WEEK_FIELDS[1];
  const fat = WEEK_FIELDS[3];

  test('Kalorien im Band sind gut, außerhalb schlecht', () => {
    eq(judgeField(kcal, 3000, 3000).tone, 'good');
    eq(judgeField(kcal, 3000 * 1.04, 3000).tone, 'good');
    eq(judgeField(kcal, 3000 * 1.08, 3000).tone, 'ok', 'knapp daneben');
    eq(judgeField(kcal, 3000 * 1.2, 3000).tone, 'bad');
    eq(judgeField(kcal, 3000 * 0.8, 3000).tone, 'bad');
  });

  test('das Urteil trägt immer ein Wort und die Richtung', () => {
    eq(judgeField(kcal, 3600, 3000).word, 'zu viel');
    eq(judgeField(kcal, 2400, 3000).word, 'zu wenig');
    eq(judgeField(kcal, 3000, 3000).word, 'im Ziel');
  });

  test('Protein ist nach oben offen', () => {
    eq(judgeField(protein, 160, 160).tone, 'good');
    eq(judgeField(protein, 220, 160).tone, 'good', 'mehr Protein ist kein Fehler');
    eq(judgeField(protein, 160 * PROTEIN_FLOOR, 160).tone, 'good');
    eq(judgeField(protein, 160 * 0.85, 160).tone, 'ok');
    eq(judgeField(protein, 160 * 0.6, 160).tone, 'bad');
  });

  test('Fett hat seine eigene Untergrenze — Hormonhaushalt', () => {
    eq(judgeField(fat, 64 * FAT_FLOOR, 64).tone, 'good');
    eq(judgeField(fat, 64 * 0.5, 64).tone, 'bad');
    eq(judgeField(fat, 120, 64).tone, 'good', 'mehr Fett ist kein Alarm');
  });

  test('ohne Eintrag gibt es kein Urteil, nicht ein schlechtes', () => {
    const j = judgeField(kcal, null, 3000);
    eq(j.tone, 'idle');
    eq(j.ratio, null);
    eq(j.delta, null);
    eq(judgeField(kcal, 3000, null).tone, 'idle');
    eq(judgeField(kcal, 3000, 0).tone, 'idle', 'ein Ziel von 0 ist kein Ziel');
  });

  test('die Abweichung wird als Zahl mitgeliefert', () => {
    close(judgeField(kcal, 3200, 3000).delta, 200, 0.001);
    close(judgeField(kcal, 2800, 3000).delta, -200, 0.001);
  });
});

suite('weekly — Gewichtstrend', () => {
  test('ohne genug Messwerte ist die Drift null, nicht 0', () => {
    const drift = weightDrift(baseState(), MO);
    eq(drift.deltaKg, null);
  });

  test('bei steigendem Gewicht ist die Drift positiv', () => {
    // 21 Tage bis Sonntag, jeden Tag 100 g mehr.
    const state = withWeights(baseState(), addDays(SO, -20), 21, 79, 0.1);
    const drift = weightDrift(state, MO);
    isTrue(drift.deltaKg > 1, `war ${drift.deltaKg}`);
  });

  test('bei stabilem Gewicht liegt die Drift unter der Schwelle', () => {
    const state = withWeights(baseState(), addDays(SO, -20), 21, 80, 0);
    close(weightDrift(state, MO).deltaKg, 0, 0.001);
  });

  test('bei fallendem Gewicht ist die Drift negativ', () => {
    const state = withWeights(baseState(), addDays(SO, -20), 21, 82, -0.1);
    isTrue(weightDrift(state, MO).deltaKg < -1);
  });
});

suite('weekly — Vorschlag', () => {
  const treffer = { tone: 'good', word: 'im Ziel', ratio: 1, delta: 0 };
  const drueber = { tone: 'bad', word: 'zu viel', ratio: 1.2, delta: 600 };

  test('ohne Eintrag wird nichts vorgeschlagen', () => {
    const s = suggestFromWeek({
      kcalJudgement: { tone: 'idle', word: '', ratio: null, delta: null },
      drift: { deltaKg: 1.5 },
      currentOffset: 0,
    });
    eq(s.change, 0);
    eq(s.tone, 'idle');
  });

  test('ERST TREFFEN, DANN ANPASSEN', () => {
    /* Der Kern dieser Datei: wurde das Ziel nicht getroffen, ist der
       Gewichtstrend kein Argument für das Ziel — sonst korrigiert die App eine
       Zahl, die nie erreicht wurde, und jagt sich selbst. */
    const s = suggestFromWeek({
      kcalJudgement: drueber,
      drift: { deltaKg: 1.5 },
      currentOffset: 0,
    });
    eq(s.change, 0, 'kein Vorschlag, obwohl das Gewicht deutlich steigt');
    isTrue(s.reason.toLowerCase().includes('treffen'), `war: "${s.reason}"`);
  });

  test('Ziel getroffen und Gewicht stabil: nichts ändern', () => {
    const s = suggestFromWeek({
      kcalJudgement: treffer,
      drift: { deltaKg: DRIFT_THRESHOLD_KG - 0.1 },
      currentOffset: -300,
    });
    eq(s.change, 0);
    eq(s.newOffset, -300);
    eq(s.tone, 'good');
  });

  test('Ziel getroffen und Gewicht steigt: Kalorien runter', () => {
    const s = suggestFromWeek({
      kcalJudgement: treffer,
      drift: { deltaKg: 1.2 },
      currentOffset: 0,
    });
    eq(s.change, -KCAL_ADJUST_STEP);
    eq(s.newOffset, -KCAL_ADJUST_STEP);
  });

  test('Ziel getroffen und Gewicht fällt: Kalorien rauf', () => {
    const s = suggestFromWeek({
      kcalJudgement: treffer,
      drift: { deltaKg: -1.2 },
      currentOffset: -300,
    });
    eq(s.change, KCAL_ADJUST_STEP);
    eq(s.newOffset, -300 + KCAL_ADJUST_STEP);
  });

  test('Ziel getroffen, aber kein Gewichtstrend: abwarten statt raten', () => {
    const s = suggestFromWeek({
      kcalJudgement: treffer,
      drift: { deltaKg: null },
      currentOffset: 0,
    });
    eq(s.change, 0);
    isTrue(s.reason.toLowerCase().includes('gewichtstrend'), `war: "${s.reason}"`);
  });
});

suite('weekly — alles zusammen', () => {
  test('weekCheck hängt am Montag der Woche, egal welcher Tag hereinkommt', () => {
    const a = weekCheck(baseState(), MO);
    const b = weekCheck(baseState(), SO);
    eq(a.weekStart, b.weekStart);
    eq(a.weekStart, MO);
  });

  test('ohne Eintrag ist hasEntry falsch und alle Urteile idle', () => {
    const check = weekCheck(baseState(), MO);
    isFalse(check.hasEntry);
    for (const f of check.fields) eq(f.tone, 'idle', f.field.key);
  });

  test('mit Eintrag steht jedes Feld gegen sein Ziel', () => {
    let state = baseState();
    const target = weekTargetAverage(state, MO);
    state = withWeekMacros(state, MO, {
      kcal: target.kcal,
      proteinG: target.proteinG,
      carbsG: target.carbsG,
      fatG: target.fatG,
    });

    const check = weekCheck(state, MO);
    isTrue(check.hasEntry);
    for (const f of check.fields) eq(f.tone, 'good', f.field.key);
  });

  test('weekHistory liefert die letzten Wochen, älteste zuerst', () => {
    // Tage im Juni, damit die Grenze nicht schon greift.
    const state = withWeekMacros(
      withWeights(baseState(), '2026-06-01', 1, 80, 0), MO, { kcal: 2800 }
    );
    const history = weekHistory(state, MO, 4, MO);
    eq(history.length, 4);
    eq(history[3].weekStart, MO, 'die laufende Woche steht am Ende');
    eq(history[3].macros.kcal, 2800);
    eq(history[0].macros.kcal, null, 'leere Wochen sind null, nicht 0');
    for (let i = 1; i < history.length; i += 1) {
      isTrue(history[i - 1].weekStart < history[i].weekStart, 'aufsteigend');
    }
  });

  test('KEINE WOCHEN VOR DEM ERSTEN ERFASSTEN MONAT', () => {
    /* Flockes Ansage: ab Juli wird gezählt. Eine Zeile „Woche ab 22.06. — — — —"
       für einen Monat, den es in der App nicht mehr gibt, liest sich wie eine
       Lücke statt wie Nichtexistenz. */
    const state = withWeights(baseState(), '2026-07-01', 3, 80, 0);
    const history = weekHistory(state, MO, 6, MO);
    isTrue(history.length < 6, `es müssen Wochen wegfallen, waren ${history.length}`);
    for (const h of history) {
      isTrue(h.weekStart >= '2026-07-01', `${h.weekStart} liegt vor dem Anfang`);
    }
    eq(history.at(-1).weekStart, MO, 'die laufende Woche bleibt');
  });

  test('ohne jede Daten bleibt nur die laufende Woche', () => {
    const history = weekHistory(baseState(), MO, 6, MO);
    for (const h of history) {
      isTrue(h.weekStart >= '2026-07-01', `${h.weekStart} liegt vor dem Anfang`);
    }
  });
});

suite('state — Wochenschnitt schreiben', () => {
  test('geschrieben wird auf den Montagsschlüssel, zusammengeführt', () => {
    let state = withWeekMacros(baseState(), MO, { kcal: 2800 });
    state = withWeekMacros(state, MO, { proteinG: 165 });
    const macros = getWeekMacros(state, MO);
    eq(macros.kcal, 2800, 'die erste Zahl bleibt stehen');
    eq(macros.proteinG, 165);
  });

  test('fehlende Felder sind null, nie undefined', () => {
    const macros = getWeekMacros(baseState(), MO);
    deepEq(
      [macros.kcal, macros.proteinG, macros.carbsG, macros.fatG],
      [null, null, null, null]
    );
  });

  test('unsinnige Werte werden abgewiesen', () => {
    throws(() => withWeekMacros(baseState(), MO, { kcal: -100 }));
    throws(() => withWeekMacros(baseState(), MO, { kcal: 99999 }));
    throws(() => withWeekMacros(baseState(), MO, { proteinG: 'viel' }));
    throws(() => withWeekMacros(baseState(), 'irgendwann', { kcal: 2800 }));
  });

  test('der ursprüngliche Zustand bleibt unangetastet', () => {
    const state = baseState();
    withWeekMacros(state, MO, { kcal: 2800 });
    deepEq(Object.keys(state.weeks), []);
  });
});
