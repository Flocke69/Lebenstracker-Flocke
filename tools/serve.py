#!/usr/bin/env python3
"""Entwicklungsserver.

`python3 -m http.server` liefert Dateien mit Last-Modified aus, und der
Browser hält ES-Module dann pro Adresse fest. Beim Entwickeln heißt das: nach
einer Änderung läuft weiterhin die alte Fassung, und die Testergebnisse ändern
sich nicht. Ein Zeitstempel an der Import-Adresse hilft nur der obersten
Datei — relative Importe darin erben die Kennung nicht.

Dieser Server schickt deshalb `Cache-Control: no-store` und beantwortet keine
bedingten Anfragen. Damit wird jede Datei bei jedem Abruf frisch geladen.

    python3 tools/serve.py            # 127.0.0.1:8080
    python3 tools/serve.py 8081       # anderer Port

Nur fürs Entwickeln gedacht. Ausgeliefert wird die App über GitHub Pages.
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PORT = 8080


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Liefert aus dem Projektverzeichnis und unterbindet jedes Zwischenspeichern."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        """`/v/<beliebig>/pfad` auf `pfad` abbilden.

        Manche Browser halten ES-Module prozessweit fest und ignorieren dabei
        `Cache-Control: no-store`. Eine Kennung an der Adresse hilft nicht,
        weil relative Importe sie nicht erben: `../js/lib/state.js` gegen
        `/tests/x.test.js?t=1` ergibt wieder die Adresse ohne Kennung.

        Ein PFAD-Präfix wird dagegen mitgeführt. `/v/1234/tests/x.test.js`
        importiert `/v/1234/js/lib/state.js` — beide Adressen sind neu, beide
        Module werden frisch geladen. Der Server schneidet das Präfix hier
        wieder ab.
        """
        if path.startswith("/v/"):
            rest = path[3:]
            slash = rest.find("/")
            path = rest[slash:] if slash != -1 else "/"
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Ohne Last-Modified stellt der Browser keine bedingte Anfrage und
        # bekommt nie ein 304 zurück.
        if keyword == "Last-Modified":
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        # Nur Fehler melden — sonst rauscht jeder Abruf durchs Terminal.
        status = args[1] if len(args) > 1 else ""
        if str(status).startswith(("4", "5")):
            sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    server = ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    print(f"Lebenstracker — Entwicklungsserver ohne Cache")
    print(f"  Verzeichnis: {ROOT}")
    print(f"  App:         http://127.0.0.1:{port}/")
    print(f"  Tests:       http://127.0.0.1:{port}/tests.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbeendet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
