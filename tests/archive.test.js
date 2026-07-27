import { suite, test, eq, close, deepEq, isTrue, isFalse, throws } from './harness.js';
import { emptyState, withProfile, withDay, withSet, getDay } from '../js/lib/state.js';
import {
  EXPORT_VERSION, EXPORT_REMINDER_DAYS,
  needsRollover, hasFreshExport, canCloseMonth, rolloverPreview,
  buildExport, exportFilename, withExportStamp, closeMonth,
  inspectImport, applyImport, exportReminder,
} from '../js/lib/archive.js';

const PROFILE = {
  sex: 'm', birthYear: 2001, heightCm: 180, startWeightKg: 80,
  matchDayWeekday: 0, teamTrainingWeekdays: [3], gymWeekdays: [1, 2, 4],
};

/** Zustand mit Daten im Juli, "heute" ist der 3. August. */
function juliMitDaten() {
  let s = withProfile(emptyState('2026-07'), PROFILE);
  for (const tag of ['2026-07-20', '2026-07-21', '2026-07-22']) {
    s = withDay(s, tag, {
      weightKg: 80.4,
      checkin: { sleepHours: 7.5, sleepQuality: 4, mood: 4, energy: 4, soreness: 2, stress: 2 },
      readiness: 78,
      nutrition: { kcal: 2200, proteinG: 175, carbsG: 200, fatG: 65 },
    });
  }
  s = withSet(s, '2026-07-20', 'a-push', 'ohp_db', 0, { reps: 10, kg: 22.5 });
  return s;
}

const AUGUST = '2026-08-03';
const NACH_JULI = '2026-08-01T09:00:00.000Z';
const IM_JULI = '2026-07-15T09:00:00.000Z';

suite('archive — steht ein Abschluss an?', () => {
  test('im laufenden Monat nicht', () => {
    isFalse(needsRollover(juliMitDaten(), '2026-07-31'));
  });

  test('am ersten Tag des Folgemonats schon', () => {
    isTrue(needsRollover(juliMitDaten(), '2026-08-01'));
  });

  test('auch über den Jahreswechsel', () => {
    const s = withProfile(emptyState('2026-12'), PROFILE);
    isTrue(needsRollover(s, '2027-01-01'));
    isFalse(needsRollover(s, '2026-12-31'));
  });
});

suite('archive — DIE SPERRE', () => {
  test('ohne Export ist der Abschluss gesperrt', () => {
    const check = canCloseMonth(juliMitDaten(), AUGUST);
    isFalse(check.allowed);
    isTrue(check.reason.includes('sichern'), check.reason);
  });

  test('ein Export AUS dem Monat zählt nicht', () => {
    // Am 15. Juli gesichert, danach noch zwei Wochen Daten — die wären weg.
    const s = withExportStamp(juliMitDaten(), IM_JULI);
    isFalse(hasFreshExport(s));
    isFalse(canCloseMonth(s, AUGUST).allowed);
  });

  test('ein Export NACH dem Monatsende macht den Weg frei', () => {
    const s = withExportStamp(juliMitDaten(), NACH_JULI);
    isTrue(hasFreshExport(s));
    isTrue(canCloseMonth(s, AUGUST).allowed);
  });

  test('closeMonth WIRFT, wenn die Sperre zu ist', () => {
    // Die Prüfung darf nicht davon abhängen, dass eine Ansicht sie vorher
    // aufgerufen hat. Ein Monat Daten haengt sonst an einem Fehltipp.
    throws(() => closeMonth(juliMitDaten(), AUGUST));
    throws(() => closeMonth(withExportStamp(juliMitDaten(), IM_JULI), AUGUST));
  });

  test('closeMonth wirft auch, wenn der Monat noch läuft', () => {
    const s = withExportStamp(juliMitDaten(), NACH_JULI);
    throws(() => closeMonth(s, '2026-07-31'));
  });

  test('ein kaputter Zeitstempel öffnet die Sperre nicht', () => {
    throws(() => withExportStamp(juliMitDaten(), 'gestern'));
    const s = { ...juliMitDaten(), lastExportAt: 'gestern' };
    isFalse(hasFreshExport(s));
  });
});

suite('archive — Vorschau', () => {
  const p = rolloverPreview(juliMitDaten());

  test('nennt Monat, Beschriftung und Anzahl der Tage', () => {
    eq(p.month, '2026-07');
    eq(p.label, 'Juli 2026');
    eq(p.dayCount, 3);
  });

  test('enthält die verdichteten Kennzahlen', () => {
    eq(p.summary.period.dayCount, 31);
    eq(p.summary.logging.daysWithWeight, 3);
    close(p.summary.readiness.avg, 78, 0.001);
  });
});

suite('archive — Export', () => {
  const dump = buildExport(juliMitDaten(), '2026-07', NACH_JULI);

  test('die Datei nennt sich nach dem Monat', () => {
    eq(exportFilename('2026-07'), 'lebenstracker-2026-07.json');
  });

  test('sie enthält Format, Monat und Zeitstempel', () => {
    eq(dump.app, 'Lebenstracker');
    eq(dump.exportVersion, EXPORT_VERSION);
    eq(dump.month, '2026-07');
    eq(dump.exportedAt, NACH_JULI);
  });

  test('sie enthält JEDEN Tag im Detail', () => {
    eq(Object.keys(dump.days).length, 3);
    close(dump.days['2026-07-20'].weightKg, 80.4, 0.001);
    eq(dump.days['2026-07-20'].sessions.length, 1, 'auch die Trainingseinheit');
  });

  test('sie enthält zusätzlich die verdichtete Summary', () => {
    // Damit die Datei auch ohne die App etwas aussagt.
    isTrue(Boolean(dump.summary));
    eq(dump.summary.period.month, '2026-07');
  });

  test('sie enthält das Profil, damit sich alles nachrechnen lässt', () => {
    eq(dump.profile.heightCm, 180);
  });

  test('Tage anderer Monate landen nicht in der Datei', () => {
    let s = juliMitDaten();
    s = withDay(s, '2026-08-02', { weightKg: 79 });
    const d = buildExport(s, '2026-07', NACH_JULI);
    isFalse('2026-08-02' in d.days);
  });

  test('sie ist echtes JSON und übersteht den Rundlauf', () => {
    const wieder = JSON.parse(JSON.stringify(dump));
    eq(wieder.month, '2026-07');
    eq(Object.keys(wieder.days).length, 3);
  });
});

suite('archive — Abschluss', () => {
  const vorher = withExportStamp(juliMitDaten(), NACH_JULI);
  const nachher = closeMonth(vorher, AUGUST);

  test('die Tage des Monats sind geleert', () => {
    eq(Object.keys(nachher.days).filter((k) => k.startsWith('2026-07')).length, 0);
  });

  test('die Summary wandert ins Archiv', () => {
    eq(nachher.months.length, 1);
    eq(nachher.months[0].month, '2026-07');
    eq(nachher.months[0].closedAt, AUGUST);
    close(nachher.months[0].summary.readiness.avg, 78, 0.001);
  });

  test('der laufende Monat rückt vor', () => {
    eq(nachher.currentMonth, '2026-08');
  });

  test('das Profil bleibt unangetastet', () => {
    eq(nachher.profile.heightCm, 180);
  });

  test('Tage ANDERER Monate bleiben erhalten', () => {
    // Nach einem Import können ältere Tage im Zustand liegen, die mit
    // diesem Abschluss nichts zu tun haben.
    let s = withDay(vorher, '2026-06-15', { weightKg: 82 });
    const out = closeMonth(s, AUGUST);
    isTrue('2026-06-15' in out.days);
  });

  test('der Ursprungszustand bleibt unverändert', () => {
    eq(Object.keys(vorher.days).length, 3, 'closeMonth arbeitet ohne Nebenwirkung');
  });

  test('ein zweiter Abschluss desselben Monats erzeugt keine Dublette', () => {
    const s2 = withExportStamp({ ...nachher, currentMonth: '2026-07' }, NACH_JULI);
    const out = closeMonth(s2, AUGUST);
    eq(out.months.filter((m) => m.month === '2026-07').length, 1);
  });
});

suite('archive — Import', () => {
  const dump = buildExport(juliMitDaten(), '2026-07', NACH_JULI);

  test('inspectImport prüft, bevor irgendetwas angefasst wird', () => {
    const info = inspectImport(dump);
    eq(info.month, '2026-07');
    eq(info.label, 'Juli 2026');
    eq(info.dayCount, 3);
    eq(info.hasProfile, true);
  });

  test('fremde und kaputte Dateien werden abgewiesen', () => {
    throws(() => inspectImport(null));
    throws(() => inspectImport('text'));
    throws(() => inspectImport({}), 'kein app-Feld');
    throws(() => inspectImport({ app: 'Lebenstracker', exportVersion: 1 }), 'kein Monat');
    throws(() => inspectImport({ ...dump, app: 'Fremd' }));
  });

  test('eine NEUERE Exportversion wird abgewiesen statt falsch gelesen', () => {
    throws(() => inspectImport({ ...dump, exportVersion: EXPORT_VERSION + 1 }));
  });

  test('Import ergänzt Tage, ohne bestehende zu überschreiben', () => {
    let ziel = withProfile(emptyState('2026-08'), PROFILE);
    ziel = withDay(ziel, '2026-07-20', { weightKg: 99 });   // schon vorhanden
    const out = applyImport(ziel, dump);
    eq(out.added, 2);
    eq(out.skipped, 1);
    close(getDay(out.state, '2026-07-20').weightKg, 99, 0.001, 'bestehender Tag bleibt');
    close(getDay(out.state, '2026-07-21').weightKg, 80.4, 0.001, 'fehlender Tag kommt dazu');
  });

  test('mit overwrite gewinnt die Datei', () => {
    let ziel = withProfile(emptyState('2026-08'), PROFILE);
    ziel = withDay(ziel, '2026-07-20', { weightKg: 99 });
    const out = applyImport(ziel, dump, { overwrite: true });
    eq(out.skipped, 0);
    close(getDay(out.state, '2026-07-20').weightKg, 80.4, 0.001);
  });

  test('der laufende Monat wird durch einen Import nicht verschoben', () => {
    const ziel = withProfile(emptyState('2026-08'), PROFILE);
    const out = applyImport(ziel, dump);
    eq(out.state.currentMonth, '2026-08');
  });

  test('die Monats-Summary landet im Archiv, ohne Dublette', () => {
    const ziel = withProfile(emptyState('2026-08'), PROFILE);
    const einmal = applyImport(ziel, dump).state;
    const zweimal = applyImport(einmal, dump).state;
    eq(zweimal.months.filter((m) => m.month === '2026-07').length, 1);
  });

  test('ein Rundlauf über Export und Import erhält die Trainingsdaten', () => {
    const ziel = withProfile(emptyState('2026-08'), PROFILE);
    const out = applyImport(ziel, JSON.parse(JSON.stringify(dump)));
    const tag = getDay(out.state, '2026-07-20');
    eq(tag.sessions.length, 1);
    eq(tag.sessions[0].exercises[0].exId, 'ohp_db');
    close(tag.sessions[0].exercises[0].sets[0].kg, 22.5, 0.001);
  });
});

suite('archive — Erinnerung', () => {
  test('ohne je gesichert zu haben wird ab genug Daten erinnert', () => {
    let s = withProfile(emptyState('2026-07'), PROFILE);
    for (let i = 1; i <= EXPORT_REMINDER_DAYS; i++) {
      s = withDay(s, `2026-07-${String(i).padStart(2, '0')}`, { weightKg: 80 });
    }
    const r = exportReminder(s, '2026-07-27');
    isTrue(r.due);
    isTrue(r.text.includes('nie gesichert'), r.text);
  });

  test('frisch gesichert erinnert nicht', () => {
    const s = withExportStamp(juliMitDaten(), '2026-07-26T10:00:00.000Z');
    const r = exportReminder(s, '2026-07-27');
    isFalse(r.due);
    eq(r.daysSince, 1);
    isTrue(r.text.includes('1 Tag'), r.text);
  });

  test('nach einer Woche ohne Sicherung wird erinnert', () => {
    const s = withExportStamp(juliMitDaten(), '2026-07-15T10:00:00.000Z');
    const r = exportReminder(s, '2026-07-27');
    isTrue(r.due);
    isTrue(r.daysSince >= EXPORT_REMINDER_DAYS);
  });
});
