/* Bereitschaft — aus dem Morgen-Check-in wird eine Trainingsanweisung.
 *
 * VIER FRAGEN, NICHT SECHS. Der erste Entwurf fragte zusätzlich nach
 * Schlafqualität und Stimmung. Beide sind gestrichen: Schlafqualität ist
 * morgens kaum von der Schlafdauer zu trennen, und die Stimmung schwankt aus
 * Gründen, die mit dem Training nichts zu tun haben. Vier Fragen sind in
 * dreißig Sekunden beantwortet — und ein Check-in, der jeden Tag passiert,
 * ist mehr wert als ein genauerer, der nach zwei Wochen liegen bleibt.
 *
 * KEINE PUNKTZAHL FÜR DEN BENUTZER. Der Score existiert weiter, weil Trends,
 * Reviews und das Monatsarchiv eine vergleichbare Zahl brauchen. Auf dem
 * Screen steht er nicht: dort gibt es eine Grafik und ein Wort — "Alles gut",
 * "Geht so", "Schlecht". "63 von 100" beantwortet keine Frage, die man
 * morgens hat.
 *
 * Zur Gewichtung: Schlaf trägt 35 %, weil Schlafmangel der am besten belegte
 * Einzelfaktor für schlechtere Leistung und höheres Verletzungsrisiko ist.
 * Aber bewusst UNTER 50 % — sonst kippt der ganze Score an einer einzigen
 * Zahl, die man morgens ohnehin nur schätzt. Energie und Muskelkater folgen
 * mit je 25 %, weil sie direkt beschreiben, was heute im Gym überhaupt geht.
 * Stress mit 15 %.
 *
 * Diese Datei kennt kein DOM und keinen Kalender. Die Spieltags-Regel liegt
 * in planner.js — hier wird sie nur berücksichtigt, nie überstimmt.
 */

/** Reihenfolge bestimmt auch die Reihenfolge im Formular. */
export const CHECKIN_FIELDS = Object.freeze([
  {
    key: 'sleepHours',
    kind: 'hours',
    label: 'Schlaf',
    question: 'Wie lange hast du geschlafen?',
    unit: 'h',
    higherIsBetter: true,
    min: 0,
    max: 16,
  },
  {
    key: 'energy',
    kind: 'scale',
    label: 'Energie',
    question: 'Wie voll ist der Tank?',
    higherIsBetter: true,
    low: 'leer',
    high: 'voll',
  },
  {
    key: 'soreness',
    kind: 'scale',
    label: 'Muskelkater',
    question: 'Wie viel Muskelkater hast du?',
    higherIsBetter: false,
    low: 'keiner',
    high: 'stark',
  },
  {
    key: 'stress',
    kind: 'scale',
    label: 'Stress',
    question: 'Wie viel Stress hast du gerade?',
    higherIsBetter: false,
    low: 'ruhig',
    high: 'viel',
  },
]);

export const WEIGHTS = Object.freeze({
  sleepHours: 0.35,
  energy: 0.25,
  soreness: 0.25,
  stress: 0.15,
});

/** Ab hier volles Programm. */
export const THRESHOLD_FULL = 75;
/** Ab hier reduziertes Volumen, darunter Prophylaxe oder Ruhetag. */
export const THRESHOLD_REDUCED = 50;

/** Unterhalb dieses Teilwerts gilt ein Faktor als Bremsklotz. */
const LIMITER_BELOW = 50;

/* Schlafdauer: unter 4,5 h ist der Teilwert 0, ab 7,5 h ist er 100. Mehr als
   7,5 h bringt keinen Bonus — Ausschlafen macht nicht überfrisch, es holt nur
   ein Defizit auf. */
const SLEEP_FLOOR_H = 4.5;
const SLEEP_CEILING_H = 7.5;

const FIELD_BY_KEY = Object.fromEntries(CHECKIN_FIELDS.map((f) => [f.key, f]));

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const de = (v, digits = 1) =>
  v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/* ─── Anzeigestufen ──────────────────────────────────────────────────────────
 *
 * Drei Stufen, jede mit Wort, Kurzsatz und Farbtoken. Die App zeigt Farbe UND
 * Wort — Farbe allein wäre für jeden mit Rot-Grün-Schwäche keine Information.
 */
export const LEVELS = Object.freeze({
  full: {
    key: 'full',
    word: 'Alles gut',
    tone: 'good',
    /** Anteil des Rings, der gefüllt wird. Keine Punktzahl, eine Menge. */
    fill: 1,
    short: 'Voll trainieren',
  },
  reduced: {
    key: 'reduced',
    word: 'Geht so',
    tone: 'ok',
    fill: 0.6,
    short: 'Etwas zurücknehmen',
  },
  rest: {
    key: 'rest',
    word: 'Schlecht',
    tone: 'bad',
    fill: 0.25,
    short: 'Heute nichts Schweres',
  },
  none: {
    key: 'none',
    /* Kurz halten: das Wort steht IM Bogen, und dort ist der Platz begrenzt.
       Ein Wort, das über den Bogen hinausläuft, sieht nach Fehler aus. */
    word: 'Noch offen',
    tone: 'idle',
    fill: 0,
    short: 'Vier Fragen',
  },
});

/** Stufe eines Teilwerts — für die vier Balken in der Grafik. */
export function toneOfSub(sub) {
  if (typeof sub !== 'number' || !Number.isFinite(sub)) return 'idle';
  if (sub >= THRESHOLD_FULL) return 'good';
  if (sub >= THRESHOLD_REDUCED) return 'ok';
  return 'bad';
}

/* ─── Teilwerte ──────────────────────────────────────────────────────────── */

function subScore(field, value) {
  if (field.kind === 'hours') {
    return clamp01((value - SLEEP_FLOOR_H) / (SLEEP_CEILING_H - SLEEP_FLOOR_H)) * 100;
  }
  // 1–5 auf 0–100. Bei Muskelkater und Stress ist die Skala umgedreht:
  // ein hoher Wert bedeutet dort einen schlechten Zustand.
  const normalized = field.higherIsBetter ? (value - 1) / 4 : (5 - value) / 4;
  return clamp01(normalized) * 100;
}

function limiterText(field, value) {
  if (field.kind === 'hours') return `Schlaf ${de(value)} h`;
  return `${field.label} ${value}/5`;
}

function validate(field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field.key} muss eine Zahl sein, war: ${value}`);
  }
  if (field.kind === 'hours') {
    if (value < field.min || value > field.max) {
      throw new RangeError(
        `${field.key} muss zwischen ${field.min} und ${field.max} liegen, war: ${value}`
      );
    }
  } else if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError(`${field.key} muss eine ganze Zahl von 1 bis 5 sein, war: ${value}`);
  }
  return value;
}

/* ─── Score ──────────────────────────────────────────────────────────────── */

/**
 * Bereitschaft aus einem Check-in.
 *
 * Fehlende Felder werden übersprungen und die Gewichte der vorhandenen neu
 * normiert — ein halber Check-in ist besser als keiner. Ist gar nichts
 * ausgefüllt, ist der Score `null` und nicht 0: 0 wäre ein Messwert und
 * würde jeden späteren Durchschnitt verfälschen.
 *
 * @returns {{score, level, display, subScores, limiters, missing, isComplete, weightUsed}}
 */
export function readinessScore(checkin) {
  const source = checkin ?? {};
  const subScores = {};
  const missing = [];
  let weightSum = 0;
  let weighted = 0;

  for (const field of CHECKIN_FIELDS) {
    const value = source[field.key];
    if (value === null || value === undefined || value === '') {
      missing.push(field.key);
      continue;
    }
    validate(field, value);
    const sub = subScore(field, value);
    subScores[field.key] = sub;
    weighted += sub * WEIGHTS[field.key];
    weightSum += WEIGHTS[field.key];
  }

  if (weightSum === 0) {
    return {
      score: null,
      level: null,
      display: LEVELS.none,
      subScores: {},
      limiters: [],
      missing,
      isComplete: false,
      weightUsed: 0,
    };
  }

  const score = weighted / weightSum;
  const level = score >= THRESHOLD_FULL ? 'full' : score >= THRESHOLD_REDUCED ? 'reduced' : 'rest';

  const limiters = Object.entries(subScores)
    .filter(([, sub]) => sub < LIMITER_BELOW)
    .map(([key, sub]) => ({
      key,
      sub,
      // Wirkung = wie viele Punkte dieser Faktor kostet.
      impact: (WEIGHTS[key] / weightSum) * (100 - sub),
      text: limiterText(FIELD_BY_KEY[key], source[key]),
    }))
    .sort((a, b) => b.impact - a.impact);

  return {
    score,
    level,
    display: LEVELS[level],
    subScores,
    limiters,
    missing,
    isComplete: missing.length === 0,
    weightUsed: weightSum,
  };
}

/* ─── Trainingsempfehlung ────────────────────────────────────────────────── */

const LEG_ORDER = { none: 0, light: 1, heavy: 2 };

/** Obergrenze fürs Beinvolumen, die sich allein aus der Bereitschaft ergibt. */
const LEG_CAP_BY_LEVEL = { full: 'heavy', reduced: 'heavy', rest: 'light' };

const HEADLINE = {
  full: 'Volles Programm',
  reduced: 'Volumen reduziert',
  rest: 'Ruhetag oder nur leichtes Zeug',
};

/**
 * Bereitschaft und Spieltags-Regel zu einer Anweisung zusammenführen.
 *
 * Die Beinstufe wird nur GESENKT, nie angehoben: eine gute Nacht macht aus
 * dem Tag vor dem Spiel keinen Beintag. Die Sperre aus planner.js gewinnt
 * immer.
 *
 * @param {object} readiness Ergebnis von readinessScore()
 * @param {{level: string, reason: string}} legAllowance Ergebnis von legVolumeAllowance()
 */
export function trainingGuidance(readiness, legAllowance) {
  const allowanceLevel = legAllowance?.level ?? 'light';
  const allowanceReason = legAllowance?.reason ?? '';

  // Ohne Check-in wird nichts reduziert — wir wissen ja nichts.
  if (readiness?.score === null || readiness?.score === undefined) {
    return {
      headline: 'Check-in fehlt',
      detail: 'Vier Fragen, dann passt die App das Training an dich an.',
      tone: 'idle',
      setsDelta: 0,
      rpeCap: null,
      legLevel: allowanceLevel,
      legReason: allowanceReason,
      limitedBy: 'kein Check-in',
    };
  }

  const cap = LEG_CAP_BY_LEVEL[readiness.level];
  const legLevel = LEG_ORDER[allowanceLevel] <= LEG_ORDER[cap] ? allowanceLevel : cap;

  // Wer die Beinstufe bestimmt, liefert auch die Begründung dafür.
  const allowanceBinds = LEG_ORDER[allowanceLevel] <= LEG_ORDER[cap];
  const limiterText = readiness.limiters.slice(0, 3).map((l) => l.text).join(', ');

  /* Ohne einzelnen Bremsklotz hängt die Begründung an der Stufe. Sonst stünde
     bei 58 Punkten "keine Bremsklötze, Progressionsversuch lohnt sich" direkt
     unter der Überschrift "Volumen reduziert" — ein Widerspruch. Ein Tag, an
     dem alles mittelmäßig ist, hat keinen Schuldigen und ist trotzdem kein
     guter Tag. */
  let detail;
  if (readiness.limiters.length > 0) {
    detail = `${limiterText}.`;
  } else if (readiness.level === 'full') {
    detail = 'Keine Bremsklötze im Check-in. Heute lohnt sich ein Progressionsversuch.';
  } else {
    detail = 'Nichts einzeln auffällig — aber in Summe reicht es heute nicht für mehr.';
  }

  return {
    headline: HEADLINE[readiness.level],
    detail,
    tone: readiness.display.tone,
    setsDelta: { full: 0, reduced: -1, rest: -2 }[readiness.level],
    rpeCap: { full: null, reduced: 8, rest: 7 }[readiness.level],
    legLevel,
    legReason: allowanceBinds
      ? allowanceReason
      /* Die Zahl steht hier bewusst NICHT mehr drin — der Check-in erzeugt
         keine Punktzahl für den Benutzer. Was zählt, ist der Grund. */
      : `${detail} Heute nichts Schweres für die Beine.`,
    limitedBy: allowanceBinds ? 'Spielrhythmus' : 'Bereitschaft',
  };
}
