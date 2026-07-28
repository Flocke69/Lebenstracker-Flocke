import { suite, test, eq, deepEq, isTrue, isFalse, throws } from './harness.js';
import {
  sessionForDay, movedToInWeek, weekPlan, rateMoveTarget, moveTargets,
  recommendMove, sessionDoneInWeek, PENALTY,
} from '../js/lib/schedule.js';
import { withScheduleOverride, emptyState, NO_SESSION } from '../js/lib/state.js';

/* Eine Woche im Juli 2026:
 *   Mo 2026-07-06  Di 07  Mi 08  Do 09  Fr 10  Sa 11  So 12
 * Spiel Sonntag, Mannschaftstraining Mittwoch — Flockes Rhythmus.
 */
const MO = '2026-07-06';
const DI = '2026-07-07';
const MI = '2026-07-08';
const DO = '2026-07-09';
const FR = '2026-07-10';
const SA = '2026-07-11';
const SO = '2026-07-12';

function baseState(patch = {}) {
  return {
    ...emptyState('2026-07'),
    profile: {
      sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
      matchDayWeekday: 0,
      teamTrainingWeekdays: [3],
      gymWeekdays: [1, 2, 4],
    },
    ...patch,
  };
}

suite('schedule — welche Einheit steht an diesem Tag', () => {
  const state = baseState();

  test('ohne Verschiebung gilt der Wochentag aus dem Plan', () => {
    eq(sessionForDay(state, MO).id, 'a-push');
    eq(sessionForDay(state, DI).id, 'b-pull');
    eq(sessionForDay(state, DO).id, 'c-legs');
    eq(sessionForDay(state, MI), null, 'Mittwoch ist Mannschaftstraining');
    eq(sessionForDay(state, SO), null, 'Sonntag ist Spieltag');
  });

  test('eine Verschiebung setzt den Wochentag außer Kraft', () => {
    const moved = withScheduleOverride(state, FR, 'a-push');
    eq(sessionForDay(moved, FR).id, 'a-push');
  });

  test('DIE EINHEIT STEHT DANACH NICHT ZWEIMAL IN DER WOCHE', () => {
    /* Der eigentliche Fallstrick: nach dem Verschieben von Montag auf Freitag
       darf Montag nicht weiterhin Push anzeigen. */
    const moved = withScheduleOverride(state, FR, 'a-push');
    eq(sessionForDay(moved, FR).id, 'a-push');
    eq(sessionForDay(moved, MO), null, 'Montag ist jetzt frei');
  });

  test('„hier nichts" wird respektiert', () => {
    const blank = withScheduleOverride(state, MO, NO_SESSION);
    eq(sessionForDay(blank, MO), null);
  });

  test('movedToInWeek findet den Ausweichtag, sonst null', () => {
    const moved = withScheduleOverride(state, FR, 'a-push');
    eq(movedToInWeek(moved, MO, 'a-push'), FR);
    eq(movedToInWeek(moved, MO, 'b-pull'), null);
    // Eine Verschiebung in einer ANDEREN Woche zählt hier nicht.
    const other = withScheduleOverride(state, '2026-07-17', 'a-push');
    eq(movedToInWeek(other, MO, 'a-push'), null);
  });

  test('weekPlan nennt für jede Einheit den Tag, an dem sie wirklich steht', () => {
    const moved = withScheduleOverride(state, SA, 'c-legs');
    const plan = weekPlan(moved, MO);
    eq(plan.length, 3);
    const legs = plan.find((p) => p.session.id === 'c-legs');
    eq(legs.dayKey, SA);
    isTrue(legs.isMoved);
    eq(legs.plannedDayKey, DO, 'der Plantag bleibt bekannt');
    const push = plan.find((p) => p.session.id === 'a-push');
    eq(push.dayKey, MO);
    isFalse(push.isMoved);
  });
});

suite('schedule — Bewertung eines Ausweichtags', () => {
  const state = baseState();
  const options = { today: MO };

  test('am Spieltag geht keine Einheit', () => {
    for (const planId of ['a-push', 'b-pull', 'c-legs']) {
      const sonntag = rateMoveTarget(state, planId, SO, options);
      isFalse(sonntag.possible, planId);
      eq(sonntag.malus, PENALTY.blocked, planId);
      isTrue(sonntag.reason.includes('Spieltag'), `war: "${sonntag.reason}"`);
    }
  });

  test('DER TAG VOR DEM SPIEL TRENNT NACH EINHEIT', () => {
    /* Beinarbeit ist am Samstag gesperrt. Drücken und Ziehen kosten die Beine
       nichts — das bleibt möglich, nur teuer. Eine gemeinsame Sperre hätte ein
       Pull-Training mit „die Beine gehören dem Spiel" abgelehnt, und diese
       Begründung hat mit der Einheit nichts zu tun. */
    const beine = rateMoveTarget(state, 'c-legs', SA, options);
    isFalse(beine.possible);
    isTrue(beine.reason.toLowerCase().includes('beinarbeit'), `war: "${beine.reason}"`);

    const pull = rateMoveTarget(state, 'b-pull', SA, options);
    isTrue(pull.possible, 'Oberkörper am Vortag ist erlaubt');
    isTrue(pull.malus >= PENALTY.dayBeforeMatch, `Malus war ${pull.malus}`);
    isFalse(pull.reason.toLowerCase().includes('beine'),
      `die Begründung darf nicht von Beinen reden, war: "${pull.reason}"`);
  });

  test('der Beintag braucht Abstand zum Spiel', () => {
    // Freitag: 2 Tage vor dem Spiel — für schwere Beine zu knapp.
    const freitag = rateMoveTarget(state, 'c-legs', FR, options);
    isTrue(freitag.malus >= PENALTY.legsWithoutRoom,
      `Malus war ${freitag.malus}`);
    // Für den Oberkörper ist derselbe Tag unauffällig.
    const push = rateMoveTarget(state, 'a-push', FR, options);
    isTrue(push.malus < PENALTY.legsWithoutRoom, `Malus war ${push.malus}`);
  });

  test('ein Tag mit anderer Einheit wird schwer bestraft und begründet', () => {
    const rated = rateMoveTarget(state, 'a-push', DI, options);
    isTrue(rated.malus >= PENALTY.alreadyTaken, `Malus war ${rated.malus}`);
    isTrue(rated.reason.includes('Pull'), `war: "${rated.reason}"`);
  });

  test('Mannschaftstraining und der Tag davor kosten Malus', () => {
    const mittwoch = rateMoveTarget(state, 'a-push', MI, options);
    isTrue(mittwoch.malus >= PENALTY.onTeamTraining, `Malus war ${mittwoch.malus}`);
    isTrue(mittwoch.reason.toLowerCase().includes('mannschaftstraining'),
      `war: "${mittwoch.reason}"`);
  });

  test('Tage in der Vergangenheit sind möglich, aber teuer', () => {
    const rated = rateMoveTarget(state, 'a-push', MO, { today: FR });
    isTrue(rated.possible, 'Nachtragen muss gehen');
    isTrue(rated.malus >= PENALTY.inThePast, `Malus war ${rated.malus}`);
  });

  test('unbekannte Einheit wirft', () => {
    throws(() => rateMoveTarget(state, 'gibts-nicht', FR, options));
  });
});

suite('schedule — Empfehlung', () => {
  const state = baseState();

  test('moveTargets liefert alle Tage außer dem eigenen, bester zuerst', () => {
    const targets = moveTargets(state, 'a-push', MO, { today: MO });
    eq(targets.length, 6, 'sechs andere Tage der Woche');
    isFalse(targets.some((t) => t.dayKey === MO));
    for (let i = 1; i < targets.length; i += 1) {
      isTrue(targets[i - 1].malus <= targets[i].malus, 'nach Malus sortiert');
    }
  });

  test('für Push wird ein freier Tag empfohlen, mit Begründung', () => {
    const reco = recommendMove(state, 'a-push', MO, { today: MO });
    isTrue(reco !== null, 'es gibt einen Ausweichtag');
    // Freitag ist frei, weit weg von Dienstag und Donnerstag.
    eq(reco.dayKey, FR);
    isTrue(reco.headline.includes('Push'), `war: "${reco.headline}"`);
    isTrue(reco.detail.length > 0, 'ohne Begründung ist es ein Orakel');
  });

  test('EIN EINWAND WIRD ALS EINWAND BENANNT, NICHT ALS ARGUMENT', () => {
    /* Der beste Tag ist nicht immer ein guter Tag. Steht unter „Empfehlung"
       nur „Direkt neben Beintag", liest sich der Einwand wie ein Grund dafür. */
    const reco = recommendMove(state, 'b-pull', DI, { today: MO });
    isTrue(reco !== null);
    if (reco.isClean) {
      eq(reco.detail, 'Freier Tag, nichts spricht dagegen.');
    } else {
      isTrue(reco.detail.startsWith('Bester verfügbarer Tag.'), `war: "${reco.detail}"`);
    }
  });

  test('DIE EMPFEHLUNG SCHLÄGT NIE EINEN BELEGTEN TAG VOR', () => {
    const reco = recommendMove(state, 'a-push', MO, { today: MO });
    eq(sessionForDay(state, reco.dayKey), null);
  });

  test('für den Beintag wird kein Tag ohne Abstand zum Spiel empfohlen', () => {
    const reco = recommendMove(state, 'c-legs', DO, { today: MO });
    if (reco !== null) {
      eq(reco.allowance.level, 'heavy',
        `empfohlen wurde ${reco.dayKey} mit Stufe ${reco.allowance.level}`);
    }
  });

  test('gibt es keinen brauchbaren Tag, ist null die ehrliche Antwort', () => {
    // Mannschaftstraining an fünf Tagen: für den Beintag bleibt nichts übrig,
    // was nicht mindestens einen harten Malus trägt.
    const enge = baseState({
      profile: {
        sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
        matchDayWeekday: 0,
        teamTrainingWeekdays: [1, 2, 3, 4, 5],
        gymWeekdays: [1, 2, 4],
      },
    });
    const reco = recommendMove(enge, 'c-legs', DO, { today: MO });
    // Entweder null oder ein Tag, der schwere Beine wirklich trägt — nie
    // stillschweigend ein ungeeigneter.
    if (reco !== null) eq(reco.allowance.level, 'heavy');
  });
});

suite('schedule — ist die Einheit erledigt', () => {
  test('gezählt wird an geloggten Sätzen, nicht am Startknopf', () => {
    const nurGestartet = baseState({
      days: {
        [MO]: {
          checkin: null, weightKg: null, readiness: null, nutrition: null, dayType: null,
          sessions: [{
            planId: 'a-push', exercises: [], sessionRpe: null,
            startedAt: '2026-07-06T18:00:00.000Z', endedAt: null,
          }],
        },
      },
    });
    eq(sessionDoneInWeek(nurGestartet, MO, 'a-push'), null,
      'gestartet und nichts eingetragen ist nicht erledigt');

    const geloggt = baseState({
      days: {
        [MO]: {
          checkin: null, weightKg: null, readiness: null, nutrition: null, dayType: null,
          sessions: [{
            planId: 'a-push',
            exercises: [{ exId: 'curl_cable', sets: [{ reps: 10, kg: 15, rpe: null }] }],
            sessionRpe: null, startedAt: null, endedAt: null,
          }],
        },
      },
    });
    eq(sessionDoneInWeek(geloggt, MO, 'a-push'), MO);
    eq(sessionDoneInWeek(geloggt, SO, 'a-push'), MO, 'ganze Woche wird durchsucht');
    eq(sessionDoneInWeek(geloggt, MO, 'b-pull'), null);
  });

  test('leere Satzlücken zählen nicht als gemachter Satz', () => {
    const lueckig = baseState({
      days: {
        [MO]: {
          checkin: null, weightKg: null, readiness: null, nutrition: null, dayType: null,
          sessions: [{
            planId: 'a-push',
            exercises: [{ exId: 'curl_cable', sets: [null, null] }],
            sessionRpe: null, startedAt: null, endedAt: null,
          }],
        },
      },
    });
    eq(sessionDoneInWeek(lueckig, MO, 'a-push'), null);
  });
});

suite('state — Verschiebung schreiben und zurücknehmen', () => {
  test('null löscht den Eintrag und lässt wieder den Plan gelten', () => {
    const state = baseState();
    const moved = withScheduleOverride(state, FR, 'a-push');
    deepEq(Object.keys(moved.schedule), [FR]);

    const undone = withScheduleOverride(moved, FR, null);
    deepEq(Object.keys(undone.schedule), []);
    eq(sessionForDay(undone, MO).id, 'a-push', 'Montag trägt wieder Push');
  });

  test('der ursprüngliche Zustand bleibt unangetastet', () => {
    const state = baseState();
    withScheduleOverride(state, FR, 'a-push');
    deepEq(Object.keys(state.schedule), []);
  });

  test('ein ungültiger Tagesschlüssel wirft', () => {
    throws(() => withScheduleOverride(baseState(), 'morgen', 'a-push'));
  });
});
