/* Übungskatalog.
 *
 * Jede Übung nennt die Muskelgruppe, die sie hauptsächlich trifft, und die,
 * die mitarbeiten. Daraus rechnet lib/volume.js das Wochenvolumen je
 * Muskelgruppe: eine Hauptgruppe zählt einen ganzen Satz, eine Nebengruppe
 * einen halben. Das ist die übliche Zählweise und der Grund, warum das
 * Review "Schultervolumen drei Wochen steigend" überhaupt erkennen kann.
 *
 * `loadsLegs` markiert Übungen, die planner.js an gesperrten Tagen
 * ausblendet. Es steht bewusst hier an der Übung und nicht im Plan: eine
 * Übung belastet die Beine oder nicht, unabhängig davon, in welcher Einheit
 * sie auftaucht.
 */

export const MUSCLE_GROUPS = Object.freeze({
  shoulders: 'Schultern',
  chest: 'Brust',
  back: 'Rücken',
  biceps: 'Bizeps',
  triceps: 'Trizeps',
  traps: 'Nacken',
  quads: 'Oberschenkel vorne',
  hamstrings: 'Oberschenkel hinten',
  glutes: 'Gesäß',
  calves: 'Waden',
  adductors: 'Adduktoren',
  core: 'Rumpf',
});

/** Anteil, mit dem eine Nebengruppe ins Volumen eingeht. */
export const SECONDARY_SHARE = 0.5;

export const EXERCISES = Object.freeze({
  /* ─── Drücken ────────────────────────────────────────────────────────── */

  ohp_db: {
    name: 'Schulterdrücken',
    variant: 'Kurzhantel, sitzend',
    primary: 'shoulders',
    secondary: ['triceps', 'chest'],
    loadsLegs: false,
    note: 'Sitzend mit Lehne — stehend kostet Rumpfkraft, die du beim Fußball brauchst.',
  },
  bench_press_db: {
    name: 'Bankdrücken',
    variant: 'Kurzhantel, flach',
    primary: 'chest',
    secondary: ['shoulders', 'triceps'],
    loadsLegs: false,
    note: 'Kurzhanteln statt Langhantel: größerer Bewegungsweg, und jede Seite muss '
        + 'ihre eigene Arbeit machen. Ohne Partner außerdem sicherer.',
  },
  incline_press_db: {
    name: 'Schrägbankdrücken',
    variant: 'Kurzhantel, 30 Grad',
    primary: 'chest',
    secondary: ['shoulders', 'triceps'],
    loadsLegs: false,
    note: 'Trifft den oberen Brustanteil, den flaches Drücken vernachlässigt.',
  },
  chest_fly_cable: {
    name: 'Brustfliegende',
    variant: 'Kabel oder Kurzhantel',
    primary: 'chest',
    secondary: [],
    loadsLegs: false,
    note: 'Der Reiz kommt aus der Dehnung, nicht aus dem Gewicht. Leicht beginnen, '
        + 'Ellenbogen leicht gebeugt lassen.',
  },
  lateral_raise: {
    name: 'Seitheben',
    variant: 'Kurzhantel',
    primary: 'shoulders',
    secondary: [],
    loadsLegs: false,
    note: 'Die Übung für breite Schultern. Leicht, sauber, viele Wiederholungen — nicht schwingen.',
  },
  triceps_overhead: {
    name: 'Trizeps über Kopf',
    variant: 'Kabel oder Kurzhantel',
    primary: 'triceps',
    secondary: [],
    loadsLegs: false,
    note: 'Über Kopf, weil der lange Trizepskopf nur in der Dehnung richtig arbeitet.',
  },
  triceps_pushdown: {
    name: 'Trizeps-Drücken',
    variant: 'Kabel, Seil',
    primary: 'triceps',
    secondary: [],
    loadsLegs: false,
  },

  /* ─── Ziehen ─────────────────────────────────────────────────────────── */

  lat_pulldown: {
    name: 'Latzug',
    variant: 'breiter Griff',
    primary: 'back',
    secondary: ['biceps'],
    loadsLegs: false,
    note: 'Trägt dein Zugvolumen, bis die ersten Klimmzüge stehen.',
  },
  pullup_negative: {
    name: 'Negativ-Klimmzüge',
    variant: 'hochspringen, langsam ablassen',
    primary: 'back',
    secondary: ['biceps'],
    loadsLegs: false,
    note: 'Hochspringen, dann 4–5 Sekunden kontrolliert ablassen. Der direkte Weg zum ersten '
        + 'echten Klimmzug — die Absenkphase baut genau die Kraft auf, die dir fehlt.',
  },
  row_db: {
    name: 'Rudern',
    variant: 'Kurzhantel, einarmig',
    primary: 'back',
    secondary: ['biceps'],
    loadsLegs: false,
  },
  face_pull: {
    name: 'Face Pulls',
    variant: 'Kabel, Seil, hoch',
    primary: 'shoulders',
    secondary: ['traps', 'back'],
    loadsLegs: false,
    note: 'Hintere Schulter. Der Gegenspieler zu allem Drücken — hält die Schulter gesund.',
  },
  curl_db: {
    name: 'Bizeps-Curls',
    variant: 'Kurzhantel',
    primary: 'biceps',
    secondary: [],
    loadsLegs: false,
  },
  curl_hammer: {
    name: 'Hammer-Curls',
    variant: 'Kurzhantel, neutraler Griff',
    primary: 'biceps',
    secondary: [],
    loadsLegs: false,
    note: 'Trifft den Armbeuger darunter — macht den Arm dicker als Curls allein.',
  },
  curl_incline_db: {
    name: 'Schrägbank-Curls',
    variant: 'Kurzhantel, zurückgelehnt',
    primary: 'biceps',
    secondary: [],
    loadsLegs: false,
    note: 'Zurückgelehnt hängen die Arme hinter dem Körper — der Bizeps startet in '
        + 'voller Dehnung. Das ist ein anderer Reiz als stehende Curls, deshalb '
        + 'steht die Übung an einem anderen Tag.',
  },

  /* ─── Beine ──────────────────────────────────────────────────────────── */

  rdl: {
    name: 'Rumänisches Kreuzheben',
    variant: 'Langhantel',
    primary: 'hamstrings',
    secondary: ['glutes', 'back'],
    loadsLegs: true,
    note: 'Die wichtigste Übung im Plan für deine Verletzungsprophylaxe. Hüfte nach hinten, '
        + 'Rücken gerade, Stange nah am Bein. Nicht bis zum Boden — bis die Dehnung kommt.',
  },
  split_squat_bulgarian: {
    name: 'Bulgarische Kniebeuge',
    variant: 'hinterer Fuß erhöht',
    primary: 'quads',
    secondary: ['glutes'],
    loadsLegs: true,
    note: 'Einbeinig, weil Fußball einbeinig ist. Weniger Gewicht als bei der Kniebeuge, '
        + 'gleicher Reiz, deutlich weniger Erschöpfung fürs Nervensystem.',
  },
  leg_curl_eccentric: {
    name: 'Beincurl mit langsamer Absenkphase',
    variant: 'Maschine, 4 Sekunden ablassen',
    primary: 'hamstrings',
    secondary: [],
    loadsLegs: true,
    note: 'Ersatz für Nordic Curls ohne Gerät und Partner. Hoch mit beiden Beinen zählt nicht — '
        + 'entscheidend ist das langsame, kontrollierte Ablassen unter Last.',
  },
  leg_curl_slider: {
    name: 'Beincurl mit Handtuch',
    variant: 'ohne Gerät, auf glattem Boden',
    primary: 'hamstrings',
    secondary: ['glutes'],
    loadsLegs: true,
    note: 'Fersen auf ein Handtuch, Hüfte hoch, Beine langsam ausstrecken. Die Notlösung, '
        + 'wenn die Beincurl-Maschine belegt ist — funktioniert auch zu Hause.',
  },
  copenhagen_plank: {
    name: 'Copenhagen Plank',
    variant: 'seitlich, oberes Bein auf der Bank',
    primary: 'adductors',
    secondary: ['core'],
    loadsLegs: true,
    note: 'Adduktorenzerrung ist nach der Oberschenkelverletzung die Nummer zwei im '
        + 'Amateurfußball. Kostet zwei Minuten pro Einheit.',
  },
  calf_raise: {
    name: 'Wadenheben',
    variant: 'stehend',
    primary: 'calves',
    secondary: [],
    loadsLegs: true,
    note: 'Waden fangen jeden Sprint und jede Landung ab. Volle Dehnung unten, kurz halten oben.',
  },

  /* ─── Rumpf ──────────────────────────────────────────────────────────── */

  pallof_press: {
    name: 'Pallof-Press',
    variant: 'Kabel, seitlich',
    primary: 'core',
    secondary: [],
    loadsLegs: false,
    note: 'Rotation aushalten statt Rotation erzeugen — genau das macht der Rumpf beim Zweikampf.',
  },
});

/** Alle Übungs-Kennungen. */
export const EXERCISE_IDS = Object.freeze(Object.keys(EXERCISES));

/** Übung nachschlagen. Wirft bei unbekannter Kennung, statt undefined zu liefern. */
export function exercise(id) {
  const found = EXERCISES[id];
  if (!found) {
    throw new RangeError(`Unbekannte Übung "${id}".`);
  }
  return found;
}

/** Anzeigename inklusive Variante. */
export function exerciseLabel(id) {
  const ex = exercise(id);
  return ex.variant ? `${ex.name} (${ex.variant})` : ex.name;
}
