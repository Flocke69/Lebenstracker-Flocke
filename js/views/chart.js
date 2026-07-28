/* Charts als handgeschriebenes SVG. Keine Bibliothek.
 *
 * Regeln, an die sich hier alles hält:
 *
 *   KEINE DOPPELACHSE. Zwei Messgrößen sind zwei Charts. Auf einem
 *   Handydisplay sind Small Multiples ohnehin lesbarer als ein Kombi-Bild,
 *   und eine zweite y-Achse lädt zu Scheinzusammenhängen ein.
 *
 *   SCHWELLEN ALS LINIE, NICHT ALS FARBE. Die 6,5 Stunden Schlaf sind eine
 *   waagerechte Kreidelinie, kein roter Balken. Position funktioniert bei
 *   jeder Farbfehlsichtigkeit, Farbe nicht.
 *
 *   EINE FARBE JE MESSGRÖSSE, durchgehend über alle Screens: Gewicht blau,
 *   Schlaf violett, Bereitschaft grün, Kalorien orange, Protein pink,
 *   Volumen gelb. Weil ein Chart immer nur EINE Messgröße trägt, braucht es
 *   keine Legende — der Titel benennt sie, die Farbe macht sie
 *   wiedererkennbar. Die Farbe wird über `series` gewählt und landet als
 *   CSS-Klasse am SVG, nicht als Attribut: so bleibt die Palette in
 *   tokens.css und ist prüfbar.
 *
 * Antippen statt Hover: ein Fingertipp auf einen Wert schreibt Datum und
 * Zahl in die Zeile unter dem Chart. Die Trefferfläche ist deutlich größer
 * als die Marke. Bei sehr langen Reihen (über 70 Tagen) werden die
 * Trefferflächen weggelassen — 300 Rechtecke à 1 px trifft niemand, und der
 * Chart soll den Verlauf zeigen, nicht den einzelnen Tag.
 */

import { formatDayShort, weekdayShort } from '../lib/dates.js';
import { el, dec, int } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Zeichenfläche in SVG-Einheiten. Die Breite skaliert über CSS mit. */
const W = 320;
const PAD = { top: 10, right: 6, bottom: 18, left: 30 };

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Ab so vielen Punkten lohnt sich das Antippen einzelner Tage nicht mehr. */
const MAX_HIT_POINTS = 70;

/** Erlaubte Messgrößen — die Klasse landet am SVG und wählt die Farbe. */
const SERIES = ['weight', 'sleep', 'ready', 'kcal', 'protein', 'volume', 'neutral'];

function seriesClass(series) {
  if (series && !SERIES.includes(series)) {
    throw new RangeError(
      `Unbekannte Messgröße "${series}". Erlaubt: ${SERIES.join(', ')}`
    );
  }
  return `chart--${series ?? 'neutral'}`;
}

/**
 * Achsengrenzen mit etwas Luft. Bei einer flachen Reihe wird sie aufgespreizt.
 *
 * `maxCap` deckelt die Obergrenze. Ohne das stand über einer Reihe, die bei 100
 * endet, die Achsenbeschriftung "108" — und behauptete damit einen Wertebereich,
 * den es nicht gibt.
 */
function bounds(values, { fromZero = false, include = [], maxCap = null } = {}) {
  const known = values.filter(isNum).concat(include.filter(isNum));
  if (known.length === 0) return { min: 0, max: maxCap ?? 1 };
  let min = fromZero ? 0 : Math.min(...known);
  let max = Math.max(...known);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  const paddedMax = max + pad;
  return {
    min: fromZero ? 0 : min - pad,
    max: maxCap === null ? paddedMax : Math.min(paddedMax, maxCap),
  };
}

/* ─── Gerüst ─────────────────────────────────────────────────────────────── */

function frame(height) {
  const inner = {
    x0: PAD.left,
    x1: W - PAD.right,
    y0: PAD.top,
    y1: height - PAD.bottom,
  };
  inner.width = inner.x1 - inner.x0;
  inner.height = inner.y1 - inner.y0;
  return inner;
}

function axisLabels(g, box, min, max, format) {
  for (const [value, y] of [[max, box.y0], [min, box.y1]]) {
    g.append(svgEl('line', {
      x1: box.x0, x2: box.x1, y1: y, y2: y,
      class: 'chart__grid',
    }));
    const label = svgEl('text', {
      x: box.x0 - 4, y: y + 3, 'text-anchor': 'end', class: 'chart__axis',
    });
    label.textContent = format(value);
    g.append(label);
  }
}

function xLabels(g, box, keys) {
  // Nur erster, mittlerer und letzter Tag — mehr wird auf 375 px zu Matsch.
  const picks = keys.length <= 3
    ? keys.map((_, i) => i)
    : [0, Math.floor((keys.length - 1) / 2), keys.length - 1];
  const step = keys.length > 1 ? box.width / (keys.length - 1) : 0;

  for (const i of picks) {
    const t = svgEl('text', {
      x: box.x0 + i * step,
      y: box.y1 + 13,
      'text-anchor': i === 0 ? 'start' : i === keys.length - 1 ? 'end' : 'middle',
      class: 'chart__axis',
    });
    t.textContent = formatDayShort(keys[i]);
    g.append(t);
  }
}

/** Waagerechte Referenzlinie mit Beschriftung — die Schwelle als Position. */
function referenceLine(g, box, y, label) {
  g.append(svgEl('line', {
    x1: box.x0, x2: box.x1, y1: y, y2: y, class: 'chart__ref',
  }));
  const t = svgEl('text', { x: box.x1, y: y - 3, 'text-anchor': 'end', class: 'chart__ref-label' });
  t.textContent = label;
  g.append(t);
}

/* ─── Antippen ───────────────────────────────────────────────────────────── */

function readout(initial) {
  return el('p', { class: 'chart__readout', text: initial });
}

function addHitAreas(svg, box, keys, values, out, format) {
  const step = keys.length > 1 ? box.width / (keys.length - 1) : box.width;
  keys.forEach((key, i) => {
    const x = box.x0 + i * step;
    const hit = svgEl('rect', {
      x: x - step / 2,
      y: box.y0,
      width: Math.max(step, 8),
      height: box.height,
      fill: 'transparent',
      class: 'chart__hit',
      tabindex: '0',
      role: 'button',
      'aria-label': `${formatDayShort(key)}: ${isNum(values[i]) ? format(values[i]) : 'kein Wert'}`,
    });
    const show = () => {
      out.textContent = isNum(values[i])
        ? `${weekdayShort(key)} ${formatDayShort(key)} — ${format(values[i])}`
        : `${weekdayShort(key)} ${formatDayShort(key)} — nichts eingetragen`;
    };
    hit.addEventListener('click', show);
    hit.addEventListener('focus', show);
    svg.append(hit);
  });
}

/* ─── Liniendiagramm ─────────────────────────────────────────────────────── */

/**
 * Rohpunkte in Kreide plus geglättete Linie in Sodium.
 *
 * Für das Gewicht: der Tageswert ist Rauschen, die Linie ist die Aussage.
 */
export function lineChart({
  keys, raw, avg, title, unit = '', height = 150, digits = 1, refs = [], fromZero = false,
  series = null, maxCap = null,
}) {
  const box = frame(height);
  const { min, max } = bounds([...raw, ...(avg ?? [])],
    { fromZero, include: refs.map((r) => r.value), maxCap });
  const scaleY = (v) => box.y1 - ((v - min) / (max - min)) * box.height;
  const step = keys.length > 1 ? box.width / (keys.length - 1) : 0;
  const format = (v) => `${dec(v, digits)}${unit ? ` ${unit}` : ''}`;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${height}`,
    class: `chart ${seriesClass(series)}`,
    role: 'img',
    'aria-label': title,
  });

  axisLabels(svg, box, min, max, (v) => dec(v, digits));
  xLabels(svg, box, keys);
  for (const ref of refs) referenceLine(svg, box, scaleY(ref.value), ref.label);

  // Geglättete Linie: zusammenhängende Abschnitte, Lücken werden nicht
  // überbrückt — sonst behauptet die Linie Werte, die es nicht gibt.
  if (avg) {
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        svg.append(svgEl('polyline', { points: run.join(' '), class: 'chart__line' }));
      } else if (run.length === 1) {
        const [x, y] = run[0].split(',');
        svg.append(svgEl('circle', { cx: x, cy: y, r: 2, class: 'chart__line-dot' }));
      }
      run = [];
    };
    avg.forEach((v, i) => {
      if (isNum(v)) run.push(`${box.x0 + i * step},${scaleY(v)}`);
      else flush();
    });
    flush();
  }

  // Rohwerte als Punkte. Bei langen Reihen kleiner, sonst wird es ein Teppich.
  const dotRadius = keys.length > MAX_HIT_POINTS ? 1.4 : 3;
  raw.forEach((v, i) => {
    if (!isNum(v)) return;
    svg.append(svgEl('circle', {
      cx: box.x0 + i * step, cy: scaleY(v), r: dotRadius, class: 'chart__dot',
    }));
  });

  if (keys.length > MAX_HIT_POINTS) {
    return el('div', { class: 'chart-wrap' }, svg);
  }

  const out = readout('Tippe einen Tag an.');
  addHitAreas(svg, box, keys, raw, out, format);

  return el('div', { class: 'chart-wrap' }, svg, out);
}

/* ─── Balkendiagramm ─────────────────────────────────────────────────────── */

/**
 * Balken in --data-500, der aktuelle Tag in Sodium, das Ziel als Linie.
 *
 * 4 px gerundete Datenenden an der Grundlinie, 2 px Lücke zwischen Balken.
 */
export function barChart({
  keys, values, title, unit = '', height = 130, digits = 0, refs = [], highlightIndex = null,
  series = null,
}) {
  const box = frame(height);
  const { min, max } = bounds(values, { fromZero: true, include: refs.map((r) => r.value) });
  const scaleY = (v) => box.y1 - ((v - min) / (max - min)) * box.height;
  const slot = box.width / Math.max(keys.length, 1);
  const barW = Math.max(slot - 2, 2);
  const format = (v) => `${dec(v, digits)}${unit ? ` ${unit}` : ''}`;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${height}`,
    class: `chart ${seriesClass(series)}`,
    role: 'img',
    'aria-label': title,
  });

  axisLabels(svg, box, min, max, (v) => int(v));
  xLabels(svg, box, keys);

  values.forEach((v, i) => {
    if (!isNum(v)) return;
    const y = scaleY(v);
    svg.append(svgEl('rect', {
      x: box.x0 + i * slot + 1,
      y,
      width: barW,
      height: Math.max(box.y1 - y, 1),
      rx: 2,
      class: `chart__bar${i === highlightIndex ? ' chart__bar--now' : ''}`,
    }));
  });

  for (const ref of refs) referenceLine(svg, box, scaleY(ref.value), ref.label);

  const out = readout('Tippe einen Tag an.');
  addHitAreas(svg, box, keys, values, out, format);

  return el('div', { class: 'chart-wrap' }, svg, out);
}

/* ─── Small Multiples ────────────────────────────────────────────────────── */

/**
 * Ein Mini-Chart pro Muskelgruppe.
 *
 * Bewusst statt eines gestapelten Balkens: ein Stapel mit sechs
 * Muskelgruppen bräuchte sechs kategorial unterscheidbare Farbtöne, und die
 * tatsächliche Frage lautet "steigt mein Schultervolumen?" — die beantwortet
 * ein eigener Verlauf besser als ein Segment in einem Stapel.
 */
export function sparkBars({ label, values, unit = 'Sätze', series = 'volume' }) {
  const h = 42;
  const w = 88;
  const max = Math.max(...values.filter(isNum), 1);
  const slot = w / Math.max(values.length, 1);
  const lastIndex = values.length - 1;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${h}`,
    class: `spark ${seriesClass(series)}`,
    role: 'img',
    'aria-label': `${label}: ${values.map((v) => dec(v, 1)).join(', ')} ${unit}`,
  });

  values.forEach((v, i) => {
    if (!isNum(v)) return;
    const isNow = i === lastIndex;

    // Eine Woche ohne Volumen bekommt trotzdem einen Strich auf der
    // Grundlinie. Ohne den verschwindet der Zeitraum ganz und die Verläufe
    // verschiedener Muskelgruppen sind unterschiedlich lang — das liest sich
    // wie ein Fehler, obwohl die Null die Aussage ist.
    const barH = v > 0 ? Math.max((v / max) * (h - 4), 1.5) : 1;
    svg.append(svgEl('rect', {
      x: i * slot + 1,
      y: h - barH,
      width: Math.max(slot - 2, 1),
      height: barH,
      rx: v > 0 ? 1.5 : 0,
      class: v > 0
        ? `chart__bar${isNow ? ' chart__bar--now' : ''}`
        : 'chart__bar-empty',
    }));
  });

  const last = values[lastIndex];
  const previous = values[lastIndex - 1];

  return el('div', { class: 'spark-cell' },
    el('div', { class: 'spark-cell__head' },
      el('span', { class: 'spark-cell__label', text: label }),
      el('span', { class: 'spark-cell__value', text: isNum(last) ? dec(last, 1) : '—' })),
    svg,
    // Die letzte Woche läuft noch. Ohne diesen Hinweis liest sich eine 0 am
    // Montag wie "hier fehlt etwas" statt "die Woche hat gerade angefangen".
    el('span', { class: 'spark-cell__foot' },
      'lfd. Woche',
      isNum(previous)
        ? el('span', { class: 'spark-cell__prev', text: ` · davor ${dec(previous, 1)}` })
        : null));
}

/* ─── Tabellenansicht ────────────────────────────────────────────────────── */

/**
 * Jeder Chart bekommt eine aufklappbare Tabelle.
 *
 * Nicht als Zugabe, sondern als Pflicht: wer die Grafik nicht lesen kann —
 * aus welchem Grund auch immer — bekommt dieselben Daten als Zahlen.
 */
export function chartTable(keys, columns, keep = null) {
  return el('details', {
    class: 'reveal reveal--table',
    // Damit die Tabelle beim Neuzeichnen offen bleibt (siehe js/app.js).
    dataset: keep ? { keep: `table-${keep}` } : undefined,
  },
    el('summary', null, el('span', { text: 'Zahlen dazu' })),
    el('div', { class: 'reveal__body' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'Tag' }),
            columns.map((c) => el('th', { text: c.label })))),
          el('tbody', null,
            keys.map((key, i) =>
              el('tr', null,
                el('td', { text: `${weekdayShort(key)} ${formatDayShort(key)}` }),
                columns.map((c) => el('td', {
                  text: isNum(c.values[i]) ? dec(c.values[i], c.digits ?? 1) : '—',
                })))))))));
}
