/* Kleine DOM-Helfer.
 *
 * Kein Framework, aber auch kein Wald aus createElement/appendChild. `el`
 * deckt alles ab, was die App braucht, und setzt Text immer über
 * textContent — damit kann kein eingegebener Text als Markup interpretiert
 * werden.
 */

const PROP_ALIASES = { for: 'htmlFor', class: 'className' };

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * el('div', { class: 'card' }, el('h2', { text: 'Titel' }))
 *
 * Sonderfälle: `text` setzt textContent, `dataset` mischt data-Attribute,
 * `on…` hängt einen Listener an.
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);

  for (const [rawKey, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (rawKey === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (rawKey === 'dataset') {
      Object.assign(node.dataset, value);
      continue;
    }
    if (rawKey.startsWith('on') && typeof value === 'function') {
      node.addEventListener(rawKey.slice(2).toLowerCase(), value);
      continue;
    }

    const key = PROP_ALIASES[rawKey] ?? rawKey;
    if (key in node) node[key] = value;
    else node.setAttribute(rawKey, value);
  }

  appendChildren(node, children);
  return node;
}

/** Alles ersetzen, was in einem Container liegt. */
export function replace(container, ...children) {
  container.textContent = '';
  appendChildren(container, children);
  return container;
}

/* ─── Zahleneingabe ──────────────────────────────────────────────────────── */

/**
 * Eingabefeld für Dezimalzahlen — bewusst NICHT `type="number"`.
 *
 * Ein Zahlenfeld weist nach HTML-Spezifikation alles ab, was keine gültige
 * Fließkommazahl mit PUNKT ist. Auf einer deutschen Tastatur liegt aber ein
 * Komma auf der Dezimaltaste: aus "7,5" wird dann ein leerer Wert, und die
 * Eingabe verschwindet stillschweigend.
 *
 * `type="text"` mit `inputmode="decimal"` zeigt dieselbe Zifferntastatur,
 * nimmt aber beides an. Umgewandelt wird in parseDecimal().
 */
export function decimalInput(props) {
  return el('input', {
    type: 'text',
    inputMode: 'decimal',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: false,
    ...props,
    class: `num${props?.class ? ` ${props.class}` : ''}`,
  });
}

/** "7,5" und "7.5" → 7.5. Leer oder unlesbar → null. */
export function parseDecimal(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Zahl fürs Eingabefeld: Punkt zu Komma. */
export function toInputValue(value, digits = null) {
  if (value === null || value === undefined) return '';
  const s = digits === null ? String(value) : value.toFixed(digits);
  return s.replace('.', ',');
}

/* ─── Zahlen fürs Auge ───────────────────────────────────────────────────── */

/** Ganze Zahl mit deutschem Tausenderpunkt. */
export function int(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('de-DE');
}

/** Dezimalzahl mit deutschem Komma. */
export function dec(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Gewicht ohne überflüssige Nachkommastelle: 20 statt 20,0 — aber 22,5. */
export function kg(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : dec(value, 1);
}

/** 'Tag' oder 'Tage' — je nach Anzahl. */
export function dayWord(n) {
  return n === 1 ? 'Tag' : 'Tage';
}

/**
 * '1 Satz' oder '3 Sätze'.
 *
 * Als Funktion, weil der Plural im Deutschen nicht durch Anhängen entsteht:
 * `Satz${n === 1 ? '' : 'e'}` ergab „2 Satze" — der Umlaut fehlt. Dasselbe
 * Muster hat es an drei Stellen gegeben, deshalb steht es jetzt einmal hier.
 */
export function setWord(n) {
  return n === 1 ? 'Satz' : 'Sätze';
}

/** '1 Satz' / '3 Sätze' — Zahl und Wort zusammen. */
export function setCount(n) {
  return `${n} ${setWord(n)}`;
}

/** Kennzahl mit Einheit und Beschriftung. */
export function stat(label, value, unit) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat__value' },
      value,
      unit ? el('span', { class: 'stat__unit', text: unit }) : null),
    el('span', { class: 'stat__label', text: label }));
}

/** Karte mit Kopfzeile. */
export function card(title, right, ...children) {
  return el('div', { class: 'card' },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: title }),
      right ?? null),
    ...children);
}

/**
 * Aufklappbarer Abschnitt.
 *
 * Damit werden Essen und Trends gegliedert: zugeklappt sieht man Titel und
 * Urteil, aufgeklappt die Charts. Auf einem Handydisplay ist das der
 * Unterschied zwischen einem Screen, den man überblickt, und einem, den man
 * dreimal scrollt.
 *
 * `keep` ist eine stabile Kennung. Die App zeichnet ihre Ansicht bei jeder
 * Änderung komplett neu — js/app.js merkt sich anhand dieser Kennung, welche
 * Abschnitte offen waren, und öffnet genau die wieder. Ohne `keep` würde ein
 * Abschnitt bei jeder Eingabe zuklappen.
 *
 * @param {object} options { title, keep, chip, tone, open, note }
 */
export function panel({ title, keep, chip = null, tone = null, open = false, note = null },
  ...children) {
  if (!keep) throw new Error('panel() braucht eine Kennung (keep), sonst klappt es beim Neuzeichnen zu.');

  return el('details', {
    class: `panel${tone ? ` panel--${tone}` : ''}`,
    open,
    dataset: { keep },
  },
    el('summary', null,
      el('span', { class: 'panel__title', text: title }),
      chip ? el('span', { class: `chip${tone ? ` chip--${tone}` : ''}`, text: chip }) : null),
    el('div', { class: 'panel__body' },
      note ? el('p', { class: 'panel__note', text: note }) : null,
      ...children));
}
