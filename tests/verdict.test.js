import { suite, test, eq, deepEq, isTrue, isFalse, close } from './harness.js';
import {
  volumeVerdict, progressVerdict, reviewFeedback, monthReviewDue,
  buildFlags, monthlyReview, weeklyReview, reviewQuestions, buildMonthRecord,
  SEVERITY_TONE, VOLUME_BAND,
} from '../js/lib/review.js';
import {
  emptyState, emptyDay, withReviewRecord, firstTrackedMonth, firstTrackedDay,
} from '../js/lib/state.js';
import { monthSummary } from '../js/lib/aggregate.js';
import { SESSIONS, sessionExercises } from '../data/plan-default.js';

const MONTH = '2026-06';
/** Sätze, die der Plan pro Woche vorsieht — Grundlage jedes Volumenurteils. */
const PLAN_SETS_PER_WEEK = SESSIONS.reduce(
  (sum, s) => sum + sessionExercises(s).reduce((n, e) => n + e.sets, 0), 0
);

function baseState(patch = {}) {
  return {
    ...emptyState(MONTH),
    profile: {
      sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
      matchDayWeekday: 0, teamTrainingWeekdays: [3], gymWeekdays: [1, 2, 4],
      proteinPerKg: 2, fatPerKg: 0.8, kcalOffset: 0,
      activityFactors: { rest: 1.35, gym: 1.5, team: 1.65, match: 1.75 },
      offsetExemptDayTypes: [],
    },
    ...patch,
  };
}

/** Einen Monat mit einer bestimmten Zahl geloggter Sätze bauen. */
function stateWithSets(count) {
  const days = {};
  let left = count;
  let day = 1;
  while (left > 0 && day <= 28) {
    const take = Math.min(left, 9);
    days[`2026-06-${String(day).padStart(2, '0')}`] = {
      ...emptyDay(),
      sessions: [{
        planId: 'a-push',
        exercises: [{
          exId: 'curl_cable',
          sets: Array.from({ length: take }, () => ({ reps: 10, kg: 15, rpe: null })),
        }],
        sessionRpe: null, startedAt: null, endedAt: null,
      }],
    };
    left -= take;
    day += 1;
  }
  return baseState({ days });
}

suite('review — Volumenurteil', () => {
  test('ohne geloggte Sätze wird nicht bewertet', () => {
    const v = volumeVerdict(monthSummary(baseState(), MONTH));
    eq(v.tone, 'idle');
    eq(v.actual, 0);
  });

  test('genau im Plan heißt: passt', () => {
    // Juni hat 30 Tage, also rund 30/7 Wochen Plan.
    const target = Math.round(PLAN_SETS_PER_WEEK * (30 / 7));
    const v = volumeVerdict(monthSummary(stateWithSets(target), MONTH));
    eq(v.tone, 'good', `Verhältnis war ${v.ratio}`);
    isTrue(v.headline.toLowerCase().includes('passt'), `war: "${v.headline}"`);
  });

  test('das Band um den Plan ist symmetrisch', () => {
    const planned = PLAN_SETS_PER_WEEK * (30 / 7);
    // Knapp innerhalb der Toleranz, oben und unten.
    for (const factor of [1 - VOLUME_BAND + 0.02, 1 + VOLUME_BAND - 0.02]) {
      const v = volumeVerdict(monthSummary(stateWithSets(Math.round(planned * factor)), MONTH));
      eq(v.tone, 'good', `Faktor ${factor} ergab ${v.tone}`);
    }
  });

  test('deutlich zu wenig ist schlecht, etwas zu wenig nur mittel', () => {
    const planned = PLAN_SETS_PER_WEEK * (30 / 7);
    const wenig = volumeVerdict(monthSummary(stateWithSets(Math.round(planned * 0.8)), MONTH));
    eq(wenig.tone, 'ok');
    isTrue(wenig.headline.toLowerCase().includes('niedrig'), `war: "${wenig.headline}"`);

    const kaum = volumeVerdict(monthSummary(stateWithSets(Math.round(planned * 0.4)), MONTH));
    eq(kaum.tone, 'bad');
  });

  test('über dem Plan ist auffällig, aber kein Alarm', () => {
    const planned = PLAN_SETS_PER_WEEK * (30 / 7);
    const v = volumeVerdict(monthSummary(stateWithSets(Math.round(planned * 1.25)), MONTH));
    eq(v.tone, 'ok');
    isTrue(v.detail.includes('nicht automatisch besser'), `war: "${v.detail}"`);
  });

  test('das Urteil nennt beide Zahlen, aus denen es entsteht', () => {
    const v = volumeVerdict(monthSummary(stateWithSets(40), MONTH));
    isTrue(v.detail.includes('40'), `war: "${v.detail}"`);
    isTrue(v.actual === 40);
    isTrue(v.planned > 0);
  });
});

suite('review — Fortschrittsurteil', () => {
  test('ohne Sätze wird nicht bewertet', () => {
    const state = baseState();
    const p = progressVerdict(monthlyReview(state, MONTH));
    eq(p.tone, 'idle');
    eq(p.stagnating, 0);
  });

  test('ohne Stillstand ist das Urteil gut', () => {
    const review = { ...monthlyReview(stateWithSets(40), MONTH), stagnating: [] };
    const p = progressVerdict(review);
    eq(p.tone, 'good');
    isTrue(p.headline.toLowerCase().includes('voran'), `war: "${p.headline}"`);
  });

  test('eine stehende Übung ist ein Hinweis, viele sind ein Problem', () => {
    const base = monthlyReview(stateWithSets(40), MONTH);

    const eine = progressVerdict({ ...base, stagnating: [{ exId: 'curl_cable', name: 'Curls' }] });
    eq(eine.tone, 'ok');
    isTrue(eine.headline.includes('Eine'), `war: "${eine.headline}"`);

    const viele = progressVerdict({
      ...base,
      stagnating: Array.from({ length: 9 }, (_, i) => ({ exId: `x${i}`, name: `Übung ${i}` })),
    });
    eq(viele.tone, 'bad');
  });

  test('das Urteil nennt die Übungen, nicht nur die Zahl', () => {
    const base = monthlyReview(stateWithSets(40), MONTH);
    const p = progressVerdict({ ...base, stagnating: [{ exId: 'curl_cable', name: 'Bizepscurls' }] });
    isTrue(p.detail.includes('Bizepscurls'), `war: "${p.detail}"`);
  });
});

suite('review — Kurzform der Befunde', () => {
  const summary = monthSummary(baseState(), MONTH);

  test('jeder Befund trägt Kurzform, Langform und einen Farbton', () => {
    const flags = buildFlags(summary, summary, { profile: baseState().profile });
    isTrue(flags.length > 0, 'ein leerer Monat muss mindestens einen Befund erzeugen');
    for (const f of flags) {
      isTrue(typeof f.short === 'string' && f.short.length > 0, `${f.id}: keine Kurzform`);
      isTrue(f.short.length <= 90, `${f.id}: Kurzform zu lang (${f.short.length})`);
      isTrue(typeof f.detail === 'string' && f.detail.length > 0, `${f.id}: kein Detail`);
      eq(f.tone, SEVERITY_TONE[f.severity], `${f.id}: Farbton passt nicht zur Dringlichkeit`);
    }
  });

  test('die Kurzform ist kürzer als die Langform', () => {
    const flags = buildFlags(summary, summary, { profile: baseState().profile });
    for (const f of flags) {
      isTrue(f.short.length <= f.detail.length,
        `${f.id}: "${f.short}" ist nicht kürzer als "${f.detail}"`);
    }
  });

  test('jede Dringlichkeitsstufe hat einen Farbton', () => {
    deepEq(Object.keys(SEVERITY_TONE).sort(), ['alarm', 'good', 'info', 'warn']);
    for (const tone of Object.values(SEVERITY_TONE)) {
      isTrue(['good', 'ok', 'bad', 'idle'].includes(tone), tone);
    }
  });
});

suite('review — Rückmeldung in der App', () => {
  const state = stateWithSets(40);
  const review = monthlyReview(state, MONTH);
  const questions = reviewQuestions(review, state);

  test('ohne Antwort gibt es keine Rückmeldung', () => {
    const fb = reviewFeedback(review, questions, {});
    isFalse(fb.ready);
    eq(fb.missing, 10);
    deepEq(fb.points, []);
  });

  test('mit einer Antwort steht die Rückmeldung, mit Hinweis auf die offenen', () => {
    const fb = reviewFeedback(review, questions, { sleep: 'Handy' });
    isTrue(fb.ready);
    eq(fb.missing, 9);
    isTrue(fb.headline.includes('1 von 10'), `war: "${fb.headline}"`);
  });

  test('HÖCHSTENS DREI PRIORITÄTEN', () => {
    // Eine Liste mit sieben Prioritäten hat keine.
    const fb = reviewFeedback(review, questions, { sleep: 'x' });
    isTrue(fb.points.length <= 3, `waren ${fb.points.length}`);
    isTrue(fb.points.length >= 1, 'mindestens eine Aussage muss dastehen');
  });

  test('jede Priorität trägt Farbe, Titel und Text', () => {
    const fb = reviewFeedback(review, questions, { sleep: 'x' });
    for (const p of fb.points) {
      isTrue(['good', 'ok', 'bad', 'idle'].includes(p.tone), p.tone);
      isTrue(p.title.length > 0);
      isTrue(p.text.length > 0);
    }
  });

  test('DIE ANTWORT AUF FRAGE ZEHN KOMMT WÖRTLICH ZURÜCK', () => {
    /* Die App kann Freitext nicht lesen. Was sie kann: die Entscheidung des
       Monats unverändert wiedergeben — das ist ehrlicher als eine
       Scheininterpretation. */
    const satz = 'Nur eine Sache: Schlaf. Ziel 7,5 h.';
    const fb = reviewFeedback(review, questions, { sleep: 'x', next: satz });
    eq(fb.decision, satz);
  });

  test('ohne Antwort auf Frage zehn bleibt die Entscheidung leer', () => {
    eq(reviewFeedback(review, questions, { sleep: 'x' }).decision, '');
    eq(reviewFeedback(review, questions, { sleep: 'x', next: '   ' }).decision, '');
  });

  test('sind alle beantwortet, sagt die Überschrift das', () => {
    const alle = Object.fromEntries(questions.map((q) => [q.id, 'Antwort']));
    const fb = reviewFeedback(review, questions, alle);
    eq(fb.missing, 0);
    isTrue(fb.headline.toLowerCase().includes('alle zehn'), `war: "${fb.headline}"`);
  });
});

suite('review — wann ist das Monats-Review fällig', () => {
  test('mitten im Monat ist nichts fällig', () => {
    eq(monthReviewDue(baseState(), '2026-06-15').due, false);
  });

  test('AM LETZTEN TAG DES MONATS ist es fällig', () => {
    const due = monthReviewDue(baseState(), '2026-06-30');
    eq(due.due, true);
    eq(due.month, '2026-06');
    eq(due.kind, 'today');
    isTrue(due.text.includes('Juni'), `war: "${due.text}"`);
  });

  test('liegt das Review schon vor, ist nichts fällig', () => {
    const state = withReviewRecord(baseState(), { month: '2026-06' });
    eq(monthReviewDue(state, '2026-06-30').due, false);
  });

  test('DANACH BLEIBT ES FÄLLIG, solange es fehlt', () => {
    /* Ein Review, das nur an einem einzigen Tag möglich ist, findet in der
       Praxis nie statt. */
    const state = baseState({
      days: { '2026-06-15': { ...emptyDay(), weightKg: 80 } },
      currentMonth: '2026-07',
    });
    const due = monthReviewDue(state, '2026-07-09');
    eq(due.due, true);
    eq(due.month, '2026-06');
    eq(due.kind, 'overdue');
  });

  test('nach dem Monatsabschluss zählt die Summary, nicht die Tage', () => {
    // Die Tage sind verdichtet und weg — das Review fehlt aber trotzdem noch.
    const state = baseState({
      days: {},
      months: [{ month: '2026-06', closedAt: '2026-07-01', summary: {} }],
      currentMonth: '2026-07',
    });
    eq(monthReviewDue(state, '2026-07-09').month, '2026-06');
  });

  test('ein Vormonat ohne jede Daten löst nichts aus', () => {
    const state = baseState({ days: {}, currentMonth: '2026-07' });
    eq(monthReviewDue(state, '2026-07-09').due, false);
  });

  test('ein vorliegendes Review des Vormonats beendet die Fälligkeit', () => {
    let state = baseState({
      days: { '2026-06-15': { ...emptyDay(), weightKg: 80 } },
      currentMonth: '2026-07',
    });
    state = withReviewRecord(state, { month: '2026-06' });
    eq(monthReviewDue(state, '2026-07-09').due, false);
  });
});

suite('review — wo die Zeitrechnung anfängt', () => {
  test('ohne Daten fängt sie heute an', () => {
    eq(firstTrackedMonth(baseState({ days: {} }), '2026-07-28'), '2026-07');
  });

  test('mit Tagen ist es der früheste Monat mit Daten', () => {
    const state = baseState({
      days: {
        '2026-07-02': { ...emptyDay(), weightKg: 80 },
        '2026-07-20': { ...emptyDay(), weightKg: 80 },
      },
    });
    eq(firstTrackedMonth(state, '2026-07-28'), '2026-07');
  });

  test('eine Monats-Summary zählt genauso wie Tage', () => {
    const state = baseState({
      days: {},
      months: [{ month: '2026-05', closedAt: '2026-06-01', summary: {} }],
    });
    eq(firstTrackedMonth(state, '2026-07-28'), '2026-05');
  });

  test('ein Review zählt auch — auch ohne Tage dazu', () => {
    const state = withReviewRecord(baseState({ days: {} }), { month: '2026-04' });
    eq(firstTrackedMonth(state, '2026-07-28'), '2026-04');
  });

  test('EIN GELÖSCHTER MONAT VERSCHIEBT DEN ANFANG MIT', () => {
    /* Genau der Fall aus Flockes Ansage: Juni ist weg, ab Juli wird gezählt.
       Weil die Grenze aus den Daten kommt, braucht es dafür keine Einstellung,
       die man pflegen müsste. */
    const mitJuni = baseState({
      days: {
        '2026-06-20': { ...emptyDay(), weightKg: 80 },
        '2026-07-02': { ...emptyDay(), weightKg: 80 },
      },
    });
    eq(firstTrackedMonth(mitJuni, '2026-07-28'), '2026-06');

    const ohneJuni = baseState({
      days: { '2026-07-02': { ...emptyDay(), weightKg: 80 } },
    });
    eq(firstTrackedMonth(ohneJuni, '2026-07-28'), '2026-07');
  });

  test('ein Tag im nächsten Monat verschiebt den Anfang nicht nach vorn', () => {
    const state = baseState({
      days: { '2026-08-03': { ...emptyDay(), weightKg: 80 } },
    });
    eq(firstTrackedMonth(state, '2026-07-28'), '2026-07');
  });

  test('kaputte Schlüssel werden übersprungen statt zu werfen', () => {
    const state = baseState({
      days: { irgendwann: { ...emptyDay() }, '2026-07-02': { ...emptyDay() } },
      months: [{ month: 'Quatsch' }, { month: '2026-13' }],
    });
    eq(firstTrackedMonth(state, '2026-07-28'), '2026-07');
  });

  test('VOR DEM ANFANG WIRD KEIN REVIEW VERLANGT', () => {
    // Juni gelöscht: die Aufforderung darf nicht weiter danach fragen.
    const state = baseState({
      days: { '2026-07-02': { ...emptyDay(), weightKg: 80 } },
      months: [],
      currentMonth: '2026-07',
    });
    eq(monthReviewDue(state, '2026-07-09').due, false);
  });

  test('mit Juni-Daten wäre es sehr wohl fällig — die Grenze ist die Ursache', () => {
    const state = baseState({
      days: {
        '2026-06-20': { ...emptyDay(), weightKg: 80 },
        '2026-07-02': { ...emptyDay(), weightKg: 80 },
      },
      currentMonth: '2026-07',
    });
    const due = monthReviewDue(state, '2026-07-09');
    eq(due.due, true);
    eq(due.month, '2026-06');
  });

  test('firstTrackedDay ist der erste Tag dieses Monats', () => {
    const state = baseState({ days: { '2026-07-02': { ...emptyDay(), weightKg: 80 } } });
    eq(firstTrackedDay(state, '2026-07-28'), '2026-07-01');
  });
});

suite('review — Wochen-Review bleibt schlank', () => {
  test('das Wochen-Review kennt keine Fragen und keinen Datensatz', () => {
    const state = stateWithSets(20);
    const week = weeklyReview(state, '2026-06-15');
    eq(week.kind, 'week');
    // Ein Monats-Datensatz aus einem Wochen-Review muss abgelehnt werden.
    let threw = false;
    try {
      buildMonthRecord(week, state, {});
    } catch {
      threw = true;
    }
    isTrue(threw, 'ein Wochen-Review darf keinen Monats-Datensatz erzeugen');
  });

  test('beide Reviews liefern dieselben Befund-Felder', () => {
    const state = stateWithSets(20);
    for (const review of [weeklyReview(state, '2026-06-15'), monthlyReview(state, MONTH)]) {
      for (const f of review.flags) {
        isTrue(typeof f.short === 'string' && f.short.length > 0, `${review.kind}/${f.id}`);
        isTrue(typeof f.tone === 'string', `${review.kind}/${f.id}`);
      }
    }
  });
});

suite('review — Volumen gegen den Plan, gerechnet', () => {
  test('das geplante Wochenvolumen stimmt mit dem Plan überein', () => {
    // 15 + 13 + 16 Sätze, siehe tests/volume.test.js
    eq(PLAN_SETS_PER_WEEK, 44);
  });

  test('der Plan wird auf die Länge des Zeitraums hochgerechnet', () => {
    const monat = volumeVerdict(monthSummary(stateWithSets(44), MONTH));
    close(monat.planned, 44 * (30 / 7), 0.001);
  });
});
