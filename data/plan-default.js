/* Flockes Trainingsplan.
 *
 * DIESER PLAN IST VORGEGEBEN, nicht abgeleitet. Übungen, Sätze und
 * Wiederholungsbereiche stehen genau so, wie Flocke sie festgelegt hat. Wer
 * hier etwas ändert, ändert Flockes Plan — nicht einen Vorschlag der App.
 *
 * Randbedingungen, in die er eingebettet ist:
 *   Fußball    Mannschaftstraining Mittwoch, Spiel Sonntag
 *   Gym        Montag (Push), Dienstag (Pull), Donnerstag (Beine)
 *   Ziel       Recomp, Oberkörper gleichmäßig verteilt
 *   Beine      1× pro Woche, maximal weit vom Spiel
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
 * Die Armübungen sind absichtlich über alle drei Tage verteilt und stehen
 * teils VORNE: ein Satz Bizeps zu Beginn kostet beim Drücken danach nichts,
 * und was am Anfang steht, fällt nicht weg, wenn die Zeit knapp wird.
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
 * `blocks` bleibt als Struktur erhalten, damit der Logger Gruppen abtrennen
 * kann. Dieser Plan hat pro Tag genau einen Block ohne Namen — die
 * Reihenfolge ist die Vorgabe, mehr braucht es nicht. Ein Block ohne `name`
 * wird ohne Überschrift gezeichnet.
 */
export const SESSIONS = Object.freeze([
  {
    id: 'a-push',
    weekday: 1,
    name: 'Push',
    focus: 'Brust, Schulter, Trizeps — plus Bizeps vorweg',
    intro:
      'Der Tag nach dem Spiel. Die Beine sind müde, der Oberkörper nicht — '
      + 'deshalb liegt hier das schwere Drücken. Der Bizeps steht vorne, weil '
      + 'er beim Drücken danach nicht im Weg ist.',
    blocks: [
      {
        name: null,
        exercises: [
          { id: 'curl_incline_db', sets: 3, repsMin: 8, repsMax: 12, rpe: 9 },
          { id: 'bench_press_db', sets: 3, repsMin: 4, repsMax: 8, rpe: 8 },
          { id: 'chest_fly_db', sets: 2, repsMin: 6, repsMax: 10, rpe: 9 },
          { id: 'incline_press_multi', sets: 2, repsMin: 4, repsMax: 8, rpe: 8 },
          { id: 'ohp_db', sets: 2, repsMin: 6, repsMax: 8, rpe: 8 },
          { id: 'lateral_raise_machine', sets: 3, repsMin: 6, repsMax: 10, rpe: 9 },
        ],
      },
    ],
  },

  {
    id: 'b-pull',
    weekday: 2,
    name: 'Pull',
    focus: 'Rücken und hintere Schulter — plus Trizeps vorweg',
    intro:
      'Zieharbeit hält die Schulter im Gleichgewicht. Ohne sie führt das viele '
      + 'Drücken von Montag über Monate zu Problemen. Der Trizeps steht vorne, '
      + 'weil er beim Ziehen danach nicht mitarbeitet.',
    blocks: [
      {
        name: null,
        exercises: [
          { id: 'triceps_pushdown_single', sets: 3, repsMin: 8, repsMax: 12, rpe: 9 },
          { id: 'lat_pulldown', sets: 3, repsMin: 6, repsMax: 10, rpe: 8 },
          { id: 'row_wide', sets: 3, repsMin: 6, repsMax: 10, rpe: 8 },
          { id: 'row_bb', sets: 2, repsMin: 6, repsMax: 10, rpe: 8 },
          { id: 'face_pull', sets: 2, repsMin: 8, repsMax: 12, rpe: 8 },
        ],
      },
    ],
  },

  {
    id: 'c-legs',
    weekday: 4,
    name: 'Beintag',
    focus: 'der einzige Beintag — plus Arme vorweg',
    intro:
      'Drei Tage vor dem Spiel: der einzige Tag der Woche, an dem schwere '
      + 'Beinarbeit geht. Wenig Sätze, dafür schwer. Muskelkater am Sonntag '
      + 'entsteht durch Wiederholungen, nicht durch Gewicht. Die Armsätze '
      + 'stehen vorne — sie brauchen kaum Pause und verlängern die Einheit '
      + 'praktisch nicht.',
    blocks: [
      {
        name: null,
        exercises: [
          { id: 'triceps_pushdown', sets: 3, repsMin: 8, repsMax: 12, rpe: 9 },
          { id: 'curl_cable', sets: 3, repsMin: 8, repsMax: 12, rpe: 9 },
          { id: 'rdl_db', sets: 3, repsMin: 4, repsMax: 8, rpe: 8 },
          { id: 'split_squat_bulgarian', sets: 3, repsMin: 6, repsMax: 10, rpe: 8 },
          { id: 'leg_extension', sets: 2, repsMin: 6, repsMax: 10, rpe: 9 },
          { id: 'adductor_machine', sets: 2, repsMin: 6, repsMax: 10, rpe: 9 },
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
    block.exercises.map((entry) => ({
      ...entry,
      block: block.name,
      prophylaxis: Boolean(block.prophylaxis),
    }))
  );
}

/** Geplante Satzzahl einer Einheit. */
export function plannedSets(session) {
  return sessionExercises(session).reduce((sum, e) => sum + e.sets, 0);
}

export const PLAN = Object.freeze({
  id: PLAN_ID,
  name: 'Recomp neben Fußball — Push, Pull, Beine',
  blockWeeks: BLOCK_WEEKS,
  progression: PROGRESSION,
  sessions: SESSIONS,
});
