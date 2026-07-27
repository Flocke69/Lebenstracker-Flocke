/* Trainingsvolumen je Muskelgruppe.
 *
 * Gezählt wird in Sätzen, nicht in Kilo: für den Muskelaufbau ist die Zahl
 * harter Sätze pro Muskelgruppe und Woche die aussagekräftigere Größe.
 * Tonnage steht trotzdem daneben, weil sie bei einer einzelnen Übung gut
 * zeigt, ob es vorangeht.
 *
 * Eine Hauptmuskelgruppe zählt einen ganzen Satz, eine Nebengruppe einen
 * halben. Beim Schulterdrücken bekommt die Schulter also 1,0 und der Trizeps
 * 0,5 pro Satz. Das ist die übliche Zählweise — sie überschätzt indirekte
 * Arbeit nicht und ignoriert sie auch nicht.
 *
 * Gezählt werden nur TATSÄCHLICH GELOGGTE Sätze. Was geplant war und nicht
 * gemacht wurde, taucht hier nicht auf — sonst wäre das Review wertlos.
 */

import { EXERCISES, MUSCLE_GROUPS, SECONDARY_SHARE, exercise } from '../../data/exercises.js';
import { sessionExercises } from '../../data/plan-default.js';

/** Ein Volumenobjekt mit allen Muskelgruppen auf 0. */
export function emptyVolume() {
  return Object.fromEntries(Object.keys(MUSCLE_GROUPS).map((key) => [key, 0]));
}

function addExerciseVolume(volume, exId, setCount) {
  const ex = exercise(exId);
  volume[ex.primary] += setCount;
  for (const secondary of ex.secondary) {
    volume[secondary] += setCount * SECONDARY_SHARE;
  }
  return volume;
}

/**
 * Sätze je Muskelgruppe aus geloggten Einheiten.
 *
 * @param {Array<{exercises: Array<{exId: string, sets: Array}>}>} sessions
 */
export function setsPerMuscle(sessions) {
  const volume = emptyVolume();
  for (const session of sessions ?? []) {
    for (const entry of session?.exercises ?? []) {
      // Lücken im Logger sind `null` — sie zählen nicht als gemachter Satz.
      const count = (entry?.sets ?? []).filter(Boolean).length;
      if (count === 0) continue;
      addExerciseVolume(volume, entry.exId, count);
    }
  }
  return volume;
}

/**
 * Sätze je Muskelgruppe aus dem PLAN — also was vorgesehen ist.
 *
 * Nur für Vergleiche und die Plan-Übersicht. Für Trends und Reviews zählt
 * ausschließlich setsPerMuscle().
 */
export function plannedSetsPerMuscle(planSessions) {
  const volume = emptyVolume();
  for (const session of planSessions ?? []) {
    for (const entry of sessionExercises(session)) {
      addExerciseVolume(volume, entry.id, entry.sets);
    }
  }
  return volume;
}

/** Summe aus Wiederholungen mal Gewicht. Sätze ohne Gewicht zählen 0. */
export function tonnage(sessions) {
  let total = 0;
  for (const session of sessions ?? []) {
    for (const entry of session?.exercises ?? []) {
      for (const set of entry?.sets ?? []) {
        const reps = Number(set?.reps);
        const kg = Number(set?.kg);
        if (Number.isFinite(reps) && Number.isFinite(kg)) total += reps * kg;
      }
    }
  }
  return total;
}

/** Zahl der geloggten Sätze insgesamt. */
export function totalSets(sessions) {
  let count = 0;
  for (const session of sessions ?? []) {
    for (const entry of session?.exercises ?? []) {
      count += (entry?.sets ?? []).filter(Boolean).length;
    }
  }
  return count;
}

/** Summe über ausgewählte Muskelgruppen. */
export function sumOf(volume, groups) {
  return groups.reduce((acc, key) => acc + (volume[key] ?? 0), 0);
}

/** Anteil einer Gruppenauswahl an einer Bezugsmenge. 0, wenn die Bezugsmenge leer ist. */
export function shareOf(volume, groups, reference) {
  const base = sumOf(volume, reference);
  return base === 0 ? 0 : sumOf(volume, groups) / base;
}

/** Muskelgruppen nach Volumen absteigend — für die Anzeige. */
export function rankedMuscles(volume) {
  return Object.entries(volume)
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, sets]) => ({ key, label: MUSCLE_GROUPS[key], sets }));
}

/** Alle Übungen, die eine bestimmte Muskelgruppe treffen. */
export function exercisesForMuscle(group) {
  return Object.entries(EXERCISES)
    .filter(([, ex]) => ex.primary === group || ex.secondary.includes(group))
    .map(([id]) => id);
}
