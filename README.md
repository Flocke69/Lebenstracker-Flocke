# Lebenstracker-Flocke

Persönlicher Trainings-, Gewichts- und Ernährungstracker als installierbare Web-App (PWA).
Gebaut für einen Amateurfußballer, der parallel Krafttraining macht: die App fragt morgens vier
Fragen, zeigt als Grafik, wie viel heute geht, und **sagt, was zu tun ist** — statt nur Zahlen zu
sammeln.

## Was drin ist

| Bereich | Funktion |
|---|---|
| **Heute** | Antippbares Wochenband (Tage durchblättern), Check-in als Fenster, „Training starten", Verschieben mit Empfehlung, Gewicht mit Wochenstreifen, am Monatsende die Aufforderung zum Review |
| **Training** | Alle drei Einheiten auf einem Screen, Logger im Fenster mit laufender Trainingsuhr und 3-Minuten-Satzpause, „letztes Mal" an jeder Übung |
| **Essen** | Zwei Abschnitte: *Essen und Makros* (Yazio-Wochenschnitt gegen das Wochenziel, Urteil, Tagesziel) und *Gewicht* (Woche und Gesamtverlauf) |
| **Trends** | Drei Abschnitte: *Training*, *Essen*, *Gewicht*. Eine Farbe je Messgröße, ein Satz Befund pro Chart |
| **Review** | Befunde als farbige Stichpunkte, die wichtigsten Zahlen, ein Urteil für Volumen und Fortschritt. Im Monat dazu: zehn Fragen, Rückmeldung, **Monatsdatei-Export** und Rückimport |
| **Profil** ⚙ | Kalorienziel, Defizit-Ausnahmetage, Makros pro Kilo, Spiel- und Trainingstage, Aktivitätsfaktoren, Zurücksetzen |
| **Archiv** ↓ | Sicherung erzeugen und zurückspielen, Monatsabschluss, Liste der abgeschlossenen Monate |

### Die Regeln, um die herum alles gebaut ist

**Kein Bereitschafts-Wert für den Benutzer.** Der Check-in fragt vier Dinge — Schlaf, Energie,
Muskelkater, Stress — und antwortet mit einer Grafik und einem Wort: „Alles gut", „Geht so",
„Schlecht". Intern gibt es weiter einen Score, weil Trends, Reviews und das Monatsarchiv eine
vergleichbare Zahl brauchen. Auf dem Screen steht er nicht: „68 von 100" beantwortet keine Frage,
die man morgens hat.

**Beinvolumen richtet sich nach dem Spielrhythmus, nicht nach der Laune.** Vor dem Spiel zählt
Frische (mindestens 3 Tage Abstand), nach dem Spiel die eigene Erholung (mindestens 2 Tage) — zwei
getrennte Schwellen, weil es zwei verschiedene Dinge sind. Am Spieltag und am Tag davor gibt die App
gar kein Beinvolumen frei, unabhängig von der Bereitschaft. Die Bereitschaft kann die Stufe nur
senken, nie anheben.

**Eine Verschiebung ist eine Ausnahme, keine Planänderung.** Wer montags nicht kann, verschiebt die
Einheit für diese Woche; die App empfiehlt den Tag, der am wenigsten kostet, und nennt den Grund.
Nächste Woche steht Push wieder auf Montag. Beim Verschieben trennt die App nach Einheit: am Tag vor
dem Spiel ist Beinarbeit gesperrt, Drücken und Ziehen sind erlaubt — nur teuer.

**Der Plan gehört Flocke, nicht der App.** Die Satzzahlen im Trainingsplan sind eine Vorgabe. Wenn
die Bereitschaft niedrig ist, schlägt die App weniger Sätze vor — sichtbar, an der Übung, als
Hinweis. Sie kürzt den Plan nicht. Eine App, die aus 3 Sätzen stillschweigend 1 macht, nimmt dir die
Entscheidung ab und verhindert außerdem, dass du den dritten loggen kannst, wenn er doch geht.

**Erst treffen, dann anpassen.** Am Kalorienziel wird nur gedreht, wenn der Wochenschnitt aus Yazio
das Ziel tatsächlich getroffen hat und das Gewicht trotzdem wegläuft. Sonst würde die App eine Zahl
korrigieren, die nie erreicht wurde — und sich selbst jagen.

**Die App blickt nicht weiter zurück als ihre Daten.** Der früheste Monat mit Tagen, einer
Monats-Summary oder einem Review ist die Untergrenze (`firstTrackedMonth` in `js/lib/state.js`).
Davor blättert das Review nicht, verlangt die App kein Monats-Review und listet die Wochentabelle
keine Wochen. Die Grenze wird **abgeleitet, nicht eingestellt**: wer einen Monat löscht, verschiebt
sie mit, und wer alte Daten einspielt, holt sie sich zurück. Eine leere Auswertung aus einer Zeit
ohne Daten liest sich wie ein Fehler, nicht wie eine Lücke.

**Ohne Sicherung wird nichts gelöscht.** „Monat abschließen" ist so lange gesperrt, bis die
Exportdatei tatsächlich erzeugt wurde. Das ist eine Bedingung im Code, kein Hinweistext.

## Datenhaltung

- Innerhalb eines Monats wird **jeder Tag einzeln** im `localStorage` gespeichert.
- Am Monatsende: Export als JSON-Datei (vollständige Tagesdetails + verdichtete Monats-Summary),
  danach wird der Monat zu **einem** Datensatz verdichtet und die Tage werden geleert.
- **„Monat abschließen" ist gesperrt, bis der Export tatsächlich erzeugt wurde.** Es kann kein
  Monat verloren gehen.
- Monats-Summaries bleiben dauerhaft in der App und tragen die Langzeit-Trends.

### Privatsphäre

Keine Server, keine Accounts, keine Analytics, keine Netzwerkaufrufe zur Laufzeit. Die Daten
verlassen das Gerät nur, wenn du selbst eine Exportdatei erzeugst. In diesem Repository liegt
ausschließlich Anwendungscode — **niemals Gesundheitsdaten** (siehe `.gitignore`).

> ⚠️ **iPhone-Hinweis:** iOS Safari löscht die Daten von Web-Apps, die rund 7 Wochen nicht geöffnet
> wurden. Die App fragt Speicher-Persistenz an und erinnert nach 7 Tagen ohne Export. Trotzdem gilt:
> **der monatliche Export ist Pflicht, nicht Komfort.**

## Lokal starten

Kein Build, keine Dependencies, kein `npm` — nur ein statischer Server, weil Service Worker und
ES-Module `file://` nicht mögen:

```bash
python3 tools/serve.py
```

Dann `http://127.0.0.1:8080` öffnen.

> **Nicht `python3 -m http.server` benutzen.** Browser halten ES-Module fest und ignorieren dabei
> `Cache-Control: no-store`. Eine Kennung an der Adresse hilft nicht, weil relative Importe sie
> nicht erben — die geänderte Datei wäre frisch, die von ihr importierten nicht. `tools/serve.py`
> bildet deshalb `/v/<zahl>/pfad` auf `pfad` ab: ein **Pfad**-Präfix wird bei relativer Auflösung
> mitgeführt. Zeigt der Browser trotzdem eine alte Fassung, `http://127.0.0.1:8080/v/2/index.html`
> aufrufen und die Zahl hochzählen.
>
> Der Service Worker wird auf `localhost` und `127.0.0.1` bewusst nicht registriert — er liefert
> zuerst aus dem Cache und würde beim Entwickeln dasselbe Problem erzeugen.

## Tests

Die Rechenlogik in `js/lib/` ist DOM-frei und damit testbar. Der Test-Runner läuft im Browser:

```
http://localhost:8080/tests.html
```

Getestet werden Mifflin-St Jeor und Makro-Verteilung, Bereitschafts-Score, Spieltags-Regeln,
Volumenberechnung und der Trainingsplan gegen Flockes Vorgabe, das Verschieben von Trainingstagen,
der Yazio-Wochenschnitt, das Review-Regelwerk samt Monats-Datensatz und der Monats-Rollover.

## Auf dem Handy installieren

**iPhone (Safari):** Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm".
**Android (Chrome):** Seite öffnen → Menü → „App installieren".

## Aufbau

```
index.html            App-Shell und Tab-Bar
tests.html            Test-Runner
sw.js                 Service Worker (Offline-Cache)
css/                  tokens.css · base.css · components.css
js/lib/               reine Rechenlogik, DOM-frei, getestet
js/views/             Rendering pro Screen
  sheet.js            Overlay-Fenster (liegt außerhalb von #app)
  clock.js            ein Sekundentakt für Trainingsuhr und Satzpause
  gauge.js            Statusgrafik, die die Punktzahl ersetzt
data/                 Übungskatalog und Trainingsplan
tools/                check_contrast.py — prüft die Farbpalette
docs/superpowers/specs/  Design-Dokument
```

### Zwei Dinge, die beim Weiterbauen wichtig sind

**Die Overlay-Fenster liegen außerhalb von `#app`.** Die App zeichnet bei jeder Zustandsänderung
ihre Ansicht komplett neu. Läge ein Fenster in diesem Baum, würde die erste Eingabe darin es
zerstören. `js/views/sheet.js` hängt es deshalb an `document.body` und zeichnet nur seinen eigenen
Körper neu — inklusive Scrollposition, sonst springt der Check-in nach jeder Antwort nach oben.

**Das `<dialog>` trägt nichts als die Fläche.** Es ist durchsichtig, füllt den Bildschirm und
schiebt sein Kind nach unten; alles Sichtbare steckt in `.sheet__panel`. Der Grund ist iOS: der
Browser gibt einem Dialog eigene Maße (`width: fit-content`, `margin: auto`, ein eigenes
`max-height`), und wer die überschreibt, gewinnt auf einem Gerät und verliert auf dem anderen.
Dazu gehört die Zeile `.sheet:not([open]) { display: none }` — Autoren-CSS schlägt die Browserregel,
und ohne sie wäre ein geschlossener Dialog sichtbar.

**Der Griffbalken zieht wirklich.** Nach unten schließt, nach oben geht auf ganze Höhe, Antippen
schaltet um. Bewegung und Loslassen hängen am `window`, nicht am Griff: `setPointerCapture` kann
werfen, und ohne Capture verliert der Zug seinen Empfänger, sobald der Finger den Griff verlässt —
was er beim Ziehen sofort tut. Das Fenster steht ohnehin auf 88 % Höhe, der Griff ist ein Angebot
und keine Voraussetzung.

**Trainingsuhr und Satzpause zeichnen nicht neu.** Sie schreiben über `js/views/clock.js` direkt in
einen Textknoten. Einmal pro Sekunde die Ansicht neu zu zeichnen würde im Trainingsfenster die
Tastatur wegwerfen und den Fokus verlieren. Die Ticker melden sich selbst ab, sobald ihr Knoten
nicht mehr im Dokument hängt.

**Bestätigungen kommen aus dem Zustand, nicht aus einem Slot.** Wer nach `store.update(…)` eine
Meldung in ein Element schreibt, schreibt in ein Element, das es nicht mehr gibt — das Neuzeichnen
war schneller. Der Dateiexport zeigt seinen Erfolg deshalb über `lastExportAt` an („Zuletzt
exportiert am …"). Der transiente Slot bleibt für das, was KEIN Neuzeichnen auslöst: Abbruch und
Fehler.

**Aufklappbare Abschnitte brauchen eine Kennung.** `panel({ keep: '…' })` — `js/app.js` merkt sich
anhand dieser Kennung, welche Abschnitte offen waren. Ohne sie klappt ein Abschnitt bei jeder
Eingabe zu, mit einer pauschalen „alle wieder öffnen"-Regel gehen dagegen alle auf.

## Design

Richtung **„Flutlicht bei Nacht"**: der Platz bleibt dunkel — grünstichiges Schwarz, kreideweiße
Haarlinien wie Spielfeldmarkierungen. Darüber liegt ein volles Farbsystem: drei Statusfarben
(gut / geht so / schlecht) und sechs kategoriale Datenfarben, je eine pro Messgröße. Gewicht ist
überall blau, Schlaf überall violett.

Das ist eine bewusste Kehrtwende gegenüber dem ersten Entwurf, der auf die *Abwesenheit* von Farbe
gesetzt hat. Der Grund ist Flockes Vorgabe: man soll direkt erkennen, wenn etwas gut oder schlecht
läuft — und die Abwesenheit von Farbe ist kein Signal, das man aus dem Augenwinkel liest.

Was geblieben ist: **jeder Status trägt immer zusätzlich ein Wort.** Farbe beschleunigt das
Erkennen, sie trägt die Information nicht allein. Und Schwellen in Charts bleiben Referenzlinien,
keine Farbwechsel der Marke — Position funktioniert bei jeder Farbfehlsichtigkeit.

Die Palette ist nachgerechnet, nicht geschätzt: `python3 tools/check_contrast.py` prüft WCAG-Kontrast
und den OKLab-Abstand aller Paare, die nebeneinander Bedeutung tragen — auch simuliert für
Protanopie, Deuteranopie und Tritanopie. Jede Änderung an den Farbwerten erfordert einen erneuten
Durchlauf. Details in `docs/superpowers/specs/`.

## Lizenz

Code: MIT (`LICENSE`). Schriften: Barlow Condensed und Inter unter SIL Open Font License
(`fonts/LICENSE`).
