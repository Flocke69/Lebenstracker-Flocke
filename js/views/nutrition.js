/* Essen — Ziel anzeigen, Ist grob eintragen.
 *
 * Bewusst KEINE Lebensmittel-Datenbank. Gegen MyFitnessPal ist die nicht zu
 * gewinnen, und eine halbgare eigene Liste kostet mehr Zeit, als sie
 * einbringt. Vier Zahlen pro Tag genügen, um die Frage zu beantworten, auf
 * die es ankommt: liege ich im Ziel oder nicht.
 *
 * Wer nur Protein und Kalorien einträgt, bekommt trotzdem eine sinnvolle
 * Auswertung — die Wochenquote rechnet nur mit dem, was da ist.
 */

import { todayKey, weekKeys, weekdayShort, formatDayShort } from '../lib/dates.js';
import { getDay, weightOn, dayTypeFor, kcalFromMacros } from '../lib/state.js';
import { dayTargets, DAY_TYPE_LABELS, ageOn, KCAL_PER_G } from '../lib/energy.js';
import {
  el, replace, card, int, dec, decimalInput, parseDecimal, toInputValue,
} from './dom.js';

/** Innerhalb dieser Spanne um das Ziel gilt ein Tag als getroffen. */
export const HIT_TOLERANCE = 0.1;   // ±10 %
/** Protein gilt ab diesem Anteil des Ziels als erfüllt — nach oben offen. */
export const PROTEIN_FLOOR = 0.9;

const FIELDS = [
  { key: 'kcal', label: 'Kalorien', unit: 'kcal', target: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g', target: 'proteinG' },
  { key: 'carbsG', label: 'Kohlenhydrate', unit: 'g', target: 'carbsG' },
  { key: 'fatG', label: 'Fett', unit: 'g', target: 'fatG' },
];

function targetsFor(state, key) {
  const p = state.profile;
  return dayTargets({
    sex: p.sex,
    weightKg: weightOn(state, key),
    heightCm: p.heightCm,
    age: ageOn(p.birthYear, key),
    dayType: dayTypeFor(state, key),
    factors: p.activityFactors,
    proteinPerKg: p.proteinPerKg,
    fatPerKg: p.fatPerKg,
    kcalOffset: p.kcalOffset,
    offsetExemptDayTypes: p.offsetExemptDayTypes,
  });
}

/* ─── Eingabe ────────────────────────────────────────────────────────────── */

function macroInput(store, dayKey, field, value) {
  const id = `nut-${field.key}`;
  return el('div', null,
    el('label', { for: id, text: `${field.label} (${field.unit})` }),
    decimalInput({
      id,
      value: toInputValue(value),
      placeholder: '—',
      onchange: (e) => {
        const n = parseDecimal(e.target.value);
        try {
          store.setDay(dayKey, { nutrition: { [field.key]: n } });
        } catch (err) {
          e.target.value = toInputValue(value);
          console.warn('[nutrition]', err.message);
        }
      },
    }));
}

/* ─── Fortschritt ────────────────────────────────────────────────────────── */

function progressRow(field, actual, target) {
  const hasValue = typeof actual === 'number';
  const ratio = hasValue && target > 0 ? actual / target : 0;
  const percent = Math.min(ratio, 1.35) * 100;

  // Über dem Ziel wird der Balken nicht länger, sondern bekommt eine
  // Kreidekante am Ende — sonst sprengt ein Ausrutscher die Skala.
  const over = ratio > 1 + HIT_TOLERANCE;

  return el('div', { class: 'macro' },
    el('div', { class: 'macro__head' },
      el('span', { class: 'macro__name', text: field.label }),
      el('span', { class: 'macro__value' },
        hasValue ? int(actual) : '—',
        el('span', { class: 'stat__unit', text: ` / ${int(target)} ${field.unit}` }))),
    el('div', {
      class: 'macro__track',
      role: 'img',
      'aria-label': hasValue
        ? `${field.label}: ${int(actual)} von ${int(target)} ${field.unit}, ${Math.round(ratio * 100)} Prozent`
        : `${field.label}: nichts eingetragen`,
    },
      el('div', {
        class: `macro__fill${over ? ' macro__fill--over' : ''}`,
        style: `width: ${Math.min(percent, 100).toFixed(1)}%`,
      })));
}

/* ─── Wochenquote ────────────────────────────────────────────────────────── */

/** Hat der Tag das Ziel getroffen? null, wenn nichts eingetragen ist. */
export function hitStatus(actual, target, { floorOnly = false } = {}) {
  if (typeof actual !== 'number' || !(target > 0)) return null;
  const ratio = actual / target;
  if (floorOnly) return ratio >= PROTEIN_FLOOR;
  return ratio >= 1 - HIT_TOLERANCE && ratio <= 1 + HIT_TOLERANCE;
}

function weekTable(state, today) {
  const keys = weekKeys(today);
  const rows = [];
  let kcalHits = 0;
  let proteinHits = 0;
  let logged = 0;

  for (const key of keys) {
    const day = getDay(state, key);
    const t = targetsFor(state, key);
    const n = day.nutrition ?? {};
    const hasAny = typeof n.kcal === 'number' || typeof n.proteinG === 'number';
    if (hasAny) logged += 1;

    const kcalHit = hitStatus(n.kcal, t.kcal);
    const proteinHit = hitStatus(n.proteinG, t.proteinG, { floorOnly: true });
    if (kcalHit) kcalHits += 1;
    if (proteinHit) proteinHits += 1;

    const mark = (hit) => (hit === null ? '·' : hit ? '✓' : '✕');

    rows.push(el('tr', { class: key === today ? 'is-today' : null },
      el('td', { text: `${weekdayShort(key)} ${formatDayShort(key)}` }),
      el('td', { text: typeof n.kcal === 'number' ? int(n.kcal) : '—' }),
      el('td', { text: int(t.kcal) }),
      el('td', { text: mark(kcalHit) }),
      el('td', { text: mark(proteinHit) })));
  }

  return {
    logged,
    kcalHits,
    proteinHits,
    node: el('div', { class: 'table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Tag' }),
          el('th', { text: 'Ist' }),
          el('th', { text: 'Ziel' }),
          el('th', { text: 'kcal' }),
          el('th', { text: 'Prot.' }))),
        el('tbody', null, rows))),
  };
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();
  const day = getDay(state, today);
  const n = day.nutrition ?? {};
  const t = targetsFor(state, today);
  const week = weekTable(state, today);

  const computed = kcalFromMacros(n);
  const mismatch =
    computed !== null && typeof n.kcal === 'number' && Math.abs(computed - n.kcal) > 100;

  return el('div', { class: 'view' },
    el('h1', { text: 'Essen' }),
    el('p', { class: 'field__hint' },
      'Trag ein, was du tatsächlich gegessen hast — abgelesen aus deiner ',
      'Ernährungs-App oder geschätzt. Grob reicht: wichtig ist der Trend über ',
      'Wochen, nicht die dritte Nachkommastelle.'),
    el('div', { style: 'height: var(--space-4)' }),

    card('Heute',
      el('span', { class: 'chip', text: DAY_TYPE_LABELS[dayTypeFor(state, today)] }),
      FIELDS.map((f) => progressRow(f, n[f.key], t[f.target])),
      el('p', { class: 'card__note' },
        `Ziel ${int(t.kcal)} kcal — Ruheumsatz ${int(t.bmr)} mal Faktor `,
        `${dec(t.factor, 2)}`,
        t.offsetExempt
          ? ', Korrektur an diesem Tag ausgesetzt.'
          : t.appliedOffset === 0
            ? '.'
            : `, plus Korrektur ${int(t.appliedOffset)} kcal.`)),

    card('Eintragen',
      typeof n.kcal === 'number' ? el('span', { class: 'chip', text: 'erfasst' }) : null,
      el('div', { class: 'field__row' },
        macroInput(store, today, FIELDS[0], n.kcal),
        macroInput(store, today, FIELDS[1], n.proteinG)),
      el('div', { style: 'height: var(--space-4)' }),
      el('div', { class: 'field__row' },
        macroInput(store, today, FIELDS[2], n.carbsG),
        macroInput(store, today, FIELDS[3], n.fatG)),
      mismatch
        ? el('p', { class: 'field__hint' },
          `Hinweis: aus deinen Makros ergeben sich ${int(computed)} kcal, `
          + `eingetragen sind ${int(n.kcal)}. Einer der Werte stimmt nicht — `
          + 'für die Auswertung zählt der Kalorienwert.')
        : el('p', { class: 'field__hint' },
          'Protein ist die wichtigste Zahl hier. Im Defizit entscheidet sie '
          + 'darüber, ob du Fett verlierst oder Fett und Muskeln.')),

    card('Diese Woche',
      el('span', { class: 'chip', text: `${week.logged} von 7 Tagen` }),
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat' },
          el('span', { class: 'stat__value', text: String(week.kcalHits) },
            el('span', { class: 'stat__unit', text: `/${week.logged || 7}` })),
          el('span', { class: 'stat__label', text: 'Kalorien getroffen' })),
        el('div', { class: 'stat' },
          el('span', { class: 'stat__value', text: String(week.proteinHits) },
            el('span', { class: 'stat__unit', text: `/${week.logged || 7}` })),
          el('span', { class: 'stat__label', text: 'Protein erreicht' }))),
      el('div', { style: 'height: var(--space-4)' }),
      week.node,
      el('p', { class: 'card__note' },
        `Getroffen heißt: Kalorien innerhalb ±${Math.round(HIT_TOLERANCE * 100)} % `
        + `vom Ziel, Protein mindestens ${Math.round(PROTEIN_FLOOR * 100)} % — `
        + 'nach oben ist Protein offen.')));
}
