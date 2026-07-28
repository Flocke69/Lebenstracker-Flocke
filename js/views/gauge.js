/* Die Statusgrafik, die die Punktzahl ersetzt.
 *
 * Flockes Vorgabe: keine 0 bis 100, sondern "einfach eine Grafik, dass alles
 * gut ist oder schlecht". Also ein Bogen, der sich füllt, in der Statusfarbe,
 * mit dem Wort darin — und darunter vier Balken, einer je Check-in-Frage.
 *
 * Warum ein Bogen und keine Zahl: eine Zahl muss gelesen und verglichen
 * werden ("ist 68 gut?"), eine gefüllte Form nicht. Und warum überhaupt vier
 * Balken darunter: "Schlecht" allein ist keine Information, mit der man etwas
 * tun kann. Erst "Schlecht, und zwar der Schlaf" ist eine.
 *
 * Der Bogen zeigt DREI STUFEN, nicht den Score. Er füllt sich auf ein Viertel,
 * knapp zwei Drittel oder ganz — nichts dazwischen. Sonst wäre es wieder eine
 * Punktzahl, nur ohne Ziffern.
 */

import { CHECKIN_FIELDS, toneOfSub } from '../lib/readiness.js';
import { el } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

/* Halbkreis, 180 Grad, von links unten nach rechts unten. Ein voller Kreis
   wäre schöner und schlechter: der Halbkreis hat einen sichtbaren Anfang und
   ein sichtbares Ende, und damit ist "wie voll" ohne Zahl ablesbar. */
const W = 200;
const H = 116;
const R = 84;
const CX = W / 2;
const CY = 100;
const ARC_LENGTH = Math.PI * R;

function arcPath() {
  return `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
}

/**
 * Der Bogen mit Wort.
 *
 * @param {object} readiness Ergebnis von readinessScore()
 */
export function readinessArc(readiness) {
  const d = readiness.display;
  const filled = ARC_LENGTH * d.fill;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'arc',
    role: 'img',
    'aria-label': `Bereitschaft: ${d.word}. ${d.short}.`,
  });

  svg.append(svgEl('path', { d: arcPath(), class: 'arc__track' }));

  if (filled > 0) {
    svg.append(svgEl('path', {
      d: arcPath(),
      class: `arc__fill arc__fill--${d.tone}`,
      // Erst die gefüllte Länge, dann der Rest als Lücke.
      'stroke-dasharray': `${filled} ${ARC_LENGTH}`,
    }));
  }

  return el('div', { class: `arc-wrap arc-wrap--${d.tone}` },
    svg,
    el('div', { class: 'arc__label' },
      el('span', { class: 'arc__word', text: d.word }),
      el('span', { class: 'arc__short', text: d.short })));
}

/**
 * Die vier Balken — einer je Check-in-Frage, in der Farbe seines Zustands.
 *
 * Ein leerer Balken ist kein Fehler, sondern "noch nicht beantwortet". Er
 * bekommt deshalb einen sichtbaren Rahmen statt gar nichts: verschwundene
 * Zeilen liest man als Fehler.
 */
export function factorBars(readiness) {
  return el('div', { class: 'factors' },
    CHECKIN_FIELDS.map((field) => {
      const sub = readiness.subScores?.[field.key];
      const tone = toneOfSub(sub);
      const known = typeof sub === 'number';
      const width = known ? Math.max(sub, 4) : 0;

      return el('div', { class: 'factor' },
        el('span', { class: 'factor__name', text: field.label }),
        el('div', {
          class: 'factor__track',
          role: 'img',
          'aria-label': known
            ? `${field.label}: ${tone === 'good' ? 'gut' : tone === 'ok' ? 'mittel' : 'schlecht'}`
            : `${field.label}: nichts eingetragen`,
        },
          known
            ? el('div', {
              class: `factor__fill factor__fill--${tone}`,
              style: `width: ${width.toFixed(0)}%`,
            })
            : null),
        el('span', {
          class: `factor__mark factor__mark--${tone}`,
          text: known ? (tone === 'good' ? '✓' : tone === 'ok' ? '~' : '!') : '·',
          'aria-hidden': 'true',
        }));
    }));
}

/**
 * Kleiner Ring für eine Trefferquote, 0…1.
 *
 * Wird in Trends und Review benutzt, wo "5 von 7" schneller als Form als als
 * Bruch gelesen wird.
 */
export function ratioRing(ratio, { label, tone = 'good', size = 56 } = {}) {
  const r = 22;
  const circumference = 2 * Math.PI * r;
  const value = typeof ratio === 'number' && Number.isFinite(ratio)
    ? Math.min(Math.max(ratio, 0), 1)
    : null;

  const svg = svgEl('svg', {
    viewBox: '0 0 56 56',
    width: size,
    height: size,
    class: 'ring',
    role: 'img',
    'aria-label': value === null
      ? `${label}: nichts eingetragen`
      : `${label}: ${Math.round(value * 100)} Prozent`,
  });

  svg.append(svgEl('circle', { cx: 28, cy: 28, r, class: 'ring__track' }));
  if (value !== null && value > 0) {
    svg.append(svgEl('circle', {
      cx: 28, cy: 28, r,
      class: `ring__fill ring__fill--${tone}`,
      'stroke-dasharray': `${circumference * value} ${circumference}`,
      // Oben anfangen statt rechts — sonst liest sich der Ring wie eine Uhr.
      transform: 'rotate(-90 28 28)',
    }));
  }

  /* Mit Prozentzeichen. Ohne es liest sich die 61 im Ring wie eine Punktzahl —
     und Punktzahlen sind aus dieser App bewusst verschwunden. */
  const text = svgEl('text', {
    x: 28, y: 32, 'text-anchor': 'middle', class: 'ring__text',
  });
  text.textContent = value === null ? '–' : `${Math.round(value * 100)}%`;
  svg.append(text);

  return el('div', { class: 'ring-wrap' },
    svg,
    el('span', { class: 'ring__label', text: label }));
}
