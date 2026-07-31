import { suite, test, eq, close, deepEq, isTrue, throws } from './harness.js';
import { MUSCLE_GROUPS, EXERCISES, SECONDARY_SHARE, exercise }
  from '../data/exercises.js';
import {
  SESSIONS, PLAN, sessionForWeekday, sessionExercises, sessionById, plannedSets,
} from '../data/plan-default.js';
import {
  emptyVolume,
  setsPerMuscle,
  plannedSetsPerMuscle,
  tonnage,
  totalSets,
  shareOf,
} from '../js/lib/volume.js';

suite('Katalog — innere Stimmigkeit', () => {
  test('jede Übung nennt eine bekannte Hauptmuskelgruppe', () => {
    for (const [id, ex] of Object.entries(EXERCISES)) {
      isTrue(id in EXERCISES, id);
      isTrue(ex.primary in MUSCLE_GROUPS, `${id}: primary "${ex.primary}"`);
    }
  });

  test('jede Nebengruppe ist bekannt und nie gleich der Hauptgruppe', () => {
    for (const [id, ex] of Object.entries(EXERCISES)) {
      for (const s of ex.secondary) {
        isTrue(s in MUSCLE_GROUPS, `${id}: secondary "${s}"`);
        isTrue(s !== ex.primary, `${id}: "${s}" ist schon Hauptgruppe`);
      }
    }
  });

  test('jede Übung sagt, ob sie die Beine belastet', () => {
    for (const [id, ex] of Object.entries(EXERCISES)) {
      eq(typeof ex.loadsLegs, 'boolean', `${id}`);
    }
  });

  test('Beinübungen sind als solche markiert, Oberkörperübungen nicht', () => {
    // Diese Markierung steuert, was an gesperrten Tagen ausgeblendet wird.
    for (const id of ['rdl_db', 'split_squat_bulgarian', 'leg_extension',
                      'adductor_machine', 'leg_curl_machine', 'squat_bb']) {
      isTrue(EXERCISES[id].loadsLegs, `${id} muss als Beinübung gelten`);
    }
    for (const id of ['ohp_db', 'lat_pulldown', 'curl_cable', 'lateral_raise_machine',
                      'row_bb']) {
      isTrue(!EXERCISES[id].loadsLegs, `${id} darf keine Beinübung sein`);
    }
  });

  test('unbekannte Kennung wirft statt undefined zu liefern', () => {
    throws(() => exercise('kniebeuge_gibts_nicht'));
  });

  test('unbekannte Kennungen in alten Logs reißen das Volumen nicht', () => {
    // Importierte oder uralte Daten können Übungen tragen, die der Katalog
    // nicht mehr kennt — die Auswertung überspringt sie, statt zu werfen.
    const volume = setsPerMuscle([{ exercises: [
      { exId: 'uebung_aus_anderer_version', sets: [{ reps: 10 }] },
      { exId: 'ohp_db', sets: [{ reps: 10 }] },
    ] }]);
    eq(volume.shoulders, 1, 'die bekannte Übung zählt normal');
  });

  test('AUS DEM PLAN GEFALLENE ÜBUNGEN BLEIBEN IM KATALOG', () => {
    /* Sonst würde exercise() bei alten geloggten Sätzen werfen und ein Monat
       Trainingsdaten wäre nicht mehr auswertbar. Diese Übungen stehen nicht
       mehr im Plan — auflösbar müssen sie trotzdem bleiben. */
    for (const id of ['rdl', 'row_db', 'curl_db', 'curl_hammer', 'lateral_raise',
                      'chest_fly_cable', 'incline_press_db', 'pullup_negative',
                      'triceps_overhead', 'leg_curl_eccentric', 'leg_curl_slider',
                      'copenhagen_plank', 'calf_raise', 'pallof_press',
                      /* seit 30. Juli 2026 aus dem Beintag geflogen */
                      'split_squat_bulgarian', 'adductor_machine']) {
      exercise(id); // wirft, wenn gelöscht
    }
  });
});

suite('Plan — Flockes Vorgabe, wörtlich', () => {
  test('jede Übung im Plan steht im Katalog', () => {
    for (const session of SESSIONS) {
      for (const entry of sessionExercises(session)) {
        exercise(entry.id); // wirft, wenn unbekannt
        if (entry.alternative) exercise(entry.alternative);
      }
    }
  });

  test('jeder Übungseintrag hat Sätze und einen sinnvollen Wiederholungsbereich', () => {
    for (const session of SESSIONS) {
      for (const e of sessionExercises(session)) {
        isTrue(Number.isInteger(e.sets) && e.sets > 0, `${e.id}: sets ${e.sets}`);
        isTrue(e.repsMin <= e.repsMax, `${e.id}: ${e.repsMin}–${e.repsMax}`);
        isTrue(e.rpe >= 6 && e.rpe <= 10, `${e.id}: RPE ${e.rpe}`);
      }
    }
  });

  test('die drei Einheiten liegen auf Montag, Dienstag und Donnerstag', () => {
    deepEq(SESSIONS.map((s) => s.weekday), [1, 2, 4]);
    eq(sessionForWeekday(1).id, 'a-push');
    eq(sessionForWeekday(2).id, 'b-pull');
    eq(sessionForWeekday(4).id, 'c-legs');
    eq(sessionForWeekday(3), null, 'Mittwoch ist Mannschaftstraining');
    eq(sessionForWeekday(0), null, 'Sonntag ist Spieltag');
  });

  test('PUSH steht genau so, wie Flocke ihn vorgegeben hat', () => {
    const push = sessionExercises(sessionById('a-push'));
    deepEq(push.map((e) => e.id), [
      'curl_incline_db',        // Bizepsschrägbankcurls 3× 8–12
      'bench_press_db',         // Bankdrücken KH        3× 4–8
      'chest_fly_db',           // Fliegende KH          2× 6–10
      'incline_press_multi',    // Schrägbank Multi      2× 4–8
      'ohp_db',                 // Schulterdrücken KH    2× 6–8
      'lateral_raise_machine',  // Seitheben Maschine    3× 6–10
    ]);
    deepEq(push.map((e) => [e.sets, e.repsMin, e.repsMax]), [
      [3, 8, 12], [3, 4, 8], [2, 6, 10], [2, 4, 8], [2, 6, 8], [3, 6, 10],
    ]);
  });

  test('PULL steht genau so, wie Flocke ihn vorgegeben hat', () => {
    const pull = sessionExercises(sessionById('b-pull'));
    deepEq(pull.map((e) => e.id), [
      'triceps_pushdown_single',  // Trizepsdrücken einarmig 3× 8–12
      'lat_pulldown',             // Latzug breit            3× 6–10
      'row_wide',                 // Breites Rudern          3× 6–10
      'row_bb',                   // Rudern LH               2× 6–10
      'face_pull',                // Face Pulls              2× 8–12
    ]);
    deepEq(pull.map((e) => [e.sets, e.repsMin, e.repsMax]), [
      [3, 8, 12], [3, 6, 10], [3, 6, 10], [2, 6, 10], [2, 8, 12],
    ]);
  });

  test('DER BEINTAG steht genau so, wie Flocke ihn vorgegeben hat', () => {
    // Reihenfolge und Sätze nach Flockes Ansage vom 30. Juli 2026.
    const legs = sessionExercises(sessionById('c-legs'));
    deepEq(legs.map((e) => e.id), [
      'curl_cable',              // Bizepscurls Kabel     3× 8–12
      'triceps_pushdown',        // Trizepsdrücken        3× 8–12
      'leg_curl_machine',        // Beinbeuger Maschine   3× 8–12
      'squat_bb',                // Kniebeuge LH          3× 4–8
      'rdl_db',                  // RDLs KH               2× 6–10
      'leg_extension',           // Beinstrecker          2× 6–10
    ]);
    deepEq(legs.map((e) => [e.sets, e.repsMin, e.repsMax]), [
      [3, 8, 12], [3, 8, 12], [3, 8, 12], [3, 4, 8], [2, 6, 10], [2, 6, 10],
    ]);
  });

  test('der Bizeps steht am Beintag VOR dem Trizeps', () => {
    // Flockes ausdrückliche Vorgabe — die Reihenfolge der beiden Armübungen
    // ist keine Nebensache, sonst wäre sie nicht angesagt worden.
    const ids = sessionExercises(sessionById('c-legs')).map((e) => e.id);
    isTrue(ids.indexOf('curl_cable') < ids.indexOf('triceps_pushdown'),
      `Reihenfolge war ${ids.slice(0, 2).join(' vor ')}`);
  });

  test('der Beinbeuger steht vor der Kniebeuge', () => {
    // Umgekehrt wäre der Beuger beim schweren Beugen schon platt.
    const ids = sessionExercises(sessionById('c-legs')).map((e) => e.id);
    isTrue(ids.indexOf('leg_curl_machine') < ids.indexOf('squat_bb'));
  });

  test('BEINÜBUNGEN STEHEN AUSSCHLIESSLICH IM BEINTAG', () => {
    // Die zentrale Zusage: Montag und Dienstag fassen die Beine nicht an,
    // Freitag und Samstag gibt es gar kein Training.
    for (const session of SESSIONS) {
      const legDay = session.weekday === 4;
      for (const e of sessionExercises(session)) {
        if (EXERCISES[e.id].loadsLegs) {
          isTrue(legDay, `${e.id} steht am Wochentag ${session.weekday}`);
        }
      }
    }
  });

  test('die Armübungen stehen vorne — sie fallen sonst als Erstes weg', () => {
    for (const id of ['a-push', 'b-pull', 'c-legs']) {
      const first = sessionExercises(sessionById(id))[0];
      const group = EXERCISES[first.id].primary;
      isTrue(['biceps', 'triceps'].includes(group),
        `${id} beginnt mit ${first.id} (${group})`);
    }
  });

  test('plannedSets zählt die Sätze einer Einheit', () => {
    eq(plannedSets(sessionById('a-push')), 15);
    eq(plannedSets(sessionById('b-pull')), 13);
    eq(plannedSets(sessionById('c-legs')), 16);
  });

  test('Woche 4 ist Deload', () => {
    eq(PLAN.progression.deloadWeek, 4);
    eq(PLAN.progression.deloadSetsDelta, -1);
    isTrue(PLAN.progression.deloadRpeCap <= 7);
  });
});

suite('volume — Zählweise', () => {
  test('emptyVolume kennt jede Muskelgruppe und startet bei 0', () => {
    const v = emptyVolume();
    for (const key of Object.keys(MUSCLE_GROUPS)) eq(v[key], 0, key);
  });

  test('eine Hauptgruppe zählt einen ganzen Satz', () => {
    // 4 Sätze Seitheben an der Maschine — reine Schulterübung ohne Nebengruppen.
    const v = setsPerMuscle([
      { exercises: [{ exId: 'lateral_raise_machine', sets: Array(4).fill({ reps: 15, kg: 8 }) }] },
    ]);
    close(v.shoulders, 4);
    close(v.triceps, 0);
  });

  test('eine Nebengruppe zählt einen halben Satz', () => {
    // Schulterdrücken: Schulter Haupt, Trizeps und Brust Neben.
    const v = setsPerMuscle([
      { exercises: [{ exId: 'ohp_db', sets: Array(4).fill({ reps: 8, kg: 20 }) }] },
    ]);
    close(v.shoulders, 4);
    close(v.triceps, 4 * SECONDARY_SHARE);
    close(v.chest, 4 * SECONDARY_SHARE);
  });

  test('mehrere Übungen und Einheiten werden addiert', () => {
    const v = setsPerMuscle([
      { exercises: [{ exId: 'curl_cable', sets: Array(3).fill({ reps: 10, kg: 15 }) }] },
      { exercises: [{ exId: 'curl_cable', sets: Array(2).fill({ reps: 10, kg: 15 }) }] },
    ]);
    close(v.biceps, 5);
  });

  test('nur tatsächlich geloggte Sätze zählen', () => {
    // Zwei von vier geplanten Sätzen gemacht: es zählen zwei.
    const v = setsPerMuscle([
      { exercises: [{ exId: 'curl_cable', sets: [{ reps: 12, kg: 15 }, { reps: 10, kg: 15 }] }] },
    ]);
    close(v.biceps, 2);
  });

  test('unbekannte Übung wird übersprungen statt zu werfen', () => {
    // Alte Logs können Übungen tragen, die der Katalog nicht mehr kennt.
    deepEq(
      setsPerMuscle([{ exercises: [{ exId: 'quatsch', sets: [{ reps: 1, kg: 1 }] }] }]),
      emptyVolume()
    );
  });

  test('leere Eingabe ergibt lauter Nullen, nicht undefined', () => {
    deepEq(setsPerMuscle([]), emptyVolume());
    deepEq(setsPerMuscle(null), emptyVolume());
  });
});

suite('volume — Tonnage', () => {
  test('Tonnage ist Wiederholungen mal Gewicht, aufsummiert', () => {
    const t = tonnage([
      { exercises: [{ exId: 'ohp_db', sets: [{ reps: 10, kg: 20 }, { reps: 8, kg: 22.5 }] }] },
    ]);
    close(t, 10 * 20 + 8 * 22.5, 0.001);
  });

  test('Sätze ohne Gewicht zählen nicht mit', () => {
    const t = tonnage([
      { exercises: [{ exId: 'copenhagen_plank', sets: [{ reps: 30, kg: null }] }] },
    ]);
    close(t, 0);
  });

  test('totalSets zählt jeden geloggten Satz genau einmal', () => {
    eq(totalSets([
      { exercises: [
        { exId: 'ohp_db', sets: Array(4).fill({ reps: 8, kg: 20 }) },
        { exId: 'lateral_raise_machine', sets: Array(3).fill({ reps: 15, kg: 8 }) },
      ] },
    ]), 7);
  });
});

suite('volume — der Plan in Zahlen', () => {
  const planned = plannedSetsPerMuscle(SESSIONS);

  test('das geplante Wochenvolumen ist berechenbar', () => {
    close(planned.hamstrings, 5, 0.001, 'Beinbeuger 3 + RDL 2');
    close(planned.quads, 5, 0.001, 'Kniebeuge 3 + Beinstrecker 2');
    close(planned.glutes, 2.5, 0.001, 'je zur Hälfte aus Kniebeuge und RDL');
    close(planned.adductors, 0, 0.001, 'Adduktoren stehen nicht mehr im Plan');
    close(planned.calves, 0, 0.001, 'Waden stehen nicht mehr im Plan');
    eq(SESSIONS.reduce((n, s) => n + plannedSets(s), 0), 44, 'Sätze pro Woche');
  });

  test('KEIN SCHWERPUNKT: die großen Oberkörpergruppen liegen dicht beieinander', () => {
    /* Flockes ausdrückliche Vorgabe nach dem ersten Entwurf. Der Test hält die
       Balance fest, damit spätere Planänderungen sie nicht unbemerkt kippen.
       Die Untergrenze liegt bei 8 und nicht bei 10, weil dieser Plan von Flocke
       vorgegeben ist: die Brust kommt mit 8 Sätzen aus, und das ist eine
       Entscheidung, keine Nachlässigkeit. */
    const gruppen = ['chest', 'back', 'shoulders', 'biceps', 'triceps'];
    const werte = gruppen.map((g) => planned[g]);
    const groesste = Math.max(...werte);
    const kleinste = Math.min(...werte);

    isTrue(kleinste >= 8,
      `jede Gruppe braucht mindestens 8 Sätze, kleinste war ${kleinste}`);
    isTrue(groesste / kleinste <= 1.35,
      `Verhältnis ${groesste} zu ${kleinste} = ${(groesste / kleinste).toFixed(2)} — `
      + 'das wäre wieder ein Schwerpunkt');
  });

  test('keine einzelne Oberkörpergruppe nimmt mehr als ein Viertel ein', () => {
    const bezug = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'traps'];
    for (const g of ['chest', 'back', 'shoulders', 'biceps', 'triceps']) {
      const anteil = shareOf(planned, [g], bezug);
      isTrue(anteil <= 0.25, `${g}: ${(anteil * 100).toFixed(1)} %`);
    }
  });

  test('der Rücken bekommt mindestens so viel wie die Brust', () => {
    // Viel Drücken ohne Ziehen führt zuverlässig zu Schulterproblemen.
    isTrue(planned.back >= planned.chest,
      `Rücken ${planned.back} gegen Brust ${planned.chest}`);
  });

  test('das Beinvolumen bleibt bewusst niedrig', () => {
    const legs = planned.quads + planned.hamstrings + planned.calves + planned.glutes;
    const upper = planned.shoulders + planned.chest + planned.back
                + planned.biceps + planned.triceps;
    isTrue(legs < upper * 0.4,
      `Beine ${legs} gegen Oberkörper ${upper} — Fußball macht den Rest`);
  });
});
