import { suite, test, eq, close, deepEq, isTrue, throws } from './harness.js';
import { MUSCLE_GROUPS, EXERCISES, SECONDARY_SHARE, exercise, exerciseLabel }
  from '../data/exercises.js';
import { SESSIONS, PLAN, sessionForWeekday, sessionExercises, sessionById }
  from '../data/plan-default.js';
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
    for (const id of ['rdl', 'split_squat_bulgarian', 'leg_curl_eccentric',
                      'copenhagen_plank', 'calf_raise']) {
      isTrue(EXERCISES[id].loadsLegs, `${id} muss als Beinübung gelten`);
    }
    for (const id of ['ohp_db', 'lat_pulldown', 'curl_db', 'lateral_raise']) {
      isTrue(!EXERCISES[id].loadsLegs, `${id} darf keine Beinübung sein`);
    }
  });

  test('unbekannte Kennung wirft statt undefined zu liefern', () => {
    throws(() => exercise('kniebeuge_gibts_nicht'));
    eq(exerciseLabel('rdl'), 'Rumänisches Kreuzheben (Langhantel)');
  });
});

suite('Plan — Stimmigkeit gegen den Katalog', () => {
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
    eq(sessionForWeekday(4).id, 'c-legs-shoulders');
    eq(sessionForWeekday(3), null, 'Mittwoch ist Mannschaftstraining');
    eq(sessionForWeekday(0), null, 'Sonntag ist Spieltag');
  });

  test('BEINÜBUNGEN STEHEN AUSSCHLIESSLICH IM DONNERSTAGS-PLAN', () => {
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

  test('DAS BEINVOLUMEN BLEIBT UNVERÄNDERT', () => {
    // Beim Umbau auf Gleichverteilung durfte sich am Beintag nichts ändern:
    // gleiche Übungen, gleiche Sätze, gleiche Frequenz.
    const donnerstag = sessionExercises(sessionById('c-legs-shoulders'));
    const beine = donnerstag.filter((e) => EXERCISES[e.id].loadsLegs);
    deepEq(beine.map((e) => e.id),
      ['rdl', 'split_squat_bulgarian', 'leg_curl_eccentric', 'copenhagen_plank', 'calf_raise']);
    deepEq(beine.map((e) => e.sets), [3, 3, 3, 3, 3]);
    eq(beine.reduce((n, e) => n + e.sets, 0), 15, '15 Beinsätze, einmal pro Woche');
  });

  test('der Donnerstag trägt einen eigenen Prophylaxeblock', () => {
    const donnerstag = sessionById('c-legs-shoulders');
    const block = donnerstag.blocks.find((b) => b.prophylaxis);
    isTrue(Boolean(block), 'Prophylaxeblock fehlt');
    const ids = block.exercises.map((e) => e.id);
    isTrue(ids.includes('leg_curl_eccentric'), 'Hamstrings fehlen');
    isTrue(ids.includes('copenhagen_plank'), 'Adduktoren fehlen');
    isTrue(ids.includes('calf_raise'), 'Waden fehlen');
  });

  test('es gibt eine Ersatzübung, wenn die Beincurl-Maschine belegt ist', () => {
    const entry = sessionExercises(sessionById('c-legs-shoulders'))
      .find((e) => e.id === 'leg_curl_eccentric');
    eq(entry.alternative, 'leg_curl_slider');
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
    // 4 Sätze Seitheben — reine Schulterübung ohne Nebengruppen.
    const v = setsPerMuscle([
      { exercises: [{ exId: 'lateral_raise', sets: Array(4).fill({ reps: 15, kg: 8 }) }] },
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
      { exercises: [{ exId: 'lateral_raise', sets: Array(3).fill({ reps: 15, kg: 8 }) }] },
      { exercises: [{ exId: 'lateral_raise', sets: Array(2).fill({ reps: 15, kg: 8 }) }] },
    ]);
    close(v.shoulders, 5);
  });

  test('nur tatsächlich geloggte Sätze zählen', () => {
    // Zwei von vier geplanten Sätzen gemacht: es zählen zwei.
    const v = setsPerMuscle([
      { exercises: [{ exId: 'lateral_raise', sets: [{ reps: 15, kg: 8 }, { reps: 12, kg: 8 }] }] },
    ]);
    close(v.shoulders, 2);
  });

  test('unbekannte Übung wirft', () => {
    throws(() => setsPerMuscle([{ exercises: [{ exId: 'quatsch', sets: [{ reps: 1, kg: 1 }] }] }]));
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

  test('Sätze ohne Gewicht zählen nicht mit — Copenhagen Plank hat keine Kilo', () => {
    const t = tonnage([
      { exercises: [{ exId: 'copenhagen_plank', sets: [{ reps: 30, kg: null }] }] },
    ]);
    close(t, 0);
  });

  test('totalSets zählt jeden geloggten Satz genau einmal', () => {
    eq(totalSets([
      { exercises: [
        { exId: 'ohp_db', sets: Array(4).fill({ reps: 8, kg: 20 }) },
        { exId: 'lateral_raise', sets: Array(3).fill({ reps: 15, kg: 8 }) },
      ] },
    ]), 7);
  });
});

suite('volume — der Plan in Zahlen', () => {
  const planned = plannedSetsPerMuscle(SESSIONS);

  test('das geplante Wochenvolumen ist berechenbar', () => {
    close(planned.hamstrings, 6, 0.001, 'RDL 3 + Beincurl 3');
    close(planned.quads, 3, 0.001, 'nur Bulgarische Kniebeuge');
    close(planned.calves, 3, 0.001);
    close(planned.adductors, 3, 0.001, 'Copenhagen Plank');
  });

  test('KEIN SCHWERPUNKT: die großen Oberkörpergruppen liegen dicht beieinander', () => {
    // Flockes ausdrückliche Vorgabe nach dem ersten Entwurf. Der Test hält
    // die Balance fest, damit spätere Planänderungen sie nicht unbemerkt
    // kippen — in die eine oder die andere Richtung.
    const gruppen = ['chest', 'back', 'shoulders', 'biceps', 'triceps'];
    const werte = gruppen.map((g) => planned[g]);
    const groesste = Math.max(...werte);
    const kleinste = Math.min(...werte);

    isTrue(kleinste >= 10,
           `jede Gruppe braucht mindestens 10 Sätze, kleinste war ${kleinste}`);
    isTrue(groesste / kleinste <= 1.35,
           `Verhältnis ${groesste} zu ${kleinste} = ${(groesste / kleinste).toFixed(2)} — `
           + `das wäre wieder ein Schwerpunkt`);
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
    // Gleichverteilung heißt nicht, dass die Statik egal wird.
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
