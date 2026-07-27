#!/usr/bin/env python3
"""Erzeugt die App-Icons.

Auf diesem Rechner ist kein Bildwerkzeug installiert (kein ImageMagick, kein
Pillow), deshalb wird das PNG hier von Hand geschrieben — nur zlib und struct
aus der Standardbibliothek.

Motiv: ein Spielfeld bei Flutlicht. Kreideweiße Außenlinie, Mittellinie und
Mittelkreis, und als einziger Farbakzent der Anstoßpunkt im Natriumdampf-Orange.
Dasselbe Motiv wie das Wochenband in der App.

Kanten werden analytisch geglättet: für jedes Element gibt es eine
Abstandsfunktion, und die Deckung eines Pixels ergibt sich aus dem Abstand zur
Kante. Das ist schneller und schärfer als Vervielfachen und Verkleinern.

Aufruf: python3 tools/make_icons.py
"""

import math
import os
import struct
import sys
import zlib

# Aus css/tokens.css — bei Änderungen dort hier mitziehen.
PITCH_900 = (0x0C, 0x12, 0x0F)
CHALK_100 = (0xED, 0xF1, 0xEC)
SODIUM_500 = (0xFF, 0x8A, 0x1F)

OUT_DIR = "icons"
SIZES = {
    "icon-192.png": 192,
    "icon-512.png": 512,
    "apple-touch-icon-180.png": 180,
    "favicon-32.png": 32,
}


# ─── PNG schreiben ───────────────────────────────────────────────────────────

def write_png(path, width, height, rgb_rows):
    """Minimales PNG, Farbtyp 2 (Truecolor RGB), 8 Bit."""
    raw = bytearray()
    for row in rgb_rows:
        raw.append(0)          # Filtertyp 0 = None
        raw.extend(row)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)
    return len(png)


# ─── Abstandsfunktionen, in Pixeln ───────────────────────────────────────────

def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def sd_rounded_rect(px, py, cx, cy, half_w, half_h, radius):
    qx = abs(px - cx) - (half_w - radius)
    qy = abs(py - cy) - (half_h - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def sd_box(px, py, cx, cy, half_w, half_h):
    qx = abs(px - cx) - half_w
    qy = abs(py - cy) - half_h
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0)


def sd_segment_h(px, py, x0, x1, y, half_thick):
    """Waagerechtes Segment von x0 bis x1 auf Höhe y, als Box."""
    return sd_box(px, py, (x0 + x1) / 2, y, (x1 - x0) / 2, half_thick)


def outline(sd, half_stroke):
    """Aus einer gefüllten Form eine Kontur machen."""
    return abs(sd) - half_stroke


def coverage(sd):
    """Deckung 0–1 aus dem Abstand zur Kante. 0 = Kante genau am Pixelrand."""
    return min(max(0.5 - sd, 0.0), 1.0)


def blend(base, layer, alpha):
    if alpha <= 0.0:
        return base
    if alpha >= 1.0:
        return layer
    return tuple(round(b + (l - b) * alpha) for b, l in zip(base, layer))


# ─── Motiv ───────────────────────────────────────────────────────────────────

"""Unterhalb dieser Kantenlänge wird das Motiv reduziert.

Bei 32 px verschmiert die Außenlinie zu einem grauen Schleier und der
Mittelkreis wird zum Fleck. Dort bleiben nur Mittellinie, Kreis und
Anstoßpunkt übrig, dafür deutlich kräftiger — ein Favicon muss auf einen
Blick erkennbar sein, nicht vollständig.
"""
SIMPLIFY_BELOW = 64


def render(size):
    s = float(size)
    detailed = size >= SIMPLIFY_BELOW
    cx = cy = s / 2

    if detailed:
        inset = s * 0.135
        half_w = half_h = s / 2 - inset
        corner = s * 0.045
        stroke = max(s * 0.026, 1.0)
        circle_r = s * 0.15
        spot_r = max(s * 0.038, 1.0)
    else:
        half_w = half_h = None            # kein Rahmen
        corner = None
        stroke = max(s * 0.075, 2.0)
        circle_r = s * 0.28
        spot_r = max(s * 0.10, 2.0)

    half_stroke = stroke / 2
    line_half = half_w if detailed else s / 2 - stroke
    line_x0, line_x1 = cx - line_half, cx + line_half

    # Die Außenlinie ist bewusst gedämpft, sonst erdrückt sie den Mittelkreis.
    chalk_soft = blend(PITCH_900, CHALK_100, 0.62)

    rows = []
    for y in range(size):
        py = y + 0.5
        row = bytearray()
        for x in range(size):
            px = x + 0.5
            c = PITCH_900

            if detailed:
                sd_border = outline(
                    sd_rounded_rect(px, py, cx, cy, half_w, half_h, corner),
                    half_stroke,
                )
                c = blend(c, chalk_soft, coverage(sd_border))

            sd_mid = sd_segment_h(px, py, line_x0, line_x1, cy, half_stroke)
            c = blend(c, CHALK_100, coverage(sd_mid))

            sd_ring = outline(sd_circle(px, py, cx, cy, circle_r), half_stroke)
            c = blend(c, CHALK_100, coverage(sd_ring))

            # Der Anstoßpunkt ist der einzige Farbakzent.
            sd_spot = sd_circle(px, py, cx, cy, spot_r)
            c = blend(c, SODIUM_500, coverage(sd_spot))

            row.extend(c)
        rows.append(row)
    return rows


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, OUT_DIR)
    os.makedirs(out, exist_ok=True)

    print("Icons — Motiv: Spielfeld bei Flutlicht")
    print("─" * 44)
    for name, size in SIZES.items():
        path = os.path.join(out, name)
        written = write_png(path, size, size, render(size))
        print(f"{name:<28}{size:>4}px  {written:>6} Bytes")
    print(f"\n{len(SIZES)} Dateien in {OUT_DIR}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
