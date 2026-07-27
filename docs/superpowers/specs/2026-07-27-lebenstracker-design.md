# Lebenstracker-Flocke — Design-Dokument

**Datum:** 2026-07-27
**Status:** freigegeben, in Umsetzung

---

## 1. Problem

Flocke spielt Amateurfußball (1 Mannschaftstraining + 1 Spiel pro Woche) und will parallel 3×
Krafttraining machen. Ziel für die nächsten 3 Monate ist **Recomp**: Fett runter, Muskel rauf, bei
weitgehend stabilem Gewicht.

Das Problem ist nicht fehlende Datenerfassung — davon gibt es genug Apps. Das Problem ist die
**tägliche Entscheidung**: Was ist heute richtig, ohne dass ich am Wochenende platt bin? Recomp
neben Fußball funktioniert nur, wenn drei Dinge gleichzeitig stimmen: Protein hoch, Progression
stetig, Regeneration überwacht. Fällt eines weg, passiert entweder nichts oder es kommt eine
Verletzung.

Ein Zweitproblem ist der Datenhaushalt: Flocke will bewusst **nicht** unbegrenzt Daten in der App
horten, sondern monatlich sichern und verdichten.

## 2. Ziele

1. Täglicher Check-in in unter 60 Sekunden, der eine **konkrete, begründete Trainingsanweisung**
   ausgibt.
2. Trainingsplan, der um den Spieltag herum gebaut ist und Fußballleistung schützt.
3. Ziel-Makros nach Mifflin-St Jeor, mit Kohlenhydraten periodisiert um die Fußballbelastung.
4. Trends, die Rauschen von Signal trennen (Gewicht als Gleitschnitt, nicht als Tageswert).
5. Wochen- und Monats-Review mit Flags und Empfehlungen, plus Übergabe an Claude für das
   ausführliche Gespräch.
6. Monatlicher Export mit harter Sperre gegen Datenverlust.
7. Läuft auf iPhone und Android als installierte App, vollständig offline.

### Nicht-Ziele

- **Keine Lebensmittel-Datenbank.** Gegen MyFitnessPal ist das nicht zu gewinnen; Ist-Werte werden
  grob eingetragen.
- **Kein Account, kein Server, keine Cloud-Synchronisation.**
- **Keine KI in der App.** Reviews sind regelbasiert und transparent; die Tiefe kommt über den
  Copy-Block ins Gespräch mit Claude.
- **Keine Apple-Health-Anbindung.** Aus einer PWA technisch nicht möglich.
- **Kein Light-Mode in v1** (siehe 6.5).

## 3. Randbedingungen der Umgebung

Geprüft am 2026-07-27:

| Befund | Konsequenz |
|---|---|
| Kein `node`, kein `npm`, kein `brew` | Vanilla-JS-PWA ohne Build-Step, keine Dependencies |
| Kein `gh`, keine SSH-Keys, kein Credential-Helper | Einmaliges Hinterlegen eines SSH-Keys durch Flocke |
| `python3` 3.9.6, `curl` vorhanden | Statischer Testserver, Schriften offline mitgeliefert, Farbprüfung als Python-Skript |
| Projektordner in iCloud Drive | Akzeptiert; GitHub ist das Backup, damit ist ein Sync-Konflikt am `.git` reparierbar |
| GitHub Pages (Free) braucht öffentliches Repo | Repo öffentlich, enthält aber nur Code — nie Gesundheitsdaten |

Die Entscheidung gegen ein Framework ist damit nicht nur erzwungen, sondern richtig: ein
persönliches Werkzeug, das über Jahre laufen soll, hat mit null Dependencies die längste
Haltbarkeit.

## 4. Architektur

Zero-Build-PWA aus ES-Modulen. Die zentrale Trennlinie:

> **`js/lib/` enthält reine Funktionen und kennt kein DOM. `js/views/` rendert und kennt `js/lib/`.
> Nie umgekehrt.**

Daraus folgt, dass die gesamte Rechenlogik ohne Browser-Automatisierung testbar ist — die
Voraussetzung dafür, dass Tests ohne `npm` überhaupt Sinn haben.

```
index.html                App-Shell, Tab-Bar, View-Container
tests.html                Test-Runner im Browser
manifest.webmanifest
sw.js                     Service Worker: Offline-Cache, Versionierung
css/     tokens.css · base.css · components.css
js/
  app.js                  Init, View-Routing, Rollover-Prüfung beim Start
  store.js                localStorage, Schema-Version, Migration
  lib/
    energy.js             Mifflin-St Jeor, TDEE je Tagestyp, Makro-Verteilung
    readiness.js          Bereitschafts-Score + Trainings-Anpassung
    aggregate.js          Wochen-/Monatskennzahlen, gleitender Durchschnitt
    volume.js             Satz-/Tonnage-Volumen je Muskelgruppe
    planner.js            Einheiten-Platzierung relativ zum Spieltag
    review.js             Regelwerk: Flags + Empfehlungen
    dates.js              Wochen-/Monatsgrenzen, ISO-Keys
  views/
    today.js  training.js  nutrition.js  trends.js  review.js
    profile.js  archive.js
    chart.js              SVG-Charts von Hand, keine Bibliothek
data/    exercises.js · plan-default.js
tools/   check_contrast.py
fonts/   icons/
```

### 4.1 Datenmodell

Ein JSON-Objekt im `localStorage`:

```js
{
  schemaVersion: 1,
  profile: {
    sex, birthYear, heightCm,
    matchDayWeekday,               // 0–6, die Woche wird um diesen Tag gebaut
    teamTrainingWeekdays: [],
    gymWeekdays: [],
    activityFactors: { rest: 1.35, gym: 1.50, team: 1.65, match: 1.75 },
    proteinPerKg: 2.0, fatPerKg: 0.8,
    kcalOffset: 0                  // wird nur nach Bestätigung durch Flocke geändert
  },
  currentMonth: '2026-07',
  days: {                          // ausschließlich der laufende Monat
    '2026-07-27': {
      checkin: { sleepHours, sleepQuality, mood, energy, soreness, stress, note },
      weightKg,
      readiness,                   // berechnet und gespeichert
      nutrition: { kcal, proteinG, carbsG, fatG },
      dayType: 'rest' | 'gym' | 'team' | 'match',
      sessions: [ { planId, exercises: [ { exId, sets: [ { reps, kg, rpe } ] } ], sessionRpe } ]
    }
  },
  months: [ { month: '2026-06', summary: { … } } ],   // dauerhaft, trägt die Langzeit-Trends
  plan: { … },
  lastExportAt: '2026-07-01T…'
}
```

### 4.2 Monats-Rollover

Beim Start vergleicht `app.js` `currentMonth` mit dem heutigen Monat. Bei Abweichung erscheint ein
**blockierender** Monatsabschluss-Screen:

1. Übersicht des abgelaufenen Monats („Juli ist vorbei. 29 Tage erfasst.") mit Kennzahlen-Vorschau.
2. **„Monat sichern"** erzeugt `lebenstracker-2026-07.json` — vollständige Tagesdetails *plus*
   Summary. Auf iOS über das Teilen-Menü, auf Android als Download.
3. **„Monat abschließen" ist bis zum erfolgten Export deaktiviert.** Erst danach: Summary nach
   `months[]`, `days` leeren, `currentMonth` hochsetzen. Ohne Export wird nichts gelöscht — harte
   Sperre, kein Hinweistext.
4. **„Archiv importieren"** liest eine Exportdatei zurück, zum Wiederherstellen oder zum reinen
   Ansehen alter Monatsdetails.

Langzeit-Trends speisen sich aus `months[]` plus den Tagen des laufenden Monats. Volldetails der
Vergangenheit liegen in den Exportdateien.

**iOS-Risiko und Gegenmaßnahmen.** iOS Safari kann `localStorage` löschen, wenn eine Web-App rund
7 Wochen nicht geöffnet wurde. Die App fragt beim ersten Start `navigator.storage.persist()` an und
zeigt ab 7 Tagen ohne Export eine Erinnerung im Heute-Screen. Das Onboarding benennt das Risiko
ausdrücklich: der monatliche Export ist Pflicht.

## 5. Rechenlogik

### 5.1 Energie und Makros (`lib/energy.js`)

Mifflin-St Jeor:
`BMR = 10·kg + 6,25·cm − 5·Alter + 5` (männlich), `… − 161` (weiblich).
`TDEE = BMR × Faktor(Tagestyp)`, Startfaktoren Ruhetag 1,35 · Gym 1,50 · Mannschaftstraining 1,65 ·
Spieltag 1,75, im Profil editierbar.

Recomp-Verteilung: Kalorien = TDEE + `kcalOffset`. Protein 2,0 g/kg, Fett 0,8 g/kg, Rest
Kohlenhydrate. **Kohlenhydrate werden um den Fußball periodisiert** — an Spiel- und Trainingstagen
höher, an Ruhetagen niedriger, bei konstanter Wochensumme. Das ist der Mechanismus, der Recomp
neben Fußball überhaupt tragfähig macht: die Energie liegt dort, wo die Leistung gebraucht wird.

Rückkopplung: Driftet der 7-Tage-Gewichtsschnitt über 2 Wochen um mehr als 0,5 kg in die falsche
Richtung, schlägt das Wochen-Review eine `kcalOffset`-Anpassung von ±150 kcal vor. **Die App ändert
nichts eigenmächtig** — Flocke bestätigt.

### 5.2 Bereitschaft (`lib/readiness.js`)

Eingang: Schlafdauer, Schlafqualität, Stimmung, Energie, Muskelkater, Stress. Gewichtete Summe zu
0–100. Ausgang ist nie eine nackte Zahl, sondern eine **Anweisung mit Begründung**:

| Bereitschaft | Anweisung | Signal |
|---|---|---|
| ≥ 75 | Volles Programm, Progression versuchen | Kreide (kein Signal) |
| 50–74 | Volumen reduziert: −1 Satz pro Übung, RPE-Deckel 8 | Sodium |
| < 50 | Nur Prophylaxe und Mobilität, oder Ruhetag | Alarm |

Zwei **harte Regeln** stehen über dem Score:

- Am Tag vor dem Spiel und am Spieltag selbst gibt die App **kein Beinvolumen** frei.
- Die schwere Bein-Einheit wird nur auf Tage mit mindestens 3 Tagen Abstand zum Spiel gelegt
  (`lib/planner.js`).

Begründung: Der Fehler, den Flocke vermeiden will (Beine platt am Spieltag), entsteht aus Volumen
und Platzierung — nicht aus Beintraining an sich. Beintraining ganz zu streichen wäre die riskantere
Option, weil exzentrische Hamstring-Arbeit der wirksamste bekannte Schutz gegen die häufigste
Fußballverletzung ist.

### 5.3 Volumen (`lib/volume.js`)

Sätze und Tonnage je Muskelgruppe pro Woche, abgeleitet aus dem Übungskatalog. Grundlage dafür, dass
das Review Muster wie „Schultervolumen 3 Wochen steigend bei fallender Bereitschaft → Deload"
überhaupt erkennen kann.

### 5.4 Review-Regelwerk (`lib/review.js`)

**Wochen-Review:** Einheiten geplant vs. erledigt · Kalorien- und Protein-Trefferquote ·
Gewichtstrend (7-Tage-Schnitt) · Schlafschnitt · Bereitschaftsschnitt · Volumen je Muskelgruppe mit
Vorwochenvergleich · gestiegene Arbeitsgewichte · Spieltags-RPE und Muskelkater danach.

Flags (Auswahl): Schlaf < 6,5 h im Schnitt · Protein < 85 % des Ziels · Volumen 3 Wochen steigend
bei fallender Bereitschaft · Gewicht driftet · Übung 3 Wochen ohne Progression · Muskelkater in
einer Region dauerhaft ≥ 4.

**Monats-Review:** dieselben Kennzahlen über den Monat, plus Zielabgleich, Trainingsblock-Bilanz
(Woche 1–3 Progression, Woche 4 Deload) und Vergleich zu den Vormonaten aus `months[]`.

Beide bieten **„Für Claude kopieren"**: alles als strukturierter Markdown-Block in der
Zwischenablage. Kein API-Key, kein Internetzwang in der App.

## 6. Design: „Flutlicht"

Die Welt des Themas ist ein Amateurplatz bei Flutlicht, abends. Die Entscheidungen kommen von dort,
nicht aus einem UI-Kit.

### 6.1 Farbe

```
--pitch-900   #0C120F   Seitenhintergrund (grünstichiges Schwarz, nie reines #000)
--pitch-800   #131C17   Kartenfläche
--pitch-700   #1B2620   erhöhte Fläche, Eingabefelder
--chalk-100   #EDF1EC   Primärtext, Datenmarken (Kalkmarkierung)
--chalk-500   #8A968D   Labels, Sekundärtext
--line-200    rgba(237,241,236,0.14)   Haarlinie = Spielfeldmarkierung
--sodium-500  #FF8A1F   Signalton: Warnung, aktueller Wert, Hervorhebung
--sodium-200  #FFC486   heller Schritt für Chart-Flächen
--alarm-600   #E23D2E   ausschließlich für „Ruhetag/Abbruch"
```

**Bewusste Abweichung von der Konvention: kein Ampelsystem.** „Alles gut" ist die *Abwesenheit* von
Farbe — reines Kreideweiß. Das Flutlicht geht nur an, wenn etwas Aufmerksamkeit braucht. Drei
Gründe: eine Leithue statt drei ist disziplinierter; eine Helligkeitsrampe funktioniert bei
Farbfehlsichtigkeit, eine Hue-Codierung nicht; und ein Grün-Gelb-Rot-Dashboard sieht aus wie aus
einem Baukasten. Jeder Status trägt **immer zusätzlich ein Wort** („Bereit" / „Volumen reduziert" /
„Ruhetag") — nie Farbe allein.

### 6.2 Typografie

**Barlow Condensed 600** für Zahlen und Überschriften: schmal, sportlich, in der Anmutung einer
Trikotnummer — und schmale Ziffern lassen große Werte auf ein Handydisplay passen.
**Inter 400/600** für Fließtext und Bedienelemente, weil es bei kleinen Größen auf dem Handy besser
lesbar ist. Beide als `woff2` im Repo (SIL OFL, `fonts/LICENSE`), damit die App vollständig offline
läuft und keine Google-Fonts-Abrufe macht.

Typenskala 12 / 14 / 16 / 20 / 28 / 44 / 64. Die 64 ist ausschließlich für den Bereitschafts-Wert
reserviert. Zahlen immer mit `font-variant-numeric: tabular-nums`.

### 6.3 Signature-Element: das Wochenband

Oben auf dem Heute-Screen ein 7-Tage-Streifen, gezeichnet mit Kreide-Haarlinien wie
Platzmarkierungen. Jeder Tag eine Zelle: Spieltag mit Mittelkreis-Bogen, Mannschaftstraining mit
Doppellinie, erledigte Gym-Einheiten gefüllt, offene leer.

Das Band ist gleichzeitig Navigation, Streak-Anzeige und Wochenüberblick — und es kodiert etwas
Wahres: **die Woche ist um den Spieltag herum gebaut, nicht um den Montag.** Es ersetzt ein
generisches Kalender-Widget.

### 6.4 Layout und Charts

Eine Spalte, Bottom-Tab-Bar mit 5 Reitern (Heute · Training · Essen · Trends · Review), alles im
Daumenbereich, Touch-Ziele ≥ 48 px. Der Held des Heute-Screens ist der Bereitschafts-Wert als große
Zahl mit dem Handlungssatz direkt darunter. Die App sagt, was heute zu tun ist, und begründet es.

Charts als handgeschriebenes Inline-SVG, keine Bibliothek. Regeln:

- **Keine Doppelachse, nie.** Zwei Messgrößen = zwei Charts als Small Multiples; auf einem
  Handydisplay ohnehin lesbarer als ein Kombi-Diagramm.
- Gewicht: Rohpunkte in Kreide (8 px) + 7-Tage-Gleitschnitt als 2-px-Linie in Sodium. Der
  Gleitschnitt ist der Punkt — Tagesgewicht ist Rauschen.
- Balken (Schlaf, Kalorien, Protein): 4 px gerundete Datenenden an der Grundlinie, 2 px Lücke
  zwischen Balken, Zielwert als Referenzlinie.
- Volumen: gestapelte Wochenbalken, 2 px Flächenabstand zwischen Segmenten.
- Eine Serie → kein Legendenkasten, der Titel benennt sie. Werte nur selektiv beschriftet, niemals
  an jedem Punkt. Achsen und Gitter zurückgenommen (`--line-200`).
- **Tippen statt Hover:** Antippen eines Punktes zeigt Datum und Wert, Trefferfläche größer als die
  Marke. Zu jedem Chart eine aufklappbare Tabellenansicht.
- Korrelations-Hinweise als Text unter den Charts, z. B. „An Tagen mit unter 6,5 h Schlaf lag deine
  Bereitschaft im Schnitt 22 Punkte niedriger."

Farbprüfung: `tools/check_contrast.py` (nur Standardbibliothek) rechnet WCAG-Kontrast und
OKLab-Abstände der Palette gegen `--pitch-900` und `--pitch-800`. Ersetzt den
Node-basierten Validator der dataviz-Richtlinie, der hier nicht lauffähig ist.

### 6.5 Bewusst zurückgestellt

**Light-Mode.** Die App ist dark-first, das ist die gewählte Identität; der Kontrast Kreide auf
Platz liegt bei etwa 14:1, damit ist sie bei voller Helligkeit auch draußen nach dem Training
lesbar. Ein echter Light-Mode wäre eine eigene, neu abgestimmte Farbrampe — Phase 9, nicht
heimlich weggelassen.

## 7. Trainingsplan

Reihenfolge wie von Flocke gewünscht: erst App, dann Plan im Gespräch. Die Struktur, die die App
tragen muss, steht fest — 3 Gym-Einheiten pro Woche:

- **A — Drücken, Schwerpunkt Schulter:** Schulterdrücken schwer · Schrägbank · Seitheben (hohes
  Volumen) · Trizeps zweifach
- **B — Ziehen + Bein-Slot:** Klimmzug/Rudern · Rear Delts · Bizeps · schwere Einbein-Arbeit oder
  Kniebeuge (3–4 Sätze, niedrige Wiederholungen) · Prophylaxeblock
- **C — Schulter/Arm-Spezial:** Seitheben-Volumen · Face Pulls · Trizeps · Bizeps · Traps ·
  Rotatorenarbeit

Rund 60 % des Volumens gehen bewusst auf Schultern und Arme. Rücken und Brust bleiben als Basis
drin, weil viel Drückvolumen ohne Zugarbeit zuverlässig zu Schulterproblemen führt.

Prophylaxeblock (~10 Min in Einheit B, optional an einem zweiten Tag): Nordic-Curl-Progression ·
Copenhagen Plank · Waden · Hüftstabilität.

Progression: Doppelprogression (erst Wiederholungen im Zielbereich, dann Gewicht), RPE 7–9, Woche 4
als Deload. Platzierung immer über `lib/planner.js` relativ zum eingestellten Spieltag.

Offene Eingaben für Phase 8: Alter, Größe, aktuelles Gewicht, Spieltag- und Trainingstag-Wochentag,
verfügbare Gym-Tage, aktuelle Arbeitsgewichte bei Schulterdrücken, Bankdrücken, Rudern, Klimmzug und
Kniebeuge.

## 8. Testen ohne npm

`tests.html` lädt die `js/lib/`-Module und führt sie gegen ein selbstgebautes `assert`-Harness aus,
Ergebnis als Pass/Fail-Liste im Browser. Tests werden **vor** der jeweiligen Implementierung
geschrieben.

| Modul | Was geprüft wird |
|---|---|
| `energy.js` | Mifflin-St Jeor gegen Handrechnung (m/w), TDEE je Tagestyp, Makrosummen ergeben die Kalorien, Kohlenhydrat-Periodisierung hält die Wochensumme konstant |
| `readiness.js` | Score-Grenzen, Spieltags-Regeln überschreiben den Score, fehlende Eingaben ergeben kein `NaN` |
| `aggregate.js` | Gleitschnitt bei Lücken, Wochen-/Monatsgrenzen, leere Monate |
| `volume.js` | Satz- und Tonnage-Summen je Muskelgruppe |
| `planner.js` | Bein-Einheit landet nie innerhalb von 3 Tagen vor dem Spiel |
| `review.js` | jedes Flag feuert bei konstruierten Daten und feuert nicht bei sauberen Daten |
| `store.js` | Rollover löscht nichts ohne Export; Schema-Migration von `v1` |

## 9. Phasen

| Phase | Inhalt |
|---|---|
| 0 | Repo, Spec, SSH-Key, GitHub, Pages |
| 1 | Tokens, Schriften, App-Shell, Store, PWA, Onboarding-Profil, `energy.js` |
| 2 | Heute-Screen: Wochenband, Check-in, Gewicht, `readiness.js` |
| 3 | Ernährung: Zielwerte, Ist-Eingabe, Fortschritt |
| 4 | Training: Katalog, `planner.js`, `volume.js`, Satz-Logger |
| 5 | Trends: `aggregate.js`, `chart.js`, fünf Charts |
| 6 | Reviews: `review.js`, Wochen- und Monats-Screen, Copy-Block |
| 7 | Archiv und Offline: Rollover mit Export-Sperre, Import, PWA-Test |
| 8 | Trainingsplan im Gespräch bauen und einpflegen |
| 9 | Zurückgestellt: Light-Mode, Apple-Health, mehr als 3 Gym-Tage |

Jede Phase endet mit einem eigenen Commit. Ab Phase 0 ist die App über GitHub Pages erreichbar,
Flocke kann jeden Zwischenstand direkt auf dem Handy ansehen.
