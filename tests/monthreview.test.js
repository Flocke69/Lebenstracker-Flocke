import { suite, test, eq, deepEq, isTrue, isFalse, throws } from './harness.js';
import {
  reviewQuestions, buildMonthRecord, monthRecordToText, parseMonthRecord,
  compactSummary, monthlyReview, MONTH_RECORD_VERSION, MONTH_RECORD_FENCE,
} from '../js/lib/review.js';
import {
  emptyState, emptyDay, withReviewRecord, getReviewRecord, withWeekMacros,
  withScheduleOverride,
} from '../js/lib/state.js';

const MONTH = '2026-06';

function baseState(patch = {}) {
  return {
    ...emptyState(MONTH),
    profile: {
      sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
      matchDayWeekday: 0,
      teamTrainingWeekdays: [3],
      gymWeekdays: [1, 2, 4],
      proteinPerKg: 2, fatPerKg: 0.8, kcalOffset: -300,
      activityFactors: { rest: 1.35, gym: 1.5, team: 1.65, match: 1.75 },
      offsetExemptDayTypes: [],
    },
    ...patch,
  };
}

/** Ein Monat mit ein paar Tagen Daten, damit das Review nicht leer läuft. */
function filledState() {
  const days = {};
  for (let i = 1; i <= 28; i += 1) {
    const key = `2026-06-${String(i).padStart(2, '0')}`;
    days[key] = {
      ...emptyDay(),
      weightKg: 80 - i * 0.01,
      readiness: 60 + (i % 5) * 5,
      checkin: { sleepHours: 6 + (i % 3) * 0.5, energy: 3, soreness: 3, stress: 2 },
      nutrition: { kcal: 2700, proteinG: 150, carbsG: 300, fatG: 70 },
    };
  }
  days['2026-06-01'].sessions = [{
    planId: 'a-push',
    exercises: [{ exId: 'curl_cable', sets: [{ reps: 10, kg: 15, rpe: 9 }] }],
    sessionRpe: null,
    startedAt: '2026-06-01T17:00:00.000Z',
    endedAt: '2026-06-01T18:05:00.000Z',
  }];
  return baseState({ days });
}

suite('review — die zehn Fragen', () => {
  const state = filledState();
  const review = monthlyReview(state, MONTH);

  test('ES SIND IMMER GENAU ZEHN', () => {
    // Eine feste Zahl macht das Gespräch planbar. Zehn sind in einer
    // Viertelstunde beantwortet.
    eq(reviewQuestions(review, state).length, 10);
  });

  test('auch bei einem leeren Monat sind es zehn', () => {
    const leer = baseState();
    eq(reviewQuestions(monthlyReview(leer, MONTH), leer).length, 10);
  });

  test('jede Frage hat eine stabile Kennung, ein Thema und einen Fragetext', () => {
    for (const q of reviewQuestions(review, state)) {
      isTrue(typeof q.id === 'string' && q.id.length > 0, JSON.stringify(q));
      isTrue(typeof q.topic === 'string' && q.topic.length > 0, q.id);
      isTrue(q.question.endsWith('?'), `${q.id}: "${q.question}"`);
      isTrue(typeof q.context === 'string' && q.context.length > 0, q.id);
    }
  });

  test('die Kennungen sind eindeutig — sonst überschreiben sich Antworten', () => {
    const ids = reviewQuestions(review, state).map((q) => q.id);
    eq(new Set(ids).size, ids.length, `war: ${ids}`);
  });

  test('DIE FRAGEN SIND DATENGETRIEBEN, NICHT GENERISCH', () => {
    // Die Datenlage jeder Frage nennt eine echte Zahl aus dem Monat.
    const sleep = reviewQuestions(review, state).find((q) => q.id === 'sleep');
    isTrue(/\d/.test(sleep.context), `war: "${sleep.context}"`);
  });

  test('bei kurzem Schlaf wird anders gefragt als bei ausreichendem', () => {
    const kurz = filledState();
    for (const key of Object.keys(kurz.days)) {
      kurz.days[key] = { ...kurz.days[key], checkin: { ...kurz.days[key].checkin, sleepHours: 5.5 } };
    }
    const frageKurz = reviewQuestions(monthlyReview(kurz, MONTH), kurz)
      .find((q) => q.id === 'sleep');

    const lang = filledState();
    for (const key of Object.keys(lang.days)) {
      lang.days[key] = { ...lang.days[key], checkin: { ...lang.days[key].checkin, sleepHours: 8 } };
    }
    const frageLang = reviewQuestions(monthlyReview(lang, MONTH), lang)
      .find((q) => q.id === 'sleep');

    isTrue(frageKurz.question !== frageLang.question,
      'ein kurzer Schlafmonat braucht eine andere Frage als ein guter');
  });

  test('Verschiebungen des Monats tauchen in der Datenlage auf', () => {
    const moved = withScheduleOverride(filledState(), '2026-06-12', 'a-push');
    const frage = reviewQuestions(monthlyReview(moved, MONTH), moved)
      .find((q) => q.id === 'moves');
    isTrue(frage.context.includes('Push'), `war: "${frage.context}"`);
  });

  test('der Yazio-Wochenschnitt taucht in der Ernährungsfrage auf', () => {
    const withWeek = withWeekMacros(filledState(), '2026-06-01', { kcal: 2750 });
    const frage = reviewQuestions(monthlyReview(withWeek, MONTH), withWeek)
      .find((q) => q.id === 'nutrition');
    isTrue(frage.context.includes('2750'), `war: "${frage.context}"`);
  });

  test('die letzte Frage ist immer dieselbe Entscheidungsfrage', () => {
    const letzte = reviewQuestions(review, state).at(-1);
    eq(letzte.id, 'next');
  });
});

suite('review — Monats-Datensatz', () => {
  const state = filledState();
  const review = monthlyReview(state, MONTH);

  test('compactSummary wirft die Tagesreihen weg', () => {
    const compact = compactSummary(review.summary);
    isFalse('values' in compact.weight, 'die Tageswerte gehören in die Exportdatei');
    isFalse('avgSeries' in compact.weight);
    isFalse('values' in compact.readiness);
    // Die Kennzahlen bleiben aber vollständig.
    isTrue(typeof compact.weight.delta === 'number' || compact.weight.delta === null);
    isTrue(typeof compact.training.sets === 'number');
  });

  test('der Datensatz trägt Zahlen UND Antworten', () => {
    const record = buildMonthRecord(review, state, { sleep: 'zu spät ins Bett' }, '2026-07-01T09:00:00.000Z');
    eq(record.app, 'Lebenstracker');
    eq(record.kind, 'monthReview');
    eq(record.month, MONTH);
    eq(record.recordVersion, MONTH_RECORD_VERSION);
    eq(record.questions.length, 10);
    eq(record.questions.find((q) => q.id === 'sleep').answer, 'zu spät ins Bett');
    eq(record.questions.find((q) => q.id === 'next').answer, null,
      'unbeantwortet ist null, nicht ein leerer String');
  });

  test('ein Wochen-Review kann kein Monats-Datensatz werden', () => {
    throws(() => buildMonthRecord({ ...review, kind: 'week' }, state, {}));
  });

  test('der Text enthält die Fragen und unten den Datenblock', () => {
    const record = buildMonthRecord(review, state, { sleep: 'Handy' }, '2026-07-01T09:00:00.000Z');
    const text = monthRecordToText(record);
    isTrue(text.includes('Die zehn Fragen'), 'die Fragen fehlen');
    isTrue(text.includes('Handy'), 'die Antwort fehlt');
    isTrue(text.includes('```' + MONTH_RECORD_FENCE), 'der Datenblock fehlt');
    // Der Datenblock steht UNTEN — sonst eröffnet jedes Gespräch mit JSON.
    isTrue(text.indexOf('Die zehn Fragen') < text.indexOf('```' + MONTH_RECORD_FENCE));
  });
});

suite('review — zurückimportieren', () => {
  const state = filledState();
  const review = monthlyReview(state, MONTH);
  const record = buildMonthRecord(review, state, { sleep: 'Handy', next: 'früher ins Bett' },
    '2026-07-01T09:00:00.000Z');

  test('der eigene Text lässt sich wieder einlesen — Rundlauf', () => {
    const parsed = parseMonthRecord(monthRecordToText(record));
    eq(parsed.record.month, MONTH);
    eq(parsed.questionCount, 10);
    eq(parsed.answered, 2);
    eq(parsed.record.questions.find((q) => q.id === 'sleep').answer, 'Handy');
  });

  test('Text davor und danach stört nicht', () => {
    const messy = `Klar, schauen wir uns das an.\n\n${monthRecordToText(record)}\n\nSag Bescheid.`;
    eq(parseMonthRecord(messy).record.month, MONTH);
  });

  test('rohes JSON ohne Codeblock geht auch', () => {
    eq(parseMonthRecord(JSON.stringify(record)).record.month, MONTH);
  });

  test('leerer Text, Unsinn und fremde Daten werden abgewiesen', () => {
    throws(() => parseMonthRecord(''));
    throws(() => parseMonthRecord('   '));
    throws(() => parseMonthRecord('Hallo, wie gehts?'));
    throws(() => parseMonthRecord('{ das ist kein json }'));
    throws(() => parseMonthRecord(JSON.stringify({ app: 'Strava', kind: 'monthReview' })));
    throws(() => parseMonthRecord(JSON.stringify({ ...record, kind: 'weekReview' })));
  });

  test('ein Datensatz aus einer NEUEREN App-Version wird abgewiesen', () => {
    throws(() => parseMonthRecord(JSON.stringify({ ...record, recordVersion: 99 })));
  });

  test('ein fehlender oder unsinniger Monat wird abgewiesen', () => {
    throws(() => parseMonthRecord(JSON.stringify({ ...record, month: undefined })));
    throws(() => parseMonthRecord(JSON.stringify({ ...record, month: '2026-13' })));
  });
});

suite('state — Reviews ablegen', () => {
  const state = filledState();
  const review = monthlyReview(state, MONTH);
  const record = buildMonthRecord(review, state, {}, '2026-07-01T09:00:00.000Z');

  test('ein Review lässt sich ablegen und wiederfinden', () => {
    const saved = withReviewRecord(state, record);
    eq(getReviewRecord(saved, MONTH).month, MONTH);
    eq(getReviewRecord(saved, '2026-05'), null);
  });

  test('EIN MONAT HAT NUR EINEN DATENSATZ — das zweite ist eine Korrektur', () => {
    const first = withReviewRecord(state, record);
    const second = withReviewRecord(first, { ...record, createdAt: 'später' });
    eq(second.reviews.length, 1);
    eq(second.reviews[0].createdAt, 'später');
  });

  test('mehrere Monate werden aufsteigend sortiert gehalten', () => {
    let s = withReviewRecord(state, { ...record, month: '2026-08' });
    s = withReviewRecord(s, { ...record, month: '2026-06' });
    s = withReviewRecord(s, { ...record, month: '2026-07' });
    deepEq(s.reviews.map((r) => r.month), ['2026-06', '2026-07', '2026-08']);
  });

  test('ohne Monatsangabe wird nichts abgelegt', () => {
    throws(() => withReviewRecord(state, { kind: 'monthReview' }));
    throws(() => withReviewRecord(state, null));
  });

  test('der ursprüngliche Zustand bleibt unangetastet', () => {
    withReviewRecord(state, record);
    deepEq(state.reviews, []);
  });
});
