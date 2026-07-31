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
 *
 * DER KATALOG IST GRÖSSER ALS DER PLAN. Übungen, die aus dem Plan gefallen
 * sind, bleiben hier stehen — sonst würde `exercise()` bei alten geloggten
 * Sätzen werfen und ein Monat Trainingsdaten wäre nicht mehr auswertbar.
 * Nichts aus diesem Katalog löschen, solange es Logs geben kann.
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
    name: 'Trizepsdrücken',
    variant: 'Kabel, Seil',
    primary: 'triceps',
    secondary: [],
    loadsLegs: false,
  },
  triceps_pushdown_single: {
    name: 'Trizepsdrücken einarmig',
    variant: 'Kabel, einarmig',
    primary: 'triceps',
    secondary: [],
    loadsLegs: false,
    note: 'Einarmig, weil beide Seiten sonst unbemerkt unterschiedlich stark '
        + 'werden. Oberarm bleibt am Körper, nur der Unterarm bewegt sich.',
  },
  chest_fly_db: {
    name: 'Fliegende',
    variant: 'Kurzhantel',
    primary: 'chest',
    secondary: [],
    loadsLegs: false,
    note: 'Der Reiz kommt aus der Dehnung, nicht aus dem Gewicht. Leicht '
        + 'beginnen, Ellenbogen leicht gebeugt lassen.',
  },
  incline_press_multi: {
    name: 'Schrägbankdrücken',
    variant: 'Multipresse, 30 Grad',
    primary: 'chest',
    secondary: ['shoulders', 'triceps'],
    loadsLegs: false,
    note: 'In der Multipresse geführt — deshalb geht hier schwerer als mit '
        + 'freien Kurzhanteln, ohne dass jemand sichern muss.',
  },
  lateral_raise_machine: {
    name: 'Seitheben',
    variant: 'Maschine',
    primary: 'shoulders',
    secondary: [],
    loadsLegs: false,
    note: 'Die Maschine nimmt den Schwung raus, den man beim Seitheben mit '
        + 'Kurzhanteln fast zwangsläufig mitnimmt.',
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
  row_wide: {
    name: 'Breites Rudern',
    variant: 'Maschine oder Kabel, weiter Griff',
    primary: 'back',
    secondary: ['biceps'],
    loadsLegs: false,
    note: 'Weiter Griff und Ellenbogen nach außen — das trifft die Breite des '
        + 'Rückens, während enges Rudern eher in die Dicke geht.',
  },
  row_bb: {
    name: 'Rudern',
    variant: 'Langhantel, vorgebeugt',
    primary: 'back',
    // Die Beine halten hier nur, sie arbeiten nicht — deshalb kein
    // Beinvolumen und loadsLegs bleibt false.
    secondary: ['biceps', 'traps'],
    loadsLegs: false,
    note: 'Die schwerste Zugübung im Plan. Rücken gerade, Hüfte fest — wenn '
        + 'der Oberkörper mitschwingt, ist das Gewicht zu hoch.',
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
  curl_cable: {
    name: 'Bizepscurls',
    variant: 'Kabel',
    primary: 'biceps',
    secondary: [],
    loadsLegs: false,
    note: 'Am Kabel bleibt die Spannung über den ganzen Weg gleich — mit der '
        + 'Kurzhantel wird es oben leicht. Deshalb hier das Kabel.',
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
  rdl_db: {
    name: 'Rumänisches Kreuzheben',
    variant: 'Kurzhantel',
    primary: 'hamstrings',
    secondary: ['glutes', 'back'],
    loadsLegs: true,
    note: 'Die wichtigste Übung im Plan gegen Oberschenkelverletzungen — die '
        + 'häufigste Ausfallursache im Amateurfußball. Hüfte nach hinten, '
        + 'Rücken gerade, Hanteln nah am Bein. Nicht bis zum Boden, sondern '
        + 'bis die Dehnung hinten kommt.',
  },
  leg_extension: {
    name: 'Beinstrecker',
    variant: 'Maschine',
    primary: 'quads',
    secondary: [],
    loadsLegs: true,
    note: 'Die einzige Übung, die den Oberschenkel vorne isoliert trifft. '
        + 'Oben kurz halten, nicht in die Endstellung schnalzen.',
  },
  leg_curl_machine: {
    name: 'Beinbeuger',
    variant: 'Maschine',
    primary: 'hamstrings',
    secondary: [],
    loadsLegs: true,
    note: 'Das Gegenstück zum Beinstrecker: der Oberschenkel hinten, isoliert '
        + 'und ohne Rücken. Steht vor der Kniebeuge, weil er dort nichts '
        + 'kaputtmacht — vorermüdet ist die Beuger-Arbeit hinterher nur besser.',
  },
  squat_bb: {
    name: 'Kniebeuge',
    variant: 'Langhantel',
    primary: 'quads',
    // Bewusst nur das Gesäß als Nebengruppe: den Rücken mitzuzählen würde das
    // Rückenvolumen der Woche aufblähen, obwohl er hier nur hält.
    secondary: ['glutes'],
    loadsLegs: true,
    note: 'Die schwerste Übung im Plan. Wenig Wiederholungen, viel Gewicht — '
        + 'Muskelkater am Sonntag kommt von Wiederholungen, nicht von Kilos. '
        + 'Tief genug, dass die Hüfte unter das Knie kommt, und keinen Satz '
        + 'bis zum Versagen.',
  },
  adductor_machine: {
    name: 'Adduktoren',
    variant: 'Maschine, Beine zusammen',
    primary: 'adductors',
    secondary: [],
    loadsLegs: true,
    note: 'Adduktorenzerrung ist nach der Oberschenkelverletzung die Nummer zwei '
        + 'im Amateurfußball. Zwei Sätze pro Woche kosten fünf Minuten.',
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

/** Übung nachschlagen. Wirft bei unbekannter Kennung, statt undefined zu liefern. */
export function exercise(id) {
  const found = EXERCISES[id];
  if (!found) {
    throw new RangeError(`Unbekannte Übung "${id}".`);
  }
  return found;
}
