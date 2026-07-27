import { suite, test, eq, deepEq, isTrue, isFalse, throws } from './harness.js';
import {
  LEG_MIN_DAYS_BEFORE_MATCH,
  LEG_MIN_DAYS_AFTER_MATCH,
  LEG_LEVELS,
  legVolumeAllowance,
  heavyLegWeekdays,
  pickLegDay,
  suggestGymWeekdays,
  exerciseBlockReason,
} from '../js/lib/planner.js';

/* Flockes Konfiguration (JS-Wochentage: 0 = Sonntag … 6 = Samstag)
 *   Mannschaftstraining: Mittwoch = 3
 *   Spiel:               Sonntag  = 0
 */
const FLOCKE = { matchDayWeekday: 0, teamTrainingWeekdays: [3] };

const WEEK = {
  So: '2026-08-02', Mo: '2026-07-27', Di: '2026-07-28', Mi: '2026-07-29',
  Do: '2026-07-30', Fr: '2026-07-31', Sa: '2026-08-01',
};

suite('planner — Schwellen', () => {
  test('vor dem Spiel gilt eine andere Schwelle als danach', () => {
    eq(LEG_MIN_DAYS_BEFORE_MATCH, 3, 'Frische vor dem Spiel');
    eq(LEG_MIN_DAYS_AFTER_MATCH, 2, 'eigene Erholung nach dem Spiel');
    isTrue(LEG_MIN_DAYS_BEFORE_MATCH > LEG_MIN_DAYS_AFTER_MATCH,
           'vor dem Spiel ist die Anforderung strenger');
  });

  test('es gibt genau drei Stufen', () => {
    deepEq(LEG_LEVELS, ['none', 'light', 'heavy']);
  });
});

suite('planner — die harte Spieltags-Regel', () => {
  test('am Spieltag ist Beinvolumen gesperrt', () => {
    const r = legVolumeAllowance(WEEK.So, FLOCKE);
    eq(r.level, 'none');
    eq(r.daysUntilMatch, 0);
    isTrue(r.reason.length > 0, 'die Sperre wird begründet');
  });

  test('am Tag VOR dem Spiel ist Beinvolumen gesperrt', () => {
    const r = legVolumeAllowance(WEEK.Sa, FLOCKE);
    eq(r.level, 'none');
    eq(r.daysUntilMatch, 1);
  });

  test('die Sperre gilt unabhängig davon, ob es ein Gym-Tag ist', () => {
    // Der Score kann noch so gut sein, an diesen zwei Tagen geht nichts.
    for (const key of [WEEK.Sa, WEEK.So]) {
      eq(legVolumeAllowance(key, { ...FLOCKE, gymWeekdays: [0, 6] }).level, 'none');
    }
  });
});

suite('planner — schweres Beintraining, Flockes Woche', () => {
  const level = (key) => legVolumeAllowance(key, FLOCKE).level;

  test('Montag: nur 1 Tag nach dem Spiel → nichts Schweres', () => {
    eq(level(WEEK.Mo), 'light');
    eq(legVolumeAllowance(WEEK.Mo, FLOCKE).daysSinceMatch, 1);
  });

  test('Dienstag: Erholung reicht, aber Mittwoch ist Mannschaftstraining', () => {
    const r = legVolumeAllowance(WEEK.Di, FLOCKE);
    eq(r.level, 'light', 'schwere Beine würden das Training am Folgetag ruinieren');
    eq(r.daysSinceMatch, 2, 'Erholung nach dem Spiel wäre ausreichend');
    eq(r.daysUntilMatch, 5, 'Abstand zum Spiel wäre reichlich');
  });

  test('Mittwoch: erlaubt — harter Tag bleibt hart', () => {
    eq(level(WEEK.Mi), 'heavy');
  });

  test('Donnerstag: erlaubt, 3 Tage vor dem Spiel', () => {
    const r = legVolumeAllowance(WEEK.Do, FLOCKE);
    eq(r.level, 'heavy');
    eq(r.daysUntilMatch, 3);
    eq(r.daysSinceMatch, 4);
  });

  test('Freitag: nur 2 Tage vor dem Spiel → nichts Schweres', () => {
    const r = legVolumeAllowance(WEEK.Fr, FLOCKE);
    eq(r.level, 'light');
    eq(r.daysUntilMatch, 2);
  });

  test('genau Mittwoch und Donnerstag tragen schweres Beintraining', () => {
    deepEq(heavyLegWeekdays(FLOCKE), [3, 4]);
  });

  test('Prophylaxe ist an jedem Tag außer Spieltag und Vortag möglich', () => {
    const lightOrHeavy = ['Mo', 'Di', 'Mi', 'Do', 'Fr']
      .every((d) => level(WEEK[d]) !== 'none');
    isTrue(lightOrHeavy, 'Nordic Curls und Copenhagen kosten kaum Erholung');
  });
});

suite('planner — Wahl des Bein-Tags', () => {
  test('bei Gym Mo/Do/Fr bleibt nur Donnerstag', () => {
    const r = pickLegDay({ ...FLOCKE, gymWeekdays: [1, 4, 5] });
    eq(r.weekday, 4, 'Donnerstag');
    isTrue(r.reason.includes('Donnerstag'), 'die Wahl wird benannt');
  });

  test('ein Tag ohne Mannschaftstraining gewinnt gegen den Trainingstag', () => {
    // Mittwoch liegt 4 Tage vor dem Spiel und wäre damit "frischer",
    // aber Donnerstag ohne Fußball obendrauf ist die bessere Qualität.
    const r = pickLegDay({ ...FLOCKE, gymWeekdays: [3, 4] });
    eq(r.weekday, 4, 'Donnerstag vor Mittwoch');
  });

  test('nur Mittwoch verfügbar → Mittwoch, mit Hinweis auf die Doppelbelastung', () => {
    const r = pickLegDay({ ...FLOCKE, gymWeekdays: [3] });
    eq(r.weekday, 3);
    isTrue(r.sharesTeamTrainingDay, 'Doppelbelastung wird markiert');
  });

  test('ohne passenden Tag gibt es null UND eine Erklärung', () => {
    // Mo, Di, Fr: keiner trägt schweres Beintraining.
    const r = pickLegDay({ ...FLOCKE, gymWeekdays: [1, 2, 5] });
    eq(r.weekday, null);
    isTrue(r.reason.length > 20, 'der Konflikt wird erklärt, nicht verschwiegen');
    deepEq(r.candidates, [3, 4], 'die möglichen Tage werden genannt');
  });

  test('leere Gym-Tage werden abgewiesen', () => {
    throws(() => pickLegDay({ ...FLOCKE, gymWeekdays: [] }));
    throws(() => pickLegDay({ ...FLOCKE, gymWeekdays: undefined }));
  });
});

suite('planner — Vorschlag für die Gym-Tage', () => {
  test('drei Tage, und Donnerstag ist dabei', () => {
    const r = suggestGymWeekdays({ ...FLOCKE, count: 3 });
    eq(r.gymWeekdays.length, 3);
    isTrue(r.gymWeekdays.includes(4),
           `Donnerstag muss dabei sein, war: ${r.gymWeekdays}`);
    eq(r.legDay, 4);
  });

  test('Spieltag und Vortag kommen nie vor', () => {
    const r = suggestGymWeekdays({ ...FLOCKE, count: 3 });
    isFalse(r.gymWeekdays.includes(0), 'kein Spieltag');
    isFalse(r.gymWeekdays.includes(6), 'kein Samstag');
  });

  test('der Mannschaftstrainingstag wird standardmäßig freigehalten', () => {
    const r = suggestGymWeekdays({ ...FLOCKE, count: 3 });
    isFalse(r.gymWeekdays.includes(3), 'Mittwoch bleibt Fußball');
  });

  test('die Tage kommen aufsteigend zurück', () => {
    const g = suggestGymWeekdays({ ...FLOCKE, count: 3 }).gymWeekdays;
    deepEq(g, [...g].sort((a, b) => a - b));
  });

  test('funktioniert auch bei Samstagsspiel und Dienstagstraining', () => {
    const r = suggestGymWeekdays({
      matchDayWeekday: 6, teamTrainingWeekdays: [2], count: 3,
    });
    eq(r.gymWeekdays.length, 3);
    isFalse(r.gymWeekdays.includes(6), 'kein Spieltag');
    isFalse(r.gymWeekdays.includes(5), 'nicht der Tag vor dem Spiel');
    isTrue(r.legDay !== null, 'ein Bein-Tag wird gefunden');
    isTrue(r.gymWeekdays.includes(r.legDay), 'der Bein-Tag ist ein Gym-Tag');
  });

  test('bei zwei Einheiten pro Woche ist der Bein-Tag trotzdem dabei', () => {
    const r = suggestGymWeekdays({ ...FLOCKE, count: 2 });
    eq(r.gymWeekdays.length, 2);
    isTrue(r.gymWeekdays.includes(r.legDay), 'Bein-Tag hat Vorrang');
  });

  test('unmögliche Anzahl wird abgewiesen', () => {
    throws(() => suggestGymWeekdays({ ...FLOCKE, count: 0 }));
    throws(() => suggestGymWeekdays({ ...FLOCKE, count: 7 }),
           'mehr Gym-Tage als freie Tage');
  });
});

suite('planner — Sperre einzelner Übungen', () => {
  const heavyLeg = { loadsLegs: true, prophylaxis: false };
  const prophyLeg = { loadsLegs: true, prophylaxis: true };
  const upper = { loadsLegs: false };

  test('Oberkörperübungen sind nie gesperrt — auch nicht am Spieltag', () => {
    for (const level of LEG_LEVELS) {
      eq(exerciseBlockReason(upper, level), null, `Stufe ${level}`);
    }
  });

  test('bei Stufe none ist alles für die Beine gesperrt, auch Prophylaxe', () => {
    isTrue(exerciseBlockReason(heavyLeg, 'none') !== null);
    isTrue(exerciseBlockReason(prophyLeg, 'none') !== null,
           'am Spieltag auch keine Copenhagen Planks');
  });

  test('bei Stufe light bleibt die Prophylaxe erlaubt', () => {
    // Das ist der Kern: der Verletzungsschutz darf nicht am Zeitplan
    // scheitern. Er kostet praktisch keine Erholung.
    eq(exerciseBlockReason(prophyLeg, 'light'), null);
    isTrue(exerciseBlockReason(heavyLeg, 'light') !== null,
           'schwere Beinarbeit faellt aber weg');
  });

  test('bei Stufe heavy ist nichts gesperrt', () => {
    eq(exerciseBlockReason(heavyLeg, 'heavy'), null);
    eq(exerciseBlockReason(prophyLeg, 'heavy'), null);
  });

  test('jede Sperre wird begründet, nie stumm', () => {
    for (const level of ['none', 'light']) {
      const reason = exerciseBlockReason(heavyLeg, level);
      isTrue(typeof reason === 'string' && reason.length > 15, `Stufe ${level}: "${reason}"`);
    }
  });

  test('unbekannte Stufe wirft', () => {
    throws(() => exerciseBlockReason(heavyLeg, 'vielleicht'));
  });
});

suite('planner — Eingabeprüfung', () => {
  test('unsinnige Wochentage werden abgewiesen', () => {
    throws(() => legVolumeAllowance(WEEK.Mo, { matchDayWeekday: 9, teamTrainingWeekdays: [] }));
    throws(() => legVolumeAllowance(WEEK.Mo, { matchDayWeekday: 0, teamTrainingWeekdays: [8] }));
    throws(() => legVolumeAllowance(WEEK.Mo, {}));
  });

  test('ohne Mannschaftstraining funktioniert die Regel weiterhin', () => {
    const solo = { matchDayWeekday: 0, teamTrainingWeekdays: [] };
    // Ohne Trainingstag darf auch Dienstag schwer trainiert werden.
    eq(legVolumeAllowance(WEEK.Di, solo).level, 'heavy');
    deepEq(heavyLegWeekdays(solo), [2, 3, 4]);
  });
});
