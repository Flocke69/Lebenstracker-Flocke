import { suite, test, eq, close, deepEq, isTrue, isFalse, isFinite_, throws } from './harness.js';
import {
  WEIGHTS,
  THRESHOLD_FULL,
  THRESHOLD_REDUCED,
  CHECKIN_FIELDS,
  readinessScore,
  trainingGuidance,
} from '../js/lib/readiness.js';

const PERFECT = {
  sleepHours: 8.5, sleepQuality: 5, mood: 5, energy: 5, soreness: 1, stress: 1,
};
const TERRIBLE = {
  sleepHours: 4, sleepQuality: 1, mood: 1, energy: 1, soreness: 5, stress: 5,
};
/* Ein realistischer schlechter Tag nach dem Spiel — von Hand nachgerechnet:
 *   Schlafdauer 5,4 h  → (5,4 − 4,5) / 3        = 0,30 → 30
 *   Schlafqualität 2   → (2 − 1) / 4            = 0,25 → 25
 *   Energie 2          → (2 − 1) / 4            = 0,25 → 25
 *   Muskelkater 4      → (5 − 4) / 4            = 0,25 → 25   (invertiert)
 *   Stimmung 3         → (3 − 1) / 4            = 0,50 → 50
 *   Stress 3           → (5 − 3) / 4            = 0,50 → 50   (invertiert)
 *   30·0,25 + 25·0,15 + 25·0,20 + 25·0,20 + 50·0,10 + 50·0,10 = 31,25
 */
const ROUGH = {
  sleepHours: 5.4, sleepQuality: 2, mood: 3, energy: 2, soreness: 4, stress: 3,
};

suite('readiness — Gewichte und Schwellen', () => {
  test('die Gewichte summieren sich auf genau 1', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    close(sum, 1, 1e-9);
  });

  test('Schlaf trägt zusammen das größte Gewicht', () => {
    const sleep = WEIGHTS.sleepHours + WEIGHTS.sleepQuality;
    const others = 1 - sleep;
    isTrue(sleep >= 0.35, `Schlaf: ${sleep}`);
    isTrue(sleep < others, 'aber nicht die Mehrheit — sonst kippt der Score an einer Zahl');
  });

  test('die Schwellen liegen wie vereinbart', () => {
    eq(THRESHOLD_FULL, 75);
    eq(THRESHOLD_REDUCED, 50);
  });

  test('es gibt genau sechs Check-in-Felder', () => {
    deepEq(CHECKIN_FIELDS.map((f) => f.key),
      ['sleepHours', 'sleepQuality', 'mood', 'energy', 'soreness', 'stress']);
  });

  test('jedes Feld sagt, ob ein hoher Wert gut oder schlecht ist', () => {
    const byKey = Object.fromEntries(CHECKIN_FIELDS.map((f) => [f.key, f]));
    isFalse(byKey.soreness.higherIsBetter, 'viel Muskelkater ist schlecht');
    isFalse(byKey.stress.higherIsBetter, 'viel Stress ist schlecht');
    isTrue(byKey.energy.higherIsBetter);
    isTrue(byKey.mood.higherIsBetter);
  });
});

suite('readiness — Score', () => {
  test('perfekter Tag ergibt 100', () => {
    close(readinessScore(PERFECT).score, 100, 0.001);
  });

  test('miserabler Tag ergibt 0', () => {
    close(readinessScore(TERRIBLE).score, 0, 0.001);
  });

  test('realistischer schlechter Tag: 31,25', () => {
    close(readinessScore(ROUGH).score, 31.25, 0.001);
  });

  test('Muskelkater ist invertiert — mehr ist schlechter', () => {
    const wenig = readinessScore({ ...ROUGH, soreness: 1 }).score;
    const viel = readinessScore({ ...ROUGH, soreness: 5 }).score;
    isTrue(wenig > viel, `${wenig} muss über ${viel} liegen`);
  });

  test('Stress ist invertiert — mehr ist schlechter', () => {
    const wenig = readinessScore({ ...ROUGH, stress: 1 }).score;
    const viel = readinessScore({ ...ROUGH, stress: 5 }).score;
    isTrue(wenig > viel);
  });

  test('sehr viel Schlaf bringt keinen Bonus über 100 hinaus', () => {
    const acht = readinessScore({ ...PERFECT, sleepHours: 8 }).score;
    const zwoelf = readinessScore({ ...PERFECT, sleepHours: 12 }).score;
    close(acht, zwoelf, 0.001, 'ab 7,5 h ist der Teilwert gedeckelt');
  });

  test('der Score bleibt immer zwischen 0 und 100', () => {
    for (const h of [0, 3, 5, 7, 9, 14]) {
      for (const v of [1, 3, 5]) {
        const s = readinessScore({
          sleepHours: h, sleepQuality: v, mood: v, energy: v, soreness: v, stress: v,
        }).score;
        isTrue(s >= 0 && s <= 100, `Schlaf ${h}, Rest ${v} → ${s}`);
      }
    }
  });
});

suite('readiness — Stufen', () => {
  const levelOf = (score) => readinessScore({
    // Ein Feld genügt, um einen gewünschten Score zu erzeugen: bei nur einem
    // vorhandenen Feld wird dessen Gewicht auf 1 normiert.
    sleepQuality: null, mood: null, energy: null, soreness: null, stress: null,
    sleepHours: 4.5 + (score / 100) * 3,
  }).level;

  test('ab 75 volles Programm', () => {
    eq(levelOf(75), 'full');
    eq(levelOf(90), 'full');
  });

  test('50 bis unter 75 bedeutet reduziertes Volumen', () => {
    eq(levelOf(74.9), 'reduced');
    eq(levelOf(50), 'reduced');
  });

  test('unter 50 nur Prophylaxe oder Ruhetag', () => {
    eq(levelOf(49.9), 'rest');
    eq(levelOf(10), 'rest');
  });
});

suite('readiness — fehlende Eingaben', () => {
  test('leerer Check-in ergibt null, nicht 0', () => {
    // 0 wäre ein Messwert und würde jeden Durchschnitt verfälschen.
    const r = readinessScore({});
    eq(r.score, null);
    eq(r.level, null);
  });

  test('null und undefined als Eingabe erzeugen kein NaN', () => {
    const r = readinessScore({ sleepHours: 7, sleepQuality: null, mood: undefined });
    isFinite_(r.score);
  });

  test('bei fehlenden Feldern werden die Gewichte neu normiert', () => {
    // Nur Schlafdauer vorhanden: das Ergebnis ist genau der Teilwert.
    // 6 h → (6 − 4,5) / 3 = 0,5 → 50
    close(readinessScore({ sleepHours: 6 }).score, 50, 0.001);
  });

  test('fehlende Felder werden benannt', () => {
    const r = readinessScore({ sleepHours: 7, energy: 3 });
    isTrue(r.missing.includes('soreness'), `war: ${r.missing}`);
    isFalse(r.missing.includes('sleepHours'));
    eq(r.isComplete, false);
    isTrue(readinessScore(PERFECT).isComplete);
  });

  test('unsinnige Werte werden abgewiesen', () => {
    throws(() => readinessScore({ sleepHours: -2 }));
    throws(() => readinessScore({ sleepHours: 30 }));
    throws(() => readinessScore({ mood: 7 }));
    throws(() => readinessScore({ mood: 0 }));
    throws(() => readinessScore({ energy: '4' }), 'String');
  });
});

suite('readiness — Begründung', () => {
  test('die Bremsklötze werden nach Wirkung sortiert benannt', () => {
    const r = readinessScore(ROUGH);
    isTrue(r.limiters.length > 0, 'ein Score von 31 muss begründet werden');
    const keys = r.limiters.map((l) => l.key);
    isTrue(keys.includes('sleepHours'), `war: ${keys}`);
    isTrue(keys.includes('soreness'), `war: ${keys}`);
    // Nach Wirkung sortiert: der erste Eintrag zieht am stärksten runter.
    const impacts = r.limiters.map((l) => l.impact);
    deepEq(impacts, [...impacts].sort((a, b) => b - a));
  });

  test('jeder Bremsklotz trägt einen lesbaren Text mit dem echten Wert', () => {
    const r = readinessScore(ROUGH);
    const sleep = r.limiters.find((l) => l.key === 'sleepHours');
    isTrue(sleep.text.includes('5,4'), `war: "${sleep.text}"`);
  });

  test('ein guter Tag hat keine Bremsklötze', () => {
    deepEq(readinessScore(PERFECT).limiters, []);
  });
});

suite('readiness — Trainingsempfehlung', () => {
  const heavyOk = { level: 'heavy', reason: 'Guter Tag für schwere Sätze.' };
  const legNone = { level: 'none', reason: 'Spieltag. Die Beine gehören dem Spiel.' };

  test('hohe Bereitschaft: volles Programm', () => {
    const g = trainingGuidance(readinessScore(PERFECT), heavyOk);
    eq(g.setsDelta, 0);
    eq(g.rpeCap, null);
    isTrue(g.headline.length > 0);
  });

  test('mittlere Bereitschaft: ein Satz weniger und RPE-Deckel', () => {
    const g = trainingGuidance(readinessScore({
      sleepHours: 7, sleepQuality: 3, mood: 3, energy: 3, soreness: 3, stress: 3,
    }), heavyOk);
    eq(g.setsDelta, -1);
    eq(g.rpeCap, 8);
  });

  test('niedrige Bereitschaft: kein schweres Training mehr', () => {
    const g = trainingGuidance(readinessScore(ROUGH), heavyOk);
    eq(g.legLevel, 'light', 'die Bereitschaft zieht die Beinstufe herunter');
    isTrue(g.detail.includes('Schlaf') || g.detail.includes('Muskelkater'),
           `die Begründung nennt den Grund, war: "${g.detail}"`);
  });

  test('DIE SPIELTAGS-SPERRE GEWINNT IMMER', () => {
    // Auch bei perfekter Bereitschaft: am Spieltag gibt es keine Beine.
    const g = trainingGuidance(readinessScore(PERFECT), legNone);
    eq(g.legLevel, 'none');
    isTrue(g.legReason.includes('Spieltag'), `war: "${g.legReason}"`);
  });

  test('die Beinstufe wird nur gesenkt, nie angehoben', () => {
    const g = trainingGuidance(readinessScore(PERFECT), { level: 'light', reason: 'x' });
    eq(g.legLevel, 'light', 'gute Bereitschaft macht aus light kein heavy');
  });

  test('die Begründung widerspricht nie der Überschrift', () => {
    // Lauter Dreien: kein Einzelwert liegt unter der Schwelle, also gibt es
    // keinen Bremsklotz — der Score ist mit 58 trotzdem nur "reduziert".
    // Hier stand vorher "keine Bremsklötze, Progressionsversuch lohnt sich"
    // direkt unter "Volumen reduziert".
    const mittel = readinessScore({
      sleepHours: 7, sleepQuality: 3, mood: 3, energy: 3, soreness: 3, stress: 3,
    });
    eq(mittel.level, 'reduced');
    deepEq(mittel.limiters, [], 'kein Einzelwert unter der Schwelle');

    const g = trainingGuidance(mittel, heavyOk);
    isFalse(g.detail.toLowerCase().includes('progression'),
            `darf keinen Progressionsversuch empfehlen, war: "${g.detail}"`);
    isTrue(g.detail.toLowerCase().includes('summe'), `war: "${g.detail}"`);
  });

  test('nur bei vollem Programm wird zur Progression geraten', () => {
    const g = trainingGuidance(readinessScore(PERFECT), heavyOk);
    isTrue(g.detail.toLowerCase().includes('progression'), `war: "${g.detail}"`);
  });

  test('ohne Check-in gibt es eine Aufforderung statt einer Zahl', () => {
    const g = trainingGuidance(readinessScore({}), heavyOk);
    eq(g.setsDelta, 0, 'ohne Daten wird nichts reduziert');
    isTrue(g.headline.toLowerCase().includes('check-in'), `war: "${g.headline}"`);
  });
});
