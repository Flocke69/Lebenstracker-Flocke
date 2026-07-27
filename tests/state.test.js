import { suite, test, eq, deepEq, isTrue, isFalse, throws } from './harness.js';
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
