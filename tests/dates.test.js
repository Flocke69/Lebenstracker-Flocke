import { suite, test, eq, deepEq, throws } from './harness.js';
import {
  dateKey,
  parseKey,
  monthKey,
  todayKey,
  addDays,
  daysBetween,
  weekdayOf,
  weekStartKey,
  weekKeys,
  monthDays,
  daysUntilWeekday,
  daysToNearestWeekday,
  isSameMonth,
} from '../js/lib/dates.js';

suite('dates — Schlüssel und Zeitzone', () => {
  test('parseKey liefert ein LOKALES Datum, keine UTC-Verschiebung', () => {
    // new Date('2026-07-27') würde als UTC gelesen und in negativen
    // Zeitzonen auf den 26. rutschen. Genau das darf hier nicht passieren.
    const d = parseKey('2026-07-27');
    eq(d.getFullYear(), 2026, 'Jahr');
    eq(d.getMonth(), 6, 'Monat (0-basiert, Juli = 6)');
    eq(d.getDate(), 27, 'Tag');
  });

  test('dateKey und parseKey sind zueinander invers', () => {
    for (const key of ['2026-01-01', '2026-07-27', '2026-12-31', '2024-02-29']) {
      eq(dateKey(parseKey(key)), key, `Rundlauf für ${key}`);
    }
  });

  test('dateKey füllt Monat und Tag auf zwei Stellen auf', () => {
    eq(dateKey(new Date(2026, 0, 5)), '2026-01-05');
  });

  test('monthKey schneidet den Tag ab', () => {
    eq(monthKey('2026-07-27'), '2026-07');
    eq(monthKey(new Date(2026, 6, 27)), '2026-07');
  });

  test('todayKey hat das Format YYYY-MM-DD', () => {
    eq(/^\d{4}-\d{2}-\d{2}$/.test(todayKey()), true, 'Formatprüfung');
  });

  test('ungültige Schlüssel werden abgewiesen statt still zu rechnen', () => {
    throws(() => parseKey('27.07.2026'), 'deutsches Format');
    throws(() => parseKey('2026-13-01'), 'Monat 13');
    throws(() => parseKey('2026-02-30'), 'nicht existierender Tag');
    throws(() => parseKey(''), 'leerer String');
    throws(() => parseKey(null), 'null');
  });
});

suite('dates — Rechnen mit Tagen', () => {
  test('addDays überschreitet Monatsgrenzen', () => {
    eq(addDays('2026-07-31', 1), '2026-08-01');
    eq(addDays('2026-08-01', -1), '2026-07-31');
  });

  test('addDays überschreitet Jahresgrenzen', () => {
    eq(addDays('2026-12-31', 1), '2027-01-01');
    eq(addDays('2027-01-01', -1), '2026-12-31');
  });

  test('addDays behandelt Schaltjahre korrekt', () => {
    eq(addDays('2024-02-28', 1), '2024-02-29', '2024 ist ein Schaltjahr');
    eq(addDays('2026-02-28', 1), '2026-03-01', '2026 ist keines');
  });

  test('addDays mit 0 ändert nichts', () => {
    eq(addDays('2026-07-27', 0), '2026-07-27');
  });

  test('daysBetween zählt vorzeichenrichtig', () => {
    eq(daysBetween('2026-07-27', '2026-07-30'), 3);
    eq(daysBetween('2026-07-30', '2026-07-27'), -3);
    eq(daysBetween('2026-07-27', '2026-07-27'), 0);
  });

  test('daysBetween ist unempfindlich gegen Sommerzeitwechsel', () => {
    // 2026: Umstellung in Europa am 29.03. und am 25.10.
    eq(daysBetween('2026-03-28', '2026-03-30'), 2, 'Frühjahr');
    eq(daysBetween('2026-10-24', '2026-10-26'), 2, 'Herbst');
  });
});

suite('dates — Wochen', () => {
  test('weekdayOf folgt der JS-Konvention (0 = Sonntag)', () => {
    eq(weekdayOf('2026-07-27'), 1, '27.07.2026 ist ein Montag');
    eq(weekdayOf('2026-08-01'), 6, '01.08.2026 ist ein Samstag');
    eq(weekdayOf('2026-08-02'), 0, '02.08.2026 ist ein Sonntag');
  });

  test('weekStartKey liefert den Montag der Woche', () => {
    eq(weekStartKey('2026-07-27'), '2026-07-27', 'Montag bleibt Montag');
    eq(weekStartKey('2026-07-30'), '2026-07-27', 'Donnerstag');
    eq(weekStartKey('2026-08-02'), '2026-07-27', 'Sonntag gehört zur Vorwoche');
  });

  test('weekKeys liefert 7 Tage ab Montag', () => {
    deepEq(weekKeys('2026-07-30'), [
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02',
    ]);
  });

  test('daysUntilWeekday zählt vorwärts, 0 wenn heute', () => {
    eq(daysUntilWeekday('2026-07-27', 6), 5, 'Montag bis Samstag');
    eq(daysUntilWeekday('2026-07-27', 1), 0, 'Montag bis Montag');
    eq(daysUntilWeekday('2026-08-01', 1), 2, 'Samstag bis Montag');
  });

  test('daysToNearestWeekday liefert den kleinsten Abstand in beide Richtungen', () => {
    // Diese Funktion trägt die Spieltags-Regel: sie beantwortet
    // "wie weit ist der Spieltag entfernt", egal ob vor oder zurück.
    eq(daysToNearestWeekday('2026-07-27', 6), 2, 'Mo → Sa: rückwärts 2 Tage');
    eq(daysToNearestWeekday('2026-07-29', 6), 3, 'Mi → Sa: 3 Tage in beide Richtungen');
    eq(daysToNearestWeekday('2026-07-31', 6), 1, 'Fr → Sa: 1 Tag');
    eq(daysToNearestWeekday('2026-08-01', 6), 0, 'Samstag selbst');
  });
});

suite('dates — Monate', () => {
  test('monthDays liefert alle Tage des Monats', () => {
    eq(monthDays('2026-07').length, 31, 'Juli');
    eq(monthDays('2026-02').length, 28, 'Februar 2026');
    eq(monthDays('2024-02').length, 29, 'Februar 2024, Schaltjahr');
    eq(monthDays('2026-07')[0], '2026-07-01', 'erster Tag');
    eq(monthDays('2026-07')[30], '2026-07-31', 'letzter Tag');
  });

  test('isSameMonth vergleicht nur Jahr und Monat', () => {
    eq(isSameMonth('2026-07-01', '2026-07-31'), true);
    eq(isSameMonth('2026-07-31', '2026-08-01'), false);
    eq(isSameMonth('2025-07-15', '2026-07-15'), false, 'anderes Jahr');
  });

  test('ungültige Monatsschlüssel werden abgewiesen', () => {
    throws(() => monthDays('2026-13'), 'Monat 13');
    throws(() => monthDays('2026-07-01'), 'voller Datumsschlüssel');
  });
});
