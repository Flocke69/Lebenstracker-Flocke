import { suite, test, eq, deepEq, isTrue, isFalse, throws } from './harness.js';
import {
  buildMonthRecord, compactSummary, monthlyReview, MONTH_RECORD_VERSION,
} from '../js/lib/review.js';
import { emptyState, emptyDay, withReviewRecord, getReviewRecord } from '../js/lib/state.js';
import { withExportStamp, closeMonth } from '../js/lib/archive.js';

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

  test('der Datensatz trägt Zahlen, Befunde und das Urteil', () => {
    const record = buildMonthRecord(review, state, '2026-07-01T09:00:00.000Z');
    eq(record.app, 'Lebenstracker');
    eq(record.kind, 'monthReview');
    eq(record.month, MONTH);
    eq(record.recordVersion, MONTH_RECORD_VERSION);
    isTrue(typeof record.verdict.word === 'string' && record.verdict.word.length > 0);
    isTrue(['good', 'ok', 'bad', 'idle'].includes(record.verdict.tone));
    isTrue(Array.isArray(record.flags));
  });

  test('DIE FRAGEN SIND WEG, das Feld bleibt', () => {
    /* Datensätze aus der Zeit davor tragen Antworten. Das Feld verschwinden zu
       lassen würde sie beim Einlesen durchs Raster fallen lassen. */
    deepEq(buildMonthRecord(review, state, null).questions, []);
  });

  test('ein Wochen-Review kann kein Monats-Datensatz werden', () => {
    throws(() => buildMonthRecord({ ...review, kind: 'week' }, state, null));
  });
});

suite('state — Reviews ablegen', () => {
  const state = filledState();
  const review = monthlyReview(state, MONTH);
  const record = buildMonthRecord(review, state, '2026-07-01T09:00:00.000Z');

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

suite('review — nach dem Monatsabschluss', () => {
  test('das nachgeholte Review zieht die Zahlen aus dem Archiv', () => {
    /* Der ausdrücklich unterstützte Fall: Monat abgeschlossen (Tage verdichtet
       und weg), Review erst danach. Ohne Rückgriff auf die archivierte Summary
       wäre es leer — Kacheln ohne Zahlen, Fragen ohne Datenlage. */
    let s = withExportStamp(filledState(), '2026-07-01T08:00:00.000Z');
    s = closeMonth(s, '2026-07-01');
    eq(Object.keys(s.days).length, 0, 'die Tage sind nach dem Abschluss weg');

    const review = monthlyReview(s, MONTH);
    eq(review.summary.logging.daysWithWeight, 28, 'die Zahlen kommen aus dem Archiv');
    isTrue(buildMonthRecord(review, s, null).summary.training.sets >= 0,
      'auch der Datensatz trägt wieder Zahlen');
  });

  test('eine unvollständige Archiv-Summary wird nicht angefasst', () => {
    // Fremde oder angeschnittene Daten dürfen das Review nicht reißen —
    // dann lieber die ehrliche leere Auswertung.
    const s = baseState({ months: [{ month: MONTH, summary: { weight: {} } }] });
    const review = monthlyReview(s, MONTH);
    eq(review.summary.logging.daysWithWeight, 0);
  });
});
