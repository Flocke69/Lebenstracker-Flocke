/* Energie- und Makrorechnung.
 *
 * Grundformel ist Mifflin-St Jeor für den Ruheumsatz, multipliziert mit einem
 * Aktivitätsfaktor je Tagestyp. Der interessante Teil ist die Verteilung:
 *
 *   Protein und Fett hängen NUR am Körpergewicht, nicht am Tagestyp.
 *   Kohlenhydrate tragen die gesamte Periodisierung.
 *
 * Das ist Absicht. Protein schützt die Muskulatur und muss jeden Tag stehen,
 * Fett trägt den Hormonhaushalt. Also wandert die zusätzliche Energie an
 * Trainings- und Spieltagen vollständig in die Kohlenhydrate — dorthin, wo
 * Fußball sie tatsächlich braucht. Die Wochensumme bleibt dabei exakt die,
 * die eine Gleichverteilung derselben Wochenkalorien ergäbe (die Summe ist
 * linear, siehe Invariante in tests/energy.test.js).
 *
 * Diese Datei kennt kein DOM und rundet nichts. Gerundet wird erst bei der
 * Anzeige — sonst summieren sich Rundungsfehler über die Woche auf.
 */

import { parseKey } from './dates.js';

/** Tagestypen, aufsteigend nach Belastung. */
export const DAY_TYPES = ['rest', 'gym', 'team', 'match'];

/** Deutsche Bezeichnungen für die Anzeige. */
export const DAY_TYPE_LABELS = Object.freeze({
  rest: 'Ruhetag',
  gym: 'Krafttraining',
  team: 'Mannschaftstraining',
  match: 'Spieltag',
});

/** Kurzformen — "Mannschaftstraining" sprengt auf 375 px jede Auswahlleiste. */
export const DAY_TYPE_SHORT = Object.freeze({
  rest: 'Ruhe',
  gym: 'Gym',
  team: 'Team',
  match: 'Spiel',
});

/** Startwerte, im Profil editierbar. */
export const DEFAULT_FACTORS = Object.freeze({
  rest: 1.35,
  gym: 1.5,
  team: 1.65,
  match: 1.75,
});

export const DEFAULT_PROTEIN_PER_KG = 2.0;   // Recomp: bewusst hoch
export const DEFAULT_FAT_PER_KG = 0.8;       // Untergrenze für den Hormonhaushalt

export const KCAL_PER_G = Object.freeze({ protein: 4, carb: 4, fat: 9 });

/** Der Geschlechtsterm der Mifflin-St-Jeor-Formel. */
const SEX_TERM = Object.freeze({ m: 5, w: -161 });

/* ─── Eingabeprüfung ─────────────────────────────────────────────────────── */

/* Lieber ein Fehler beim Aufruf als ein NaN, das sich still durch die halbe
 * App zieht und am Ende als "—" im Review landet. */
function num(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} muss eine endliche Zahl sein, war: ${value}`);
  }
  if (value < min || value > max) {
    throw new RangeError(`${name} liegt außerhalb ${min}–${max}: ${value}`);
  }
  return value;
}

/* ─── Alter ──────────────────────────────────────────────────────────────── */

/**
 * Alter zum Stichtag, aus dem Geburtsjahr.
 *
 * Jahresgenau genügt: ein Jahr Abweichung verschiebt den Ruheumsatz um
 * 5 kcal, das ist gegenüber der Streuung der Formel selbst irrelevant.
 */
export function ageOn(birthYear, onKey) {
  num(birthYear, 'birthYear', 1900, 2200);
  const age = parseKey(onKey).getFullYear() - birthYear;
  if (age < 10 || age > 100) {
    throw new RangeError(`Errechnetes Alter unplausibel: ${age} Jahre`);
  }
  return age;
}

/* ─── Ruheumsatz ─────────────────────────────────────────────────────────── */

/**
 * Ruheumsatz nach Mifflin-St Jeor.
 *
 *   männlich:  10·kg + 6,25·cm − 5·Jahre + 5
 *   weiblich:  10·kg + 6,25·cm − 5·Jahre − 161
 */
export function bmrMifflin({ sex, weightKg, heightCm, age }) {
  if (typeof sex !== 'string' || !(sex in SEX_TERM)) {
    throw new RangeError(`sex muss 'm' oder 'w' sein, war: ${sex}`);
  }
  num(weightKg, 'weightKg', 20, 400);
  num(heightCm, 'heightCm', 100, 250);
  num(age, 'age', 10, 100);

  return 10 * weightKg + 6.25 * heightCm - 5 * age + SEX_TERM[sex];
}

/* ─── Aktivitätsfaktor ───────────────────────────────────────────────────── */

/** Faktor für einen Tagestyp, aus dem Profil oder aus den Standardwerten. */
export function activityFactor(dayType, factors = DEFAULT_FACTORS) {
  if (!DAY_TYPES.includes(dayType)) {
    throw new RangeError(
      `Unbekannter Tagestyp "${dayType}". Erlaubt: ${DAY_TYPES.join(', ')}`
    );
  }
  const source = factors ?? DEFAULT_FACTORS;
  const factor = source[dayType] ?? DEFAULT_FACTORS[dayType];
  return num(factor, `factors.${dayType}`, 1, 3);
}

/* ─── Tagesziele ─────────────────────────────────────────────────────────── */

/**
 * Kalorien- und Makroziel für einen Tag.
 *
 * Gibt Ruheumsatz und Faktor mit zurück, damit die Anzeige begründen kann,
 * wie die Zahl entstanden ist — die App soll nachvollziehbar sein, nicht
 * orakeln.
 *
 * @returns {{dayType, bmr, factor, kcal, proteinG, carbsG, fatG, carbsClamped}}
 */
export function dayTargets({
  sex,
  weightKg,
  heightCm,
  age,
  dayType,
  factors = DEFAULT_FACTORS,
  proteinPerKg = DEFAULT_PROTEIN_PER_KG,
  fatPerKg = DEFAULT_FAT_PER_KG,
  kcalOffset = 0,
  offsetExemptDayTypes = [],
}) {
  const bmr = bmrMifflin({ sex, weightKg, heightCm, age });
  const factor = activityFactor(dayType, factors);
  num(proteinPerKg, 'proteinPerKg', 0.5, 10);
  num(fatPerKg, 'fatPerKg', 0.2, 5);
  num(kcalOffset, 'kcalOffset', -1500, 1500);

  if (!Array.isArray(offsetExemptDayTypes)) {
    throw new TypeError(
      `offsetExemptDayTypes muss ein Array sein, war: ${offsetExemptDayTypes}`
    );
  }
  for (const type of offsetExemptDayTypes) {
    if (!DAY_TYPES.includes(type)) {
      throw new RangeError(`Unbekannter Tagestyp in offsetExemptDayTypes: "${type}"`);
    }
  }

  /* An ausgenommenen Tagen greift die Kalorienkorrektur nicht.
   *
   * Gedacht für den Spieltag: ausgerechnet an dem Tag, an dem 90 Minuten
   * Leistung anstehen, mehrere hundert Kalorien zu kürzen, ist die eine
   * Stelle, an der ein Defizit die Leistung wirklich kostet. Die Wochenbilanz
   * verschiebt sich dadurch um genau einen Tagesbetrag — das ist der Preis,
   * und er ist bewusst gewählt.
   */
  const offsetApplies = !offsetExemptDayTypes.includes(dayType);
  const appliedOffset = offsetApplies ? kcalOffset : 0;
  const kcal = bmr * factor + appliedOffset;

  // Fix, weil an ihnen nicht gespart wird:
  const proteinG = weightKg * proteinPerKg;
  const fatG = weightKg * fatPerKg;

  // Der Rest sind Kohlenhydrate — hier entsteht die Periodisierung.
  const remainder =
    kcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  const carbsClamped = remainder < 0;
  const carbsG = carbsClamped ? 0 : remainder / KCAL_PER_G.carb;

  return {
    dayType, bmr, factor, kcal, proteinG, carbsG, fatG, carbsClamped,
    appliedOffset, offsetExempt: !offsetApplies,
  };
}

/* ─── Wochenziele ────────────────────────────────────────────────────────── */

/**
 * Ziele für eine ganze Woche, Montag bis Sonntag.
 *
 * @param {string[]} dayTypes genau 7 Tagestypen, Montag zuerst
 */
export function weekTargets({ dayTypes, ...profile }) {
  if (!Array.isArray(dayTypes) || dayTypes.length !== 7) {
    throw new RangeError(
      `dayTypes muss genau 7 Einträge haben (Montag zuerst), hatte: ${
        Array.isArray(dayTypes) ? dayTypes.length : typeof dayTypes
      }`
    );
  }

  const days = dayTypes.map((dayType) => dayTargets({ ...profile, dayType }));

  const weekly = days.reduce(
    (acc, d) => ({
      kcal: acc.kcal + d.kcal,
      proteinG: acc.proteinG + d.proteinG,
      carbsG: acc.carbsG + d.carbsG,
      fatG: acc.fatG + d.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  return { days, weekly };
}

/* ─── Rückkopplung über den Gewichtstrend ────────────────────────────────── */

/** Schwelle, ab der ein Gewichtstrend als echte Drift gilt (kg über 2 Wochen). */
export const DRIFT_THRESHOLD_KG = 0.5;

/** Schrittweite einer Kalorienanpassung. */
export const KCAL_ADJUST_STEP = 150;

/**
 * Vorschlag für eine Kalorienanpassung bei Recomp.
 *
 * Ziel ist ein stabiles Gewicht. Läuft der gleitende Gewichtsschnitt über
 * zwei Wochen um mehr als DRIFT_THRESHOLD_KG weg, wird gegengesteuert.
 *
 * Gibt nur einen VORSCHLAG zurück. Die App wendet nichts eigenmächtig an —
 * das bleibt eine bestätigte Entscheidung.
 *
 * @param {number} deltaKg Änderung des 7-Tage-Schnitts über 2 Wochen
 * @param {number} currentOffset aktueller kcalOffset
 */
export function suggestKcalAdjustment(deltaKg, currentOffset = 0) {
  num(deltaKg, 'deltaKg', -20, 20);
  num(currentOffset, 'currentOffset', -1500, 1500);

  if (Math.abs(deltaKg) <= DRIFT_THRESHOLD_KG) {
    return {
      change: 0,
      newOffset: currentOffset,
      reason:
        `Gewicht stabil (${deltaKg >= 0 ? '+' : ''}${deltaKg.toFixed(1)} kg ` +
        `über 2 Wochen). Kalorien bleiben, wo sie sind.`,
    };
  }

  // Gewicht rauf → runter mit den Kalorien, und umgekehrt.
  const change = deltaKg > 0 ? -KCAL_ADJUST_STEP : KCAL_ADJUST_STEP;
  const direction = deltaKg > 0 ? 'gestiegen' : 'gefallen';

  return {
    change,
    newOffset: currentOffset + change,
    reason:
      `Gewichtsschnitt ist über 2 Wochen um ${Math.abs(deltaKg).toFixed(1)} kg ` +
      `${direction}. Bei Recomp soll er stabil bleiben, daher Vorschlag: ` +
      `${change > 0 ? '+' : ''}${change} kcal pro Tag.`,
  };
}
