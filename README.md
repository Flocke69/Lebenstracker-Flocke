# Lebenstracker-Flocke

Persönlicher Trainings-, Gewichts- und Ernährungstracker als installierbare Web-App (PWA).
Gebaut für einen Amateurfußballer, der parallel Krafttraining macht: die App fragt morgens vier
Fragen, zeigt als Grafik, wie viel heute geht, und **sagt, was zu tun ist** — statt nur Zahlen zu
sammeln.

## Was drin ist

| Bereich | Funktion |
|---|---|
| **Heute** | Antippbares Wochenband (Tage durchblättern), Check-in als Fenster, „Training starten", Verschieben mit Empfehlung, Gewicht mit Wochenstreifen, sonntags die Erinnerung an den Yazio-Wochenschnitt und am Monatsende die zum Review |
| **Training** | Alle drei Einheiten auf einem Screen, Logger im Fenster mit laufender Trainingsuhr und 3-Minuten-Satzpause, „letztes Mal" an jeder Übung |
| **Essen** | Zwei Abschnitte: *Essen und Makros* (Yazio-Wochenschnitt gegen das Wochenziel, Urteil, Tagesziel) und *Gewicht* (Woche und Gesamtverlauf) |
| **Trends** | Drei Abschnitte: *Training*, *Essen*, *Gewicht*. Eine Farbe je Messgröße, ein Satz Befund pro Chart |
| **Review** | Oben das Urteil in einem Wort („Passt" / „Nachjustieren" / „Läuft schief"), darunter vier Fenster mit Grafik und eigenem Urteil: *Gewicht*, *Essen*, *Training*, *Erholung*. Im Monat dazu: **Monatsdatei-Export** und „Monat abhaken" |
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

**Das Review urteilt selbst — außer die Daten tragen es nicht.** Hier standen einmal zehn Fragen
fürs Monatsgespräch. Sie sind raus: ein Review, das erst durch zehn Freitextfelder am Monatsende
entsteht, findet nicht statt. Stattdessen fasst `overallVerdict` zusammen, was ohnehin schon
geurteilt wird — Befunde, Volumen, Fortschritt. Unter 50 % erfassten Tagen sagt die App
ausdrücklich **nichts**: ein grünes „Passt" über acht Tagen wäre eine Lüge, die sich gut anfühlt.

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
der Yazio-Wochenschnitt, das Review-Regelwerk samt Monats-Datensatz und der Monats-Rollover — und
seit dem Umbau auf „Flutlicht Glas" auch die Bewegung: dass die Feder ankommt und bei Dämpfung 1
nicht überschwingt, dass die Impulsprojektion linear ist und die Richtung behält, dass das Gummiband
gegen eine Grenze läuft statt ins Unendliche, und dass die Zeigergeschwindigkeit alte Punkte
ignoriert.

## Auf dem Handy installieren

**iPhone (Safari):** Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm".
**Android (Chrome):** Seite öffnen → Menü → „App installieren".

## Erinnerungen einrichten

Die App kann **keine** Benachrichtigungen aufs Display schicken. Sie hat keinen
Server, und ohne Server kann sich eine Webseite nicht zu einer Uhrzeit selbst
wecken — die einzige Browser-Schnittstelle, die das je konnte, hat Apple nie
ausgeliefert. Was die App tut: sobald du sie öffnest, steht der fällige Hinweis
ganz oben auf dem Heute-Screen, farbig und mit einem Knopf, der genau dorthin
führt, wo die Eingabe passiert.

Für den echten Stups aufs Display: zwei Erinnerungen in der iPhone-App
**Erinnerungen**, einmal angelegt, laufen für immer.

**1. Wochenschnitt — jeden Sonntag um 20 Uhr**

1. App *Erinnerungen* öffnen → **+ Neue Erinnerung**
2. Titel: `Yazio-Wochenschnitt in den Lebenstracker`
3. Auf das **ⓘ** rechts tippen
4. **Datum** an → nächsten Sonntag wählen
5. **Uhrzeit** an → `20:00`
6. **Wiederholen** → **Jede Woche**
7. Oben rechts **Fertig**

**2. Monats-Review — am Monatsletzten**

Gleicher Weg, Titel `Monats-Review im Lebenstracker ansehen`, Datum auf den
letzten Tag des Monats, Uhrzeit `20:00`, **Wiederholen → Monatlich**.

> Der Monatsletzte ist nicht immer der 31. Wer es genau haben will, nimmt
> **Wiederholen → Eigene → Monatlich → Letzter Tag**.

## Aufbau

```
index.html            App-Shell und Tab-Bar
tests.html            Test-Runner
sw.js                 Service Worker (Offline-Cache)
css/                  tokens.css · base.css · components.css
js/lib/               reine Rechenlogik, DOM-frei, getestet
  motion.js           Feder, Impulsprojektion, Gummiband — die drei Formeln
js/views/             Rendering pro Screen
  motion.js           Feder und Zeigerverfolgung (braucht Bildtakt und Zeiger)
  theme.js            hell oder dunkel, gemerkt
  sheet.js            Overlay-Fenster (liegt außerhalb von #app)
  clock.js            ein Sekundentakt für Trainingsuhr und Satzpause
  gauge.js            Statusgrafik, die die Punktzahl ersetzt
  review.js           Urteil oben, vier Themenfenster darunter
data/                 Übungskatalog und Trainingsplan
tools/                serve.py — Entwicklungsserver · check_contrast.py — Farbpalette
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

Entschieden wird beim Loslassen nach der **projizierten** Endposition, nicht nach der gemessenen:
ein kurzer schneller Wisch nach unten schließt deshalb auch dann, wenn er nur 30 px weit ging. Und
die Fingergeschwindigkeit wird an die Feder übergeben, statt verworfen zu werden — sonst gäbe es
genau dort eine sichtbare Naht zwischen Ziehen und Animieren.

**Position und Ruhelage sind zwei Paar Schuhe.** Früher trug die Einblend-Animation bewusst nur
14 px, damit ein ausgefallener Lauf das Fenster nicht unsichtbar unterhalb des Bildschirms
stehen lässt. Jetzt trägt die Feder die volle Höhe — dafür sitzt in `sheet.js` eine Reißleine:
läuft sie nach 700 ms immer noch nicht, wird das Fenster hart an seinen Platz gesetzt. Die Ruhelage
ist immer die sichtbare.

**Gleitende Kapseln leben im Modul, nicht in der Ansicht.** Tab-Bar und Wochenband markieren ihre
Auswahl mit einem einzelnen Element, das mit einer Feder wandert. Die Feder steht im Modulkopf von
`js/app.js` beziehungsweise `js/views/today.js`: entstünde sie beim Zeichnen, wäre sie nach jedem
Tastendruck wieder am Anfang. Bewegt wird nur bei einem echten Wechsel — beim bloßen Neuzeichnen
wird ohne Bewegung gesetzt.

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

Richtung **„Flutlicht Glas"**: der Platz bleibt dunkel — grünstichiges Schwarz, kreideweiße
Haarlinien wie Spielfeldmarkierungen. Darüber liegt ein volles Farbsystem: drei Statusfarben
(gut / geht so / schlecht) und sechs kategoriale Datenfarben, je eine pro Messgröße. Gewicht ist
überall blau, Schlaf überall violett.

Das ist eine bewusste Kehrtwende gegenüber dem ersten Entwurf, der auf die *Abwesenheit* von Farbe
gesetzt hat. Der Grund ist Flockes Vorgabe: man soll direkt erkennen, wenn etwas gut oder schlecht
läuft — und die Abwesenheit von Farbe ist kein Signal, das man aus dem Augenwinkel liest.

Was geblieben ist: **jeder Status trägt immer zusätzlich ein Wort.** Farbe beschleunigt das
Erkennen, sie trägt die Information nicht allein. Und Schwellen in Charts bleiben Referenzlinien,
keine Farbwechsel der Marke — Position funktioniert bei jeder Farbfehlsichtigkeit.

### Material

Kopfzeile, Tab-Bar und Fenster **schweben** über dem Inhalt, statt ihm einen Streifen wegzunehmen:
durchscheinendes Glas mit Unschärfe, unter dem der Inhalt hindurchläuft. Die Glasfläche der
Kopfzeile ist zunächst unsichtbar und wird eingeblendet, sobald etwas darunter liegt — eine Kante,
die entsteht, statt einer Trennlinie, die immer da ist.

Dafür ist die App eine **feste Hülle mit eigenem Scrollbehälter** (`.app` / `.viewport`). Gescrollt
wird nicht mehr das Dokument; `js/app.js` merkt sich beim Neuzeichnen deshalb `.viewport.scrollTop`
und nicht `window.scrollY`.

**Glas trägt nur die Leisten, nicht jede Karte.** Karten bekommen die durchscheinende Fläche und
die Lichtkante oben, aber keine Unschärfe: auf dem Trends-Screen stehen ein Dutzend Karten
übereinander, und ein Dutzend Unschärfeflächen kosten auf dem iPhone sichtbar Bilder pro Sekunde.
Über dem festen Verlauf im Hintergrund sieht man den Unterschied nicht.

### Bewegung

Was der Finger anfassen kann, läuft über eine **Feder** (`js/lib/motion.js`, `js/views/motion.js`),
nicht über eine CSS-Transition. Der Unterschied ist nicht Geschmack: eine Transition rechnet stur
zum Ziel und beginnt nach einem Abbruch wieder mit Geschwindigkeit null — das ist die Mauer, gegen
die man beim Umkehren einer Bewegung läuft. Eine Feder hat einen Zielwert plus Ort *und*
Geschwindigkeit; ein neues Ziel ändert nur den Zielwert.

Zwei Regler statt drei, wie in Apples Werkzeugkasten: **Dämpfung** (1,0 = kein Überschwingen) und
**Antwortzeit** in Sekunden — keine Dauer, die gibt es bei einer Feder nicht. Nachwippen bekommt
nur, was aus einer Geste mit Schwung kommt.

Daran hängen: das Fenster (1:1 am Finger, Gummiband nach oben, beim Loslassen entscheidet die
**projizierte** Endposition und nicht die gemessene), die gleitenden Kapseln in Tab-Bar und
Wochenband, und der Füllstand des Bereitschaftsbogens.

Die drei Formeln dahinter sind DOM-frei und getestet (`tests/motion.test.js`) — an ihnen entscheidet
sich das ganze Gefühl der App, und Formeln prüft man mit Zahlen, nicht mit dem Auge.

### Hell und dunkel

Die App kann beides. Voreinstellung ist das, was das Gerät sagt; der Knopf oben links überstimmt
das dauerhaft (eigener `localStorage`-Schlüssel, gehört nicht in den Monatsexport). Die helle
Palette ist **kein invertiertes Dunkel**, sondern ein eigener Satz Werte: ein Grün mit 12:1 auf
Schwarz hat auf Weiß 1,6:1.

Die Palette ist nachgerechnet, nicht geschätzt: `python3 tools/check_contrast.py` prüft **beide
Paletten** auf WCAG-Kontrast und den OKLab-Abstand aller Paare, die nebeneinander Bedeutung tragen —
auch simuliert für Protanopie, Deuteranopie und Tritanopie. Jede Änderung an den Farbwerten
erfordert einen erneuten Durchlauf. Details in `docs/superpowers/specs/`.

Dazu beachtet die App drei unabhängige Signale: `prefers-reduced-motion` (Federn springen auf den
Zielwert), `prefers-reduced-transparency` (Glas wird milchig statt durchsichtig) und
`prefers-contrast` (nahezu deckende Flächen mit definierter Kante).

## Lizenz

Code: MIT (`LICENSE`). Schriften: Barlow Condensed und Inter unter SIL Open Font License
(`fonts/LICENSE`).
