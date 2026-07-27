# Lebenstracker-Flocke

Persönlicher Trainings-, Gewichts- und Ernährungstracker als installierbare Web-App (PWA).
Gebaut für einen Amateurfußballer, der parallel Krafttraining macht: die App fragt morgens nach
Schlaf und Befinden, rechnet daraus einen Bereitschafts-Wert und **sagt, was heute zu tun ist** —
statt nur Zahlen zu sammeln.

## Was drin ist

| Bereich | Funktion |
|---|---|
| **Heute** | Wochenband um den Spieltag, täglicher Check-in, Gewicht, Bereitschafts-Wert mit begründeter Trainingsanweisung |
| **Training** | Trainingsplan, Satz-Logger mit „letztes Mal"-Anzeige, automatische Volumenreduktion bei niedriger Bereitschaft |
| **Essen** | Ziel-Makros nach Mifflin-St Jeor, Kohlenhydrate um Spiel- und Trainingstage periodisiert, Ist-Werte pro Tag |
| **Trends** | Gewicht mit 7-Tage-Gleitschnitt, Schlaf, Bereitschaft, Trainingsvolumen je Muskelgruppe, Makro-Trefferquote |
| **Review** | Wochen- und Monats-Review, regelbasiert, plus „Für Claude kopieren" für das ausführliche Gespräch |
| **Profil** ⚙ | Kalorienziel, Defizit-Ausnahmetage, Makros pro Kilo, Spiel- und Trainingstage, Aktivitätsfaktoren |
| **Archiv** ↓ | Sicherung erzeugen und zurückspielen, Monatsabschluss, Liste der abgeschlossenen Monate |

### Die zwei Regeln, um die herum alles gebaut ist

**Beinvolumen richtet sich nach dem Spielrhythmus, nicht nach der Laune.** Vor dem Spiel zählt
Frische (mindestens 3 Tage Abstand), nach dem Spiel die eigene Erholung (mindestens 2 Tage) — zwei
getrennte Schwellen, weil es zwei verschiedene Dinge sind. Am Spieltag und am Tag davor gibt die App
gar kein Beinvolumen frei, unabhängig vom Bereitschafts-Wert. Die Bereitschaft kann die Stufe nur
senken, nie anheben.

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
Volumenberechnung, Einheiten-Platzierung, Review-Regelwerk und der Monats-Rollover.

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
data/                 Übungskatalog und Trainingsplan
tools/                check_contrast.py — prüft die Farbpalette
docs/superpowers/specs/  Design-Dokument
```

## Design

Richtung **„Flutlicht"**: entsättigtes Platz-Grünschwarz, kreideweiße Haarlinien wie
Spielfeldmarkierungen, ein einziger Signalton (das Orange alter Flutlichtmasten). Kein
Ampelsystem — „alles gut" ist die Abwesenheit von Farbe. Jeder Status trägt immer zusätzlich ein
Wort, nie Farbe allein. Details in `docs/superpowers/specs/`.

## Lizenz

Code: MIT (`LICENSE`). Schriften: Barlow Condensed und Inter unter SIL Open Font License
(`fonts/LICENSE`).
