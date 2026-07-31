import { suite, test, eq, deepEq, isTrue, isFalse, throws, close } from './harness.js';
import {
  SCHEMA_VERSION,
  emptyState,
  emptyDay,
  migrate,
  getDay,
  withDay,
  withProfile,
  normalizeProfile,
  isProfileComplete,
  missingProfileFields,
  weightOn,
  dayTypeFor,
  getSession,
  getSets,
  withSet,
  withoutSet,
  withSessionMeta,
  withStaleSessionsClosed,
  sessionMinutes,
  lastPerformance,
  skippedExercises,
} from '../js/lib/state.js';

const PROFILE = {
  sex: 'm',
  birthYear: 2001,
  heightCm: 180,
  startWeightKg: 80,
  matchDayWeekday: 0,
  teamTrainingWeekdays: [3],
  gymWeekdays: [1, 2, 4],
};

suite('state — leerer Zustand', () => {
  test('emptyState hat die vereinbarte Form', () => {
    const s = emptyState('2026-07');
    eq(s.schemaVersion, SCHEMA_VERSION);
    eq(s.currentMonth, '2026-07');
    eq(s.profile, null, 'ohne Profil startet das Onboarding');
    deepEq(s.days, {}, 'keine Tage');
    deepEq(s.months, [], 'kein Archiv');
    eq(s.lastExportAt, null);
  });

  test('emptyState weist einen ungültigen Monat ab', () => {
    throws(() => emptyState('2026-13'));
    throws(() => emptyState('2026-07-01'), 'voller Tagesschlüssel');
  });

  test('emptyDay hat alle Felder, aber keine erfundenen Werte', () => {
    const d = emptyDay();
    eq(d.weightKg, null, 'nicht 0 — 0 kg wäre ein Messwert');
    eq(d.readiness, null);
    eq(d.dayType, null);
    deepEq(d.sessions, []);
    eq(d.checkin, null);
    eq(d.nutrition, null);
  });
});

suite('state — Migration', () => {
  test('nichts gespeichert → frischer Zustand', () => {
    const s = migrate(null, '2026-07');
    eq(s.schemaVersion, SCHEMA_VERSION);
    eq(s.currentMonth, '2026-07');
  });

  test('kaputtes JSON-Objekt → frischer Zustand statt Absturz', () => {
    for (const junk of [undefined, 42, 'text', [], true]) {
      eq(migrate(junk, '2026-07').schemaVersion, SCHEMA_VERSION, `Eingabe: ${junk}`);
    }
  });

  test('aktueller Zustand geht unverändert durch', () => {
    const s = withProfile(emptyState('2026-07'), PROFILE);
    const out = migrate(s, '2026-07');
    eq(out.profile.heightCm, 180);
    eq(out.currentMonth, '2026-07', 'der gespeicherte Monat gewinnt');
  });

  test('eine NEUERE Schemaversion wirft, statt Daten zu verwerfen', () => {
    // Wenn eine spätere App-Version schon geschrieben hat, darf eine
    // ältere Version die Daten nicht stillschweigend platt machen.
    const future = { ...emptyState('2026-07'), schemaVersion: SCHEMA_VERSION + 1 };
    throws(() => migrate(future, '2026-07'));
  });

  test('fehlende Felder werden ergänzt, vorhandene nicht überschrieben', () => {
    const partial = { schemaVersion: 1, currentMonth: '2026-06', days: { '2026-06-15': emptyDay() } };
    const out = migrate(partial, '2026-07');
    deepEq(out.months, [], 'months ergänzt');
    eq(out.lastExportAt, null, 'lastExportAt ergänzt');
    eq(out.currentMonth, '2026-06', 'currentMonth bleibt — Rollover ist Sache von Phase 7');
    isTrue('2026-06-15' in out.days, 'Tage bleiben erhalten');
  });
});

suite('state — Tage lesen und schreiben', () => {
  test('getDay liefert für unbekannte Tage einen leeren Tag, nicht undefined', () => {
    const s = emptyState('2026-07');
    const d = getDay(s, '2026-07-27');
    eq(d.weightKg, null);
    deepEq(d.sessions, []);
  });

  test('withDay schreibt, ohne den Ursprungszustand zu verändern', () => {
    const s = emptyState('2026-07');
    const s2 = withDay(s, '2026-07-27', { weightKg: 80.4 });
    eq(getDay(s2, '2026-07-27').weightKg, 80.4);
    eq(getDay(s, '2026-07-27').weightKg, null, 'Original unberührt');
    isFalse(s === s2, 'neues Objekt');
  });

  test('withDay führt zusammen statt zu ersetzen', () => {
    let s = emptyState('2026-07');
    s = withDay(s, '2026-07-27', { weightKg: 80.4 });
    s = withDay(s, '2026-07-27', { dayType: 'gym' });
    const d = getDay(s, '2026-07-27');
    eq(d.weightKg, 80.4, 'Gewicht bleibt');
    eq(d.dayType, 'gym', 'Tagestyp dazu');
  });

  test('verschachtelte Felder werden zusammengeführt, nicht ersetzt', () => {
    let s = emptyState('2026-07');
    s = withDay(s, '2026-07-27', { checkin: { sleepHours: 7.5 } });
    s = withDay(s, '2026-07-27', { checkin: { mood: 4 } });
    const c = getDay(s, '2026-07-27').checkin;
    eq(c.sleepHours, 7.5, 'Schlaf bleibt erhalten');
    eq(c.mood, 4);
  });

  test('withDay weist ungültige Tagesschlüssel ab', () => {
    const s = emptyState('2026-07');
    throws(() => withDay(s, '27.07.2026', { weightKg: 80 }));
    throws(() => withDay(s, '2026-02-30', { weightKg: 80 }));
  });

  test('withDay weist unbekannte Tagestypen ab', () => {
    const s = emptyState('2026-07');
    throws(() => withDay(s, '2026-07-27', { dayType: 'urlaub' }));
  });

  test('unplausible Gewichte werden abgewiesen', () => {
    const s = emptyState('2026-07');
    throws(() => withDay(s, '2026-07-27', { weightKg: 0 }));
    throws(() => withDay(s, '2026-07-27', { weightKg: 500 }));
    throws(() => withDay(s, '2026-07-27', { weightKg: '80' }), 'String');
  });
});

suite('state — Profil', () => {
  test('normalizeProfile ergänzt die Standardwerte', () => {
    const p = normalizeProfile(PROFILE);
    eq(p.proteinPerKg, 2.0, 'Recomp-Standard');
    eq(p.fatPerKg, 0.8);
    eq(p.kcalOffset, 0);
    eq(p.activityFactors.match, 1.75);
  });

  test('eigene Werte überschreiben die Standardwerte', () => {
    const p = normalizeProfile({ ...PROFILE, proteinPerKg: 2.2, kcalOffset: -200 });
    eq(p.proteinPerKg, 2.2);
    eq(p.kcalOffset, -200);
  });

  test('Wochentagslisten werden sortiert und entdoppelt', () => {
    const p = normalizeProfile({ ...PROFILE, gymWeekdays: [4, 1, 4, 2] });
    deepEq(p.gymWeekdays, [1, 2, 4]);
  });

  test('unsinnige Profilwerte werden abgewiesen', () => {
    throws(() => normalizeProfile({ ...PROFILE, sex: 'x' }));
    throws(() => normalizeProfile({ ...PROFILE, heightCm: 40 }));
    throws(() => normalizeProfile({ ...PROFILE, birthYear: 2030 }));
    throws(() => normalizeProfile({ ...PROFILE, matchDayWeekday: 9 }));
    throws(() => normalizeProfile({ ...PROFILE, gymWeekdays: 'Montag' }));
  });

  test('der Spieltag darf kein Gym-Tag sein', () => {
    // Sonst würde die App sich selbst widersprechen.
    throws(() => normalizeProfile({ ...PROFILE, gymWeekdays: [0, 1, 2] }));
  });

  test('isProfileComplete verlangt genau die Felder für Mifflin-St Jeor plus Spieltag', () => {
    isTrue(isProfileComplete(normalizeProfile(PROFILE)));
    isFalse(isProfileComplete(null));
    isFalse(isProfileComplete({}));
  });

  test('missingProfileFields benennt, was fehlt', () => {
    const missing = missingProfileFields({ sex: 'm', heightCm: 180 });
    isTrue(missing.includes('birthYear'), `war: ${missing}`);
    isTrue(missing.includes('startWeightKg'), `war: ${missing}`);
    deepEq(missingProfileFields(normalizeProfile(PROFILE)), []);
  });

  test('withProfile führt zusammen und normalisiert', () => {
    let s = emptyState('2026-07');
    s = withProfile(s, PROFILE);
    s = withProfile(s, { kcalOffset: -150 });
    eq(s.profile.kcalOffset, -150);
    eq(s.profile.heightCm, 180, 'Rest bleibt erhalten');
  });
});

suite('state — Trainingseinheiten loggen', () => {
  const base = () => withProfile(emptyState('2026-07'), PROFILE);

  test('der erste Satz legt Einheit und Übung mit an', () => {
    const s = withSet(base(), '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    const sets = getSets(s, '2026-07-27', 'a-push', 'ohp_db');
    eq(sets.length, 1);
    eq(sets[0].reps, 10);
    eq(sets[0].kg, 20);
    eq(sets[0].rpe, null, 'RPE bleibt offen, bis es eingetragen wird');
  });

  test('weitere Sätze reihen sich an', () => {
    let s = base();
    s = withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    s = withSet(s, '2026-07-27', 'a-push', 'ohp_db', 1, { reps: 9, kg: 20 });
    eq(getSets(s, '2026-07-27', 'a-push', 'ohp_db').length, 2);
  });

  test('ein Satz lässt sich nachträglich ergänzen, ohne den Rest zu verlieren', () => {
    let s = base();
    s = withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    s = withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { rpe: 8 });
    const set = getSets(s, '2026-07-27', 'a-push', 'ohp_db')[0];
    eq(set.reps, 10, 'Wiederholungen bleiben');
    eq(set.rpe, 8);
  });

  test('wer mit Satz 3 anfängt, bekommt Lücken statt einer Fehlermeldung', () => {
    const s = withSet(base(), '2026-07-27', 'a-push', 'ohp_db', 2, { reps: 8, kg: 22.5 });
    const sets = getSets(s, '2026-07-27', 'a-push', 'ohp_db');
    eq(sets.length, 3);
    eq(sets[0], null);
    eq(sets[1], null);
    eq(sets[2].reps, 8);
  });

  test('mehrere Übungen in derselben Einheit', () => {
    let s = base();
    s = withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    s = withSet(s, '2026-07-27', 'a-push', 'lateral_raise', 0, { reps: 15, kg: 8 });
    eq(getSession(s, '2026-07-27', 'a-push').exercises.length, 2);
  });

  test('unsinnige Sätze werden abgewiesen', () => {
    const s = base();
    throws(() => withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 0 }));
    throws(() => withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { kg: -5 }));
    throws(() => withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { rpe: 12 }));
    throws(() => withSet(s, '2026-07-27', 'a-push', 'ohp_db', -1, { reps: 8 }));
  });

  test('withoutSet räumt leere Übungen und Einheiten mit weg', () => {
    let s = base();
    s = withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    s = withoutSet(s, '2026-07-27', 'a-push', 'ohp_db', 0);
    eq(getDay(s, '2026-07-27').sessions.length, 0, 'keine leere Hülle zurücklassen');
  });

  test('das Original bleibt beim Schreiben unberührt', () => {
    const before = base();
    withSet(before, '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    eq(getDay(before, '2026-07-27').sessions.length, 0);
  });
});

suite('state — Trainingsuhr', () => {
  const base = () => withProfile(emptyState('2026-07'), PROFILE);

  test('withSessionMeta legt die Einheit an und trägt den Start ein', () => {
    const s = withSessionMeta(base(), '2026-07-27', 'a-push',
      { startedAt: '2026-07-27T18:00:00.000Z' });
    eq(getSession(s, '2026-07-27', 'a-push').startedAt, '2026-07-27T18:00:00.000Z');
    eq(getSession(s, '2026-07-27', 'a-push').endedAt, null);
  });

  test('unlesbare Zeitstempel werden abgewiesen', () => {
    throws(() => withSessionMeta(base(), '2026-07-27', 'a-push', { startedAt: 'gestern' }));
    throws(() => withSessionMeta(base(), '2026-07-27', 'a-push', { lastSetAt: 42 }));
  });

  test('endedAt: null weckt eine beendete Einheit wieder auf', () => {
    // Ein neuer Satz auf einer beendeten Einheit heißt: es geht doch weiter.
    let s = withSessionMeta(base(), '2026-07-27', 'a-push', {
      startedAt: '2026-07-27T18:00:00.000Z',
      endedAt: '2026-07-27T19:00:00.000Z',
    });
    s = withSessionMeta(s, '2026-07-27', 'a-push', { endedAt: null });
    eq(getSession(s, '2026-07-27', 'a-push').endedAt, null);
    eq(getSession(s, '2026-07-27', 'a-push').startedAt, '2026-07-27T18:00:00.000Z',
      'der Start bleibt stehen');
  });

  test('sessionMinutes rechnet beendete Einheiten aus Start und Ende', () => {
    const session = {
      startedAt: '2026-07-27T18:00:00.000Z',
      endedAt: '2026-07-27T18:45:30.000Z',
    };
    close(sessionMinutes(session), 45.5);
  });

  test('sessionMinutes rechnet laufende Einheiten gegen jetzt', () => {
    const start = Date.parse('2026-07-27T18:00:00.000Z');
    const session = { startedAt: '2026-07-27T18:00:00.000Z', endedAt: null };
    close(sessionMinutes(session, start + 20 * 60000), 20);
  });

  test('sessionMinutes ohne Start ist null, nicht 0', () => {
    eq(sessionMinutes({}), null);
    eq(sessionMinutes({ startedAt: null }), null);
  });

  test('withStaleSessionsClosed beendet vergessene Einheiten auf den letzten Satz', () => {
    let s = withSet(base(), '2026-07-25', 'c-legs', 'rdl_db', 0, { reps: 8, kg: 40 });
    s = withSessionMeta(s, '2026-07-25', 'c-legs', {
      startedAt: '2026-07-25T18:00:00.000Z',
      lastSetAt: '2026-07-25T19:10:00.000Z',
    });
    s = withStaleSessionsClosed(s, '2026-07-27');
    const session = getSession(s, '2026-07-25', 'c-legs');
    eq(session.endedAt, '2026-07-25T19:10:00.000Z', 'der letzte Satz ist das Ende');
    close(sessionMinutes(session), 70);
  });

  test('eine vergessene Uhr ohne einen einzigen Satz verschwindet ganz', () => {
    // Nur geöffnet und nie geloggt: das war kein Training — und darf später
    // nirgends als Trainingstag auftauchen.
    let s = withSessionMeta(base(), '2026-07-25', 'c-legs',
      { startedAt: '2026-07-25T18:00:00.000Z' });
    s = withStaleSessionsClosed(s, '2026-07-27');
    eq(getSession(s, '2026-07-25', 'c-legs'), null);
  });

  test('beendete leere Hüllen verschwinden an jedem Tag, auch in der Zukunft', () => {
    // Artefakte aus Altversionen: beendet, aber ohne einen Satz. Sie würden
    // sonst als „fertige Einheit" den Startknopf verdecken.
    let s = withSessionMeta(base(), '2026-07-30', 'c-legs', {
      startedAt: '2026-07-28T09:00:00.000Z',
      endedAt: '2026-07-28T09:00:02.000Z',
    });
    s = withStaleSessionsClosed(s, '2026-07-28');
    eq(getSession(s, '2026-07-30', 'c-legs'), null);
  });

  test('beendete Einheiten MIT Sätzen bleiben unangetastet', () => {
    let s = withSet(base(), '2026-07-30', 'c-legs', 'rdl_db', 0, { reps: 8, kg: 40 });
    s = withSessionMeta(s, '2026-07-30', 'c-legs', {
      startedAt: '2026-07-28T09:00:00.000Z',
      endedAt: '2026-07-28T10:00:00.000Z',
    });
    eq(withStaleSessionsClosed(s, '2026-07-28'), s, 'dasselbe Objekt, kein Umbau');
  });

  test('die laufende Einheit von HEUTE bleibt unangetastet', () => {
    let s = withSessionMeta(base(), '2026-07-27', 'a-push',
      { startedAt: '2026-07-27T18:00:00.000Z' });
    s = withStaleSessionsClosed(s, '2026-07-27');
    eq(getSession(s, '2026-07-27', 'a-push').endedAt, null, 'heute läuft weiter');
  });

});

suite('state — ausgelassene Übungen', () => {
  const base = () => withProfile(emptyState('2026-07'), PROFILE);

  test('eine neue Einheit hat noch nichts ausgelassen', () => {
    const s = withSessionMeta(base(), '2026-07-30', 'c-legs',
      { startedAt: '2026-07-30T18:00:00.000Z' });
    deepEq(skippedExercises(getSession(s, '2026-07-30', 'c-legs')), []);
  });

  test('beim Abschließen entfallene Übungen bleiben an der Einheit', () => {
    let s = withSet(base(), '2026-07-30', 'c-legs', 'squat_bb', 0, { reps: 6, kg: 60 });
    s = withSessionMeta(s, '2026-07-30', 'c-legs',
      { skipped: ['leg_curl_machine', 'leg_extension'] });
    deepEq(skippedExercises(getSession(s, '2026-07-30', 'c-legs')),
      ['leg_curl_machine', 'leg_extension']);
  });

  test('EIN GELOGGTER SATZ HOLT DIE ÜBUNG ZURÜCK', () => {
    /* Wer eine entfallene Übung doch noch macht, hat sie nicht ausgelassen.
       Das ergibt sich aus dem Log selbst — es braucht keinen zweiten
       Schreibvorgang, der auseinanderlaufen könnte. */
    let s = withSessionMeta(base(), '2026-07-30', 'c-legs',
      { skipped: ['leg_curl_machine', 'leg_extension'] });
    s = withSet(s, '2026-07-30', 'c-legs', 'leg_extension', 0, { reps: 10, kg: 45 });
    deepEq(skippedExercises(getSession(s, '2026-07-30', 'c-legs')), ['leg_curl_machine']);
  });

  test('lauter Lücken holen nichts zurück', () => {
    // Ein Übungseintrag ohne einen einzigen gefüllten Satz ist kein Training.
    deepEq(skippedExercises({
      planId: 'c-legs',
      skipped: ['leg_extension'],
      exercises: [{ exId: 'leg_extension', sets: [null, null] }],
    }), ['leg_extension']);
  });

  test('skipped muss eine Liste von Kennungen sein', () => {
    throws(() => withSessionMeta(base(), '2026-07-30', 'c-legs', { skipped: 'rdl_db' }));
    throws(() => withSessionMeta(base(), '2026-07-30', 'c-legs', { skipped: [7] }));
  });

  test('alte Einheiten ohne das Feld sind einfach leer', () => {
    // Zustände aus einer Version vor dieser Änderung kennen `skipped` nicht.
    deepEq(skippedExercises({ planId: 'c-legs', exercises: [] }), []);
    deepEq(skippedExercises(null), []);
  });
});

suite('state — letztes Mal', () => {
  const base = () => withProfile(emptyState('2026-07'), PROFILE);

  test('findet den letzten Tag mit dieser Übung', () => {
    let s = base();
    s = withSet(s, '2026-07-13', 'a-push', 'ohp_db', 0, { reps: 10, kg: 20 });
    s = withSet(s, '2026-07-20', 'a-push', 'ohp_db', 0, { reps: 10, kg: 22.5 });
    const last = lastPerformance(s, '2026-07-27', 'ohp_db');
    eq(last.dayKey, '2026-07-20', 'der jüngste zählt');
    eq(last.sets[0].kg, 22.5);
  });

  test('der heutige Tag zählt nicht mit', () => {
    // Sonst zeigt "letztes Mal" den Satz, den man gerade eingetippt hat.
    let s = base();
    s = withSet(s, '2026-07-20', 'a-push', 'ohp_db', 0, { reps: 10, kg: 22.5 });
    s = withSet(s, '2026-07-27', 'a-push', 'ohp_db', 0, { reps: 11, kg: 22.5 });
    eq(lastPerformance(s, '2026-07-27', 'ohp_db').dayKey, '2026-07-20');
  });

  test('ohne Vorgeschichte kommt null zurück', () => {
    eq(lastPerformance(base(), '2026-07-27', 'ohp_db'), null);
  });

  test('leere Lücken werden übersprungen', () => {
    let s = base();
    s = withSet(s, '2026-07-20', 'a-push', 'ohp_db', 2, { reps: 8, kg: 25 });
    const last = lastPerformance(s, '2026-07-27', 'ohp_db');
    eq(last.sets.length, 1, 'nur der tatsächlich gefüllte Satz');
    eq(last.sets[0].kg, 25);
  });
});

suite('state — abgeleitete Werte', () => {
  test('weightOn nimmt den letzten gemessenen Wert, wenn heute keiner steht', () => {
    let s = withProfile(emptyState('2026-07'), PROFILE);
    s = withDay(s, '2026-07-25', { weightKg: 80.4 });
    s = withDay(s, '2026-07-26', { weightKg: 80.1 });
    eq(weightOn(s, '2026-07-26'), 80.1, 'eigener Messwert');
    eq(weightOn(s, '2026-07-27'), 80.1, 'letzter bekannter Wert');
  });

  test('weightOn fällt auf das Startgewicht zurück, wenn nichts gemessen ist', () => {
    const s = withProfile(emptyState('2026-07'), PROFILE);
    eq(weightOn(s, '2026-07-27'), 80, 'startWeightKg');
  });

  test('weightOn ignoriert Messwerte aus der Zukunft', () => {
    let s = withProfile(emptyState('2026-07'), PROFILE);
    s = withDay(s, '2026-07-29', { weightKg: 79.0 });
    eq(weightOn(s, '2026-07-27'), 80, 'der Wert von übermorgen zählt heute nicht');
  });

  test('dayTypeFor leitet den Tagestyp aus dem Profil ab', () => {
    const s = withProfile(emptyState('2026-07'), PROFILE);
    eq(dayTypeFor(s, '2026-08-02'), 'match', 'Sonntag');
    eq(dayTypeFor(s, '2026-07-29'), 'team', 'Mittwoch');
    eq(dayTypeFor(s, '2026-07-27'), 'gym', 'Montag');
    eq(dayTypeFor(s, '2026-07-31'), 'rest', 'Freitag');
  });

  test('ein von Hand gesetzter Tagestyp gewinnt gegen die Ableitung', () => {
    // Ein Gym-Tag, an dem nichts stattgefunden hat, ist ein Ruhetag.
    let s = withProfile(emptyState('2026-07'), PROFILE);
    s = withDay(s, '2026-07-27', { dayType: 'rest' });
    eq(dayTypeFor(s, '2026-07-27'), 'rest');
  });

  test('Spieltag hat Vorrang vor Mannschaftstraining am selben Wochentag', () => {
    const s = withProfile(emptyState('2026-07'),
      { ...PROFILE, matchDayWeekday: 3, teamTrainingWeekdays: [3] });
    eq(dayTypeFor(s, '2026-07-29'), 'match', 'Mittwoch ist beides → Spiel wiegt schwerer');
  });
});
