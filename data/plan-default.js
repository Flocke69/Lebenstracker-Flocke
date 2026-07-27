/* Flockes Trainingsplan.
 *
 * Randbedingungen, aus denen er entstanden ist:
 *   Fußball    Mannschaftstraining Mittwoch, Spiel Sonntag
 *   Gym        Montag, Dienstag, Donnerstag — 60 bis 75 Minuten
 *   Ziel       Recomp, Oberkörper GLEICHMÄSSIG verteilt
 *   Beine      1× schwer, maximal weit vom Spiel, plus Prophylaxe
 *   Gegeben    keine Klimmzüge möglich, kein Gerät für Nordic Curls
 *
 * KEIN SCHWERPUNKT. Brust, Rücken, Schultern, Bizeps und Trizeps bekommen
 * jeweils 11 bis 14 Sätze pro Woche — der Abstand zwischen der stärksten und
 * der schwächsten Gruppe liegt unter dem Faktor 1,3. Ein Test in
 * tests/volume.test.js hält das fest, damit spätere Planänderungen die
 * Balance nicht unbemerkt kippen.
 *
 * Dass der Rücken oben liegt, ist kein Schwerpunkt, sondern Statik: er zieht
 * die Schulter gegen alles Drücken zurück. Und dass die Schulter hoch liegt,
 * lässt sich nicht vermeiden — sie arbeitet bei jedem Druck mit und bekommt
 * zusätzlich die Face Pulls ab.
 *
 * Warum die Einheiten so liegen:
 *
 * Montag und Dienstag hängen zusammen, deshalb müssen sie maximal
 * verschieden sein — Drücken und Ziehen. Zwei gleichartige Tage
 * hintereinander wären die schlechteste aller Anordnungen.
 *
 * Der Bein-Slot liegt auf Donnerstag: 3 Tage vor dem Spiel, 4 Tage danach,
 * und einen Tag nach dem Mannschaftstraining statt davor. Mittwoch wäre
 * rechnerisch auch erlaubt, aber schwere Sätze auf Fußballbeine sind
 * schlechtere Sätze. Freitag und Samstag bleiben frei — du gehst mit zwei
 * Ruhetagen ins Spiel.
 *
 * WEIGHTS STEHEN HIER NICHT DRIN. Der Plan legt Übungen, Sätze,
 * Wiederholungsbereiche und RPE fest. Die Gewichte trägst du beim ersten Mal
 * selbst ein, danach zeigt der Logger "letztes Mal" an jeder Übung. Zahlen
 * vorzugeben, die niemand kennt, wäre geraten.
 *
 * PROGRESSION: doppelte Progression. Erst die Wiederholungen im Zielbereich
 * hochschieben, bis in allen Sätzen die obere Grenze steht — dann das
 * Gewicht erhöhen und wieder unten anfangen. Woche 4 ist Deload: gleiche
 * Übungen, ein Satz weniger, RPE höchstens 6.
 *
 * RPE = wie nah am Muskelversagen. RPE 8 heißt: zwei Wiederholungen wären
 * noch gegangen. RPE 10 heißt: keine mehr.
 */

export const PLAN_ID = 'flocke-2026-08';

/** Wochen im Block. Die letzte ist immer Deload. */
export const BLOCK_WEEKS = 4;

export const PROGRESSION = Object.freeze({
  type: 'double',
  description:
    'Erst Wiederholungen bis zur oberen Grenze in allen Sätzen, dann Gewicht hoch '
    + 'und wieder bei der unteren Grenze anfangen.',
  deloadWeek: 4,
  deloadSetsDelta: -1,
  deloadRpeCap: 6,
});

/**
 * Die drei Einheiten.
 *
 * `weekday` folgt der JS-Konvention: 0 = Sonntag … 6 = Samstag.
 * `blocks` gruppiert die Übungen, damit der Logger den Prophylaxeteil
 * sichtbar abtrennen kann — er wird sonst als Erstes weggelassen.
 */
export const SESSIONS = Object.freeze([
  {
    id: 'a-push',
    weekday: 1,
    name: 'Drücken',
    focus: 'Brust, Schulter, Trizeps',
    intro:
      'Der Tag nach dem Spiel. Die Beine sind müde, der Oberkörper nicht — '
      + 'deshalb liegt hier das schwere Drücken.',
    blocks: [
      {
        name: 'Hauptteil',
        exercises: [
          { id: 'bench_press_db', sets: 4, repsMin: 6, repsMax: 10, rpe: 8 },
          { id: 'incline_press_db', sets: 3, repsMin: 8, repsMax: 12, rpe: 8 },
          { id: 'chest_fly_cable', sets: 3, repsMin: 12, repsMax: 15, rpe: 9 },
        ],
      },
      {
        name: 'Schulter und Arm',
        exercises: [
          { id: 'ohp_db', sets: 3, repsMin: 6, repsMax: 10, rpe: 8 },
          { id: 'lateral_raise', sets: 3, repsMin: 12, repsMax: 20, rpe: 9 },
          { id: 'triceps_overhead', sets: 3, repsMin: 10, repsMax: 15, rpe: 9 },
        ],
      },
    ],
  },

  {
    id: 'b-pull',
    weekday: 2,
    name: 'Ziehen',
    focus: 'Rücken und Bizeps',
    intro:
      'Zieharbeit hält die Schulter im Gleichgewicht. Ohne sie führt das viele '
      + 'Drücken von Montag über Monate zu Problemen.',
    blocks: [
      {
        name: 'Hauptteil',
        exercises: [
          { id: 'lat_pulldown', sets: 4, repsMin: 8, repsMax: 12, rpe: 8 },
          {
            id: 'pullup_negative',
            sets: 3,
            repsMin: 3,
            repsMax: 5,
            rpe: 8,
            goal: 'Ziel: die ersten drei sauberen Klimmzüge. 4–5 Sekunden ablassen.',
          },
          { id: 'row_db', sets: 4, repsMin: 8, repsMax: 12, rpe: 8 },
          { id: 'face_pull', sets: 3, repsMin: 15, repsMax: 20, rpe: 8 },
        ],
      },
      {
        name: 'Arme',
        exercises: [
          { id: 'curl_db', sets: 3, repsMin: 10, repsMax: 15, rpe: 9 },
          { id: 'curl_hammer', sets: 3, repsMin: 10, repsMax: 15, rpe: 9 },
        ],
      },
    ],
  },

  {
    id: 'c-legs-shoulders',
    weekday: 4,
    name: 'Beine und Rumpf',
    focus: 'der einzige Beintag',
    intro:
      'Drei Tage vor dem Spiel — der einzige Tag der Woche, an dem schwere '
      + 'Beinarbeit geht. Wenig Sätze, dafür schwer. Muskelkater am Sonntag '
      + 'entsteht durch Wiederholungen, nicht durch Gewicht.',
    blocks: [
      {
        name: 'Schwer',
        exercises: [
          { id: 'rdl', sets: 3, repsMin: 6, repsMax: 8, rpe: 8 },
          { id: 'split_squat_bulgarian', sets: 3, repsMin: 8, repsMax: 10, rpe: 8 },
        ],
      },
      {
        name: 'Prophylaxe',
        prophylaxis: true,
        intro:
          'Zehn Minuten gegen die zwei häufigsten Ausfallursachen im '
          + 'Amateurfußball. Der Teil, der als Erstes wegfällt wenn es eng wird — '
          + 'und der Teil, der deine Saison rettet.',
        exercises: [
          {
            id: 'leg_curl_eccentric',
            sets: 3,
            repsMin: 8,
            repsMax: 10,
            rpe: 8,
            alternative: 'leg_curl_slider',
          },
          { id: 'copenhagen_plank', sets: 3, repsMin: 20, repsMax: 40, rpe: 7, unit: 'Sekunden' },
          { id: 'calf_raise', sets: 3, repsMin: 12, repsMax: 20, rpe: 8 },
        ],
      },
      {
        // Kurze Sätze mit wenig Pause — sie verlängern die Einheit kaum.
        name: 'Zum Abschluss',
        exercises: [
          { id: 'triceps_pushdown', sets: 3, repsMin: 12, repsMax: 15, rpe: 9 },
          { id: 'pallof_press', sets: 3, repsMin: 10, repsMax: 12, rpe: 7 },
        ],
      },
    ],
  },
]);

/** Einheit zu einem Wochentag, oder null an fußball- und ruhefreien Tagen. */
export function sessionForWeekday(weekday) {
  return SESSIONS.find((s) => s.weekday === weekday) ?? null;
}

/** Einheit über ihre Kennung. */
export function sessionById(id) {
  return SESSIONS.find((s) => s.id === id) ?? null;
}

/** Alle Übungseinträge einer Einheit, flach und in Reihenfolge. */
export function sessionExercises(session) {
  return session.blocks.flatMap((block) =>
    block.exercises.map((entry) => ({ ...entry, block: block.name, prophylaxis: Boolean(block.prophylaxis) }))
  );
}

export const PLAN = Object.freeze({
  id: PLAN_ID,
  name: 'Recomp neben Fußball — Schwerpunkt Schulter und Arm',
  blockWeeks: BLOCK_WEEKS,
  progression: PROGRESSION,
  sessions: SESSIONS,
});
