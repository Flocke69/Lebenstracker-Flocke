import { suite, test, eq, close, throws, isFinite_ } from './harness.js';
import {
  DAY_TYPES,
  DEFAULT_FACTORS,
  DEFAULT_PROTEIN_PER_KG,
  DEFAULT_FAT_PER_KG,
  KCAL_PER_G,
  ageOn,
  bmrMifflin,
  activityFactor,
  dayTargets,
  weekTargets,
} from '../js/lib/energy.js';

/* Referenzprofil, per Hand nachgerechnet:
 *   männlich, 80 kg, 180 cm, 25 Jahre
 *   BMR = 10·80 + 6,25·180 − 5·25 + 5
 *       = 800 + 1125 − 125 + 5
 *       = 1805 kcal
 */
const M = { sex: 'm', weightKg: 80, heightCm: 180, age: 25 };
const M_BMR = 1805;

/* weiblich, 65 kg, 168 cm, 30 Jahre
 *   BMR = 10·65 + 6,25·168 − 5·30 − 161
 *       = 650 + 1050 − 150 − 161
 *       = 1389 kcal
 */
const W = { sex: 'w', weightKg: 65, heightCm: 168, age: 30 };
const W_BMR = 1389;

suite('energy — Mifflin-St Jeor gegen Handrechnung', () => {
  test('männlich: 80 kg, 180 cm, 25 J → 1805 kcal', () => {
    close(bmrMifflin(M), M_BMR, 0.001);
  });

  test('weiblich: 65 kg, 168 cm, 30 J → 1389 kcal', () => {
    close(bmrMifflin(W), W_BMR, 0.001);
  });

  test('zweites männliches Profil: 75 kg, 175 cm, 20 J → 1748,75 kcal', () => {
    close(bmrMifflin({ sex: 'm', weightKg: 75, heightCm: 175, age: 20 }),
          1748.75, 0.001);
  });

  test('der Geschlechtsterm ist genau 166 kcal Unterschied', () => {
    const a = bmrMifflin({ sex: 'm', weightKg: 70, heightCm: 175, age: 30 });
    const b = bmrMifflin({ sex: 'w', weightKg: 70, heightCm: 175, age: 30 });
    close(a - b, 166, 0.001, '+5 gegen −161');
  });

  test('jedes Kilo bringt 10 kcal, jeder cm 6,25 kcal, jedes Jahr −5 kcal', () => {
    const base = bmrMifflin(M);
    close(bmrMifflin({ ...M, weightKg: 81 }) - base, 10, 0.001, 'Gewicht');
    close(bmrMifflin({ ...M, heightCm: 181 }) - base, 6.25, 0.001, 'Größe');
    close(bmrMifflin({ ...M, age: 26 }) - base, -5, 0.001, 'Alter');
  });

  test('unbrauchbare Eingaben werfen einen Fehler statt NaN zu liefern', () => {
    throws(() => bmrMifflin({ ...M, weightKg: 0 }), 'Gewicht 0');
    throws(() => bmrMifflin({ ...M, weightKg: -5 }), 'negatives Gewicht');
    throws(() => bmrMifflin({ ...M, heightCm: undefined }), 'Größe fehlt');
    throws(() => bmrMifflin({ ...M, age: null }), 'Alter fehlt');
    throws(() => bmrMifflin({ ...M, sex: 'x' }), 'unbekanntes Geschlecht');
    throws(() => bmrMifflin({ ...M, weightKg: '80' }), 'Gewicht als String');
  });
});

suite('energy — Alter', () => {
  test('ageOn rechnet das Alter zum Stichtag', () => {
    eq(ageOn(2001, '2026-07-27'), 25);
    eq(ageOn(1996, '2026-01-01'), 30);
  });

  test('ageOn weist unsinnige Geburtsjahre ab', () => {
    throws(() => ageOn(1700, '2026-07-27'), 'zu früh');
    throws(() => ageOn(2030, '2026-07-27'), 'in der Zukunft');
  });
});

suite('energy — Aktivitätsfaktoren', () => {
  test('die vier Tagestypen sind rest, gym, team, match', () => {
    eq(DAY_TYPES.join(','), 'rest,gym,team,match');
  });

  test('die Faktoren steigen streng monoton mit der Belastung', () => {
    const f = DEFAULT_FACTORS;
    eq(f.rest < f.gym && f.gym < f.team && f.team < f.match, true,
       `${f.rest} < ${f.gym} < ${f.team} < ${f.match}`);
  });

  test('Standardfaktoren haben die vereinbarten Werte', () => {
    close(DEFAULT_FACTORS.rest, 1.35);
    close(DEFAULT_FACTORS.gym, 1.5);
    close(DEFAULT_FACTORS.team, 1.65);
    close(DEFAULT_FACTORS.match, 1.75);
  });

  test('eigene Faktoren aus dem Profil überschreiben die Standardwerte', () => {
    close(activityFactor('gym', { ...DEFAULT_FACTORS, gym: 1.42 }), 1.42);
  });

  test('unbekannter Tagestyp wirft', () => {
    throws(() => activityFactor('urlaub', DEFAULT_FACTORS));
  });
});

suite('energy — Tagesziele', () => {
  const base = { ...M, factors: DEFAULT_FACTORS,
                 proteinPerKg: DEFAULT_PROTEIN_PER_KG,
                 fatPerKg: DEFAULT_FAT_PER_KG, kcalOffset: 0 };

  test('Spieltag: TDEE = 1805 × 1,75 = 3158,75 kcal', () => {
    close(dayTargets({ ...base, dayType: 'match' }).kcal, 3158.75, 0.001);
  });

  test('Ruhetag: TDEE = 1805 × 1,35 = 2436,75 kcal', () => {
    close(dayTargets({ ...base, dayType: 'rest' }).kcal, 2436.75, 0.001);
  });

  test('Protein und Fett hängen nur am Körpergewicht, nicht am Tagestyp', () => {
    const rest = dayTargets({ ...base, dayType: 'rest' });
    const match = dayTargets({ ...base, dayType: 'match' });
    close(rest.proteinG, 160, 0.001, '80 kg × 2,0');
    close(rest.fatG, 64, 0.001, '80 kg × 0,8');
    close(match.proteinG, rest.proteinG, 0.001, 'Protein konstant');
    close(match.fatG, rest.fatG, 0.001, 'Fett konstant');
  });

  test('Kohlenhydrate tragen die gesamte Periodisierung', () => {
    const rest = dayTargets({ ...base, dayType: 'rest' });
    const match = dayTargets({ ...base, dayType: 'match' });
    // (3158,75 − 640 − 576) / 4 = 485,6875
    close(match.carbsG, 485.6875, 0.001, 'Spieltag');
    // (2436,75 − 640 − 576) / 4 = 305,1875
    close(rest.carbsG, 305.1875, 0.001, 'Ruhetag');
    eq(match.carbsG > rest.carbsG, true, 'Spieltag hat mehr Kohlenhydrate');
  });

  test('die Makros ergeben zusammen genau die Kalorien', () => {
    for (const dayType of DAY_TYPES) {
      const t = dayTargets({ ...base, dayType });
      const sum = t.proteinG * KCAL_PER_G.protein
                + t.carbsG * KCAL_PER_G.carb
                + t.fatG * KCAL_PER_G.fat;
      close(sum, t.kcal, 0.001, `Summe für ${dayType}`);
    }
  });

  test('kcalOffset verschiebt die Kalorien und landet in den Kohlenhydraten', () => {
    const a = dayTargets({ ...base, dayType: 'gym' });
    const b = dayTargets({ ...base, dayType: 'gym', kcalOffset: -300 });
    close(b.kcal, a.kcal - 300, 0.001, 'Kalorien');
    close(b.proteinG, a.proteinG, 0.001, 'Protein bleibt — Muskelschutz');
    close(b.fatG, a.fatG, 0.001, 'Fett bleibt — Hormonhaushalt');
    close(b.carbsG, a.carbsG - 75, 0.001, '300 kcal / 4');
  });

  test('bei absurd hohem Protein werden Kohlenhydrate nicht negativ', () => {
    const t = dayTargets({ ...base, dayType: 'rest', proteinPerKg: 8, fatPerKg: 4 });
    eq(t.carbsG >= 0, true, 'keine negativen Kohlenhydrate');
    isFinite_(t.carbsG);
  });

  test('das Ergebnis enthält BMR und Faktor zur Nachvollziehbarkeit', () => {
    const t = dayTargets({ ...base, dayType: 'team' });
    close(t.bmr, M_BMR, 0.001);
    close(t.factor, 1.65, 0.001);
    eq(t.dayType, 'team');
  });
});

suite('energy — Wochenziele und die Invariante der Periodisierung', () => {
  /* Flockes Woche: 3 Gym, 1 Mannschaftstraining, 1 Spiel, 2 Ruhetage.
   * Faktorsumme = 1,5 + 1,65 + 1,5 + 1,35 + 1,5 + 1,75 + 1,35 = 10,6
   * Wochenkalorien = 1805 × 10,6 = 19133
   */
  const dayTypes = ['gym', 'team', 'gym', 'rest', 'gym', 'match', 'rest'];
  const base = { ...M, factors: DEFAULT_FACTORS,
                 proteinPerKg: DEFAULT_PROTEIN_PER_KG,
                 fatPerKg: DEFAULT_FAT_PER_KG, kcalOffset: 0, dayTypes };

  test('die Woche hat 7 Tage', () => {
    eq(weekTargets(base).days.length, 7);
  });

  test('Wochenkalorien = 1805 × 10,6 = 19133 kcal', () => {
    close(weekTargets(base).weekly.kcal, 19133, 0.001);
  });

  test('INVARIANTE: die Periodisierung verändert die Wochensumme nicht', () => {
    // Das ist der Kern der Behauptung im Spec: Kohlenhydrate wandern zu den
    // Belastungstagen, aber die Wochensumme bleibt exakt die, die eine
    // Gleichverteilung derselben Wochenkalorien ergäbe.
    const w = weekTargets(base);
    const weeklyProteinKcal = w.weekly.proteinG * KCAL_PER_G.protein;
    const weeklyFatKcal = w.weekly.fatG * KCAL_PER_G.fat;
    const expectedCarbsG =
      (w.weekly.kcal - weeklyProteinKcal - weeklyFatKcal) / KCAL_PER_G.carb;
    close(w.weekly.carbsG, expectedCarbsG, 0.001);
    close(w.weekly.carbsG, 2655.25, 0.001, 'nachgerechnet: 10621 / 4');
  });

  test('die Wochensummen sind die Summen der Tageswerte', () => {
    const w = weekTargets(base);
    const sum = (key) => w.days.reduce((acc, d) => acc + d[key], 0);
    close(w.weekly.kcal, sum('kcal'), 0.001, 'Kalorien');
    close(w.weekly.proteinG, sum('proteinG'), 0.001, 'Protein');
    close(w.weekly.carbsG, sum('carbsG'), 0.001, 'Kohlenhydrate');
    close(w.weekly.fatG, sum('fatG'), 0.001, 'Fett');
  });

  test('Belastungstage liegen über dem Wochenmittel, Ruhetage darunter', () => {
    const w = weekTargets(base);
    const mean = w.weekly.carbsG / 7;
    const carbsOf = (t) => w.days.find((d) => d.dayType === t).carbsG;
    eq(carbsOf('match') > mean, true, 'Spieltag über dem Mittel');
    eq(carbsOf('team') > mean, true, 'Mannschaftstraining über dem Mittel');
    eq(carbsOf('rest') < mean, true, 'Ruhetag unter dem Mittel');
  });

  test('eine Woche mit sieben gleichen Tagen hat keine Streuung', () => {
    const flat = weekTargets({ ...base, dayTypes: Array(7).fill('gym') });
    const first = flat.days[0].carbsG;
    for (const d of flat.days) close(d.carbsG, first, 0.001);
  });

  test('falsche Wochenlänge wird abgewiesen', () => {
    throws(() => weekTargets({ ...base, dayTypes: ['gym', 'rest'] }), '2 Tage');
    throws(() => weekTargets({ ...base, dayTypes: [] }), 'leer');
  });
});
