#!/usr/bin/env python3
"""Prüft die Flutlicht-Palette auf Lesbarkeit und Unterscheidbarkeit.

Ersetzt den Node-Validator der dataviz-Richtlinie, weil in dieser Umgebung
kein node installiert ist. Nutzt ausschließlich die Standardbibliothek.

Geprüft wird:
  1. WCAG-2.1-Kontrast jeder Textfarbe gegen jede Flächenfarbe
  2. Kontrast der Chart-Marken gegen die Flächen (Grenze 3:1 für Grafik)
  3. OKLab-Abstand der Signalfarben gegeneinander — bei Normalsicht und
     simuliert für Protanopie, Deuteranopie und Tritanopie

Aufruf:  python3 tools/check_contrast.py
Rückgabe: Exit-Code 1, wenn eine Pflichtprüfung fehlschlägt.
"""

import sys

# ─── Die Palette (muss mit css/tokens.css übereinstimmen) ────────────────────

SURFACES = {
    "--pitch-900": "#0C120F",   # Seitenhintergrund
    "--pitch-800": "#131C17",   # Kartenfläche
    "--pitch-700": "#1B2620",   # erhöhte Fläche, Eingabefelder
}

TEXT = {
    "--chalk-100": "#EDF1EC",     # Primärtext
    "--chalk-500": "#8A968D",     # Labels, Sekundärtext
    "--sodium-500": "#FF8A1F",    # Signaltext
    "--redcard-500": "#F53B5C",   # Alarmtext ("Ruhetag")
}

# Marken in Charts: Grafik, nicht Text → Grenze 3:1.
#
# --data-500 ist ein reines Grafik-Token und steht bewusst NICHT in TEXT:
# es trägt niemals Schrift. Regel der dataviz-Richtlinie: Text trägt
# Text-Token, nie die Serienfarbe.
#
# --redcard-500 steht bewusst NICHT hier. Begründung siehe USAGE_RULES:
# gegen --data-500 kollabiert es bei Protanopie auf ΔE 3.7 (Rot-Grün-
# Zusammenfall). Charts benutzen ausschließlich die drei Marken unten.
MARKS = {
    "--chalk-100": "#EDF1EC",
    "--chalk-500": "#8A968D",
    "--data-500": "#63796F",      # recessive Balken und Marken
    "--sodium-500": "#FF8A1F",    # hervorgehobener Wert
}

# Nutzungsregeln, auf denen dieser Bericht beruht. Sie sind Teil der
# Prüfung: wird eine davon im Code gebrochen, ist der Bericht ungültig.
USAGE_RULES = [
    "Charts benutzen nur --chalk-100, --chalk-500, --data-500 und "
    "--sodium-500. --redcard-500 kommt in keinem Chart vor.",

    "Schwellenwerte (Schlaf 6,5 h, Bereitschaft 50 und 75) werden als "
    "Referenzlinie gezeichnet, nicht als Farbe der Marke. Position ist "
    "die robustere Kodierung und funktioniert bei jeder Sehschwäche.",

    "--redcard-500 ist ein Text-Token für den Zustand \"Ruhetag\": große "
    "Zahl und Statuswort. Auf --pitch-700 nur ab 24px bzw. 19px bold.",

    "Jeder Zustand trägt immer ein Wort (\"Bereit\" / \"Volumen "
    "reduziert\" / \"Ruhetag\") — nie Farbe allein.",

    "Flächen unter Linien sind Sodium mit niedriger Deckkraft, keine "
    "eigene Kategorie.",
]

# Paare, die im UI direkt nebeneinander Bedeutung tragen und daher
# unterscheidbar sein MÜSSEN — auch bei Farbfehlsichtigkeit.
#
# Flächenfüllungen unter Linien stehen hier absichtlich nicht drin: eine
# Fläche ist Hintergrund, keine Kategorie. Sie wird als Sodium mit
# niedriger Deckkraft gezeichnet (eine Hue, zwei Helligkeitsstufen) und
# muss deshalb keinen Kategorien-Abstand einhalten.
SIGNAL_PAIRS = [
    ("--chalk-100", "--sodium-500"),     # "Bereit" vs. "Volumen reduziert"
    ("--sodium-500", "--redcard-500"),   # "Volumen reduziert" vs. "Ruhetag"
    ("--chalk-100", "--redcard-500"),    # "Bereit" vs. "Ruhetag"
    ("--data-500", "--sodium-500"),      # normaler vs. hervorgehobener Balken
    ("--chalk-100", "--data-500"),       # Rohpunkt vs. recessiver Balken
]

ALL = dict(SURFACES)
ALL.update(TEXT)
ALL.update(MARKS)

# Grenzwerte
WCAG_TEXT_AA = 4.5        # Fließtext
WCAG_LARGE_AA = 3.0       # Text ab 24px bzw. 19px bold
WCAG_GRAPHIC = 3.0        # Grafische Objekte und Marken
DELTA_NORMAL_MIN = 15.0   # harte Untergrenze bei Normalsicht
DELTA_CVD_TARGET = 8.0    # Ziel bei Farbfehlsichtigkeit
DELTA_CVD_FLOOR = 6.0     # Untergrenze, nur mit zweitem Encoding erlaubt


# ─── Farbmathematik ──────────────────────────────────────────────────────────

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linearize(rgb):
    return tuple(to_linear(c) for c in rgb)


def luminance(rgb):
    r, g, b = linearize(rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(hex_a, hex_b):
    la, lb = luminance(hex_to_rgb(hex_a)), luminance(hex_to_rgb(hex_b))
    lo, hi = min(la, lb), max(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _cbrt(x):
    return x ** (1 / 3) if x >= 0 else -((-x) ** (1 / 3))


def oklab(rgb_linear):
    """Björn Ottossons OKLab, Eingang lineares sRGB."""
    r, g, b = rgb_linear
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = _cbrt(l), _cbrt(m), _cbrt(s)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


# Viénot/Brettel-Matrizen für schwere Farbfehlsichtigkeit, lineares sRGB
CVD = {
    "Protanopie": (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    "Deuteranopie": (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881),
    ),
    "Tritanopie": (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900),
    ),
}


def simulate(rgb_linear, kind):
    m = CVD[kind]
    return tuple(
        max(0.0, min(1.0, sum(m[row][i] * rgb_linear[i] for i in range(3))))
        for row in range(3)
    )


def delta_e(hex_a, hex_b, kind=None):
    """OKLab-Abstand × 100, optional mit CVD-Simulation."""
    la, lb = linearize(hex_to_rgb(hex_a)), linearize(hex_to_rgb(hex_b))
    if kind:
        la, lb = simulate(la, kind), simulate(lb, kind)
    a, b = oklab(la), oklab(lb)
    return 100.0 * sum((a[i] - b[i]) ** 2 for i in range(3)) ** 0.5


# ─── Prüfläufe ───────────────────────────────────────────────────────────────

failures = []
warnings = []


def head(title):
    print("\n" + title)
    print("─" * len(title))


def check_text():
    head("1 · WCAG-Kontrast: Text auf Fläche")
    print(f"{'Farbe':<14}{'Fläche':<14}{'Ratio':>8}   Urteil")
    for tname, thex in TEXT.items():
        for sname, shex in SURFACES.items():
            ratio = contrast(thex, shex)
            if ratio >= WCAG_TEXT_AA:
                verdict = "PASS  Fließtext (AA)"
            elif ratio >= WCAG_LARGE_AA:
                verdict = "PASS  nur große Schrift (AA large)"
                warnings.append(
                    f"{tname} auf {sname}: {ratio:.2f}:1 — nur ab 24px "
                    f"bzw. 19px bold verwenden"
                )
            else:
                verdict = "FAIL"
                failures.append(
                    f"{tname} auf {sname}: {ratio:.2f}:1 < {WCAG_LARGE_AA}"
                )
            print(f"{tname:<14}{sname:<14}{ratio:>7.2f}:1   {verdict}")


def check_marks():
    head("2 · WCAG-Kontrast: Chart-Marken auf Fläche (Grenze 3:1)")
    print(f"{'Marke':<14}{'Fläche':<14}{'Ratio':>8}   Urteil")
    for mname, mhex in MARKS.items():
        for sname, shex in SURFACES.items():
            ratio = contrast(mhex, shex)
            ok = ratio >= WCAG_GRAPHIC
            if not ok:
                failures.append(
                    f"Marke {mname} auf {sname}: {ratio:.2f}:1 < {WCAG_GRAPHIC}"
                )
            print(f"{mname:<14}{sname:<14}{ratio:>7.2f}:1   "
                  f"{'PASS' if ok else 'FAIL'}")


def check_pairs():
    head("3 · OKLab-Abstand der Signalpaare (Normalsicht + CVD)")
    cols = ["Normal"] + list(CVD.keys())
    print(f"{'Paar':<30}" + "".join(f"{c:>14}" for c in cols) + "   Urteil")
    for a, b in SIGNAL_PAIRS:
        ha, hb = ALL[a], ALL[b]
        normal = delta_e(ha, hb)
        cvds = {k: delta_e(ha, hb, k) for k in CVD}
        label = f"{a} / {b}"

        verdict = "PASS"
        if normal < DELTA_NORMAL_MIN:
            verdict = "FAIL"
            failures.append(
                f"{label}: Normalsicht ΔE {normal:.1f} < {DELTA_NORMAL_MIN} — "
                f"auch Vollfarbsehende unterscheiden das Paar nicht"
            )
        worst_kind, worst = min(cvds.items(), key=lambda kv: kv[1])
        if worst < DELTA_CVD_FLOOR:
            verdict = "FAIL"
            failures.append(
                f"{label}: {worst_kind} ΔE {worst:.1f} < {DELTA_CVD_FLOOR}"
            )
        elif worst < DELTA_CVD_TARGET and verdict == "PASS":
            verdict = "OK*"
            warnings.append(
                f"{label}: {worst_kind} ΔE {worst:.1f} < Ziel "
                f"{DELTA_CVD_TARGET} — nur zulässig mit zweitem Encoding "
                f"(Wort oder Symbol), das die App immer mitliefert"
            )

        row = f"{label:<30}{normal:>14.1f}"
        row += "".join(f"{cvds[k]:>14.1f}" for k in CVD)
        print(row + f"   {verdict}")


def show_rules():
    head("4 · Nutzungsregeln, auf denen dieser Bericht beruht")
    for i, rule in enumerate(USAGE_RULES, 1):
        first, *rest = rule.split("\n")
        print(f"  {i}. {first}")
        for line in rest:
            print(f"     {line.strip()}")


def main():
    print("Flutlicht-Palette — Prüfbericht")
    print("=" * 34)
    check_text()
    check_marks()
    check_pairs()
    show_rules()

    head("Ergebnis")
    if warnings:
        print(f"{len(warnings)} Hinweis(e):")
        for w in warnings:
            print(f"  • {w}")
    if failures:
        print(f"\n{len(failures)} FEHLER:")
        for f in failures:
            print(f"  ✗ {f}")
        print("\nPalette nicht freigegeben.")
        return 1
    print("\nAlle Pflichtprüfungen bestanden. Palette freigegeben.")
    print("OK* bedeutet: zulässig, weil jeder Status in dieser App immer")
    print("zusätzlich ein Wort trägt — nie Farbe allein.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
