/* Der tägliche Check-in.
 *
 * Muss in unter einer Minute erledigt sein, sonst wird er nach zwei Wochen
 * nicht mehr gemacht. Deshalb: Schlafdauer als Zahl, alles andere als
 * Fünferskala zum Antippen. Keine Schieberegler — auf dem Handy ist Tippen
 * schneller und trifft sicherer als Ziehen.
 *
 * Jede Eingabe speichert sofort. Kein Absenden-Knopf, der vergessen werden
 * kann.
 */

import { CHECKIN_FIELDS, readinessScore } from '../lib/readiness.js';
import { getDay } from '../lib/state.js';
import { el, decimalInput, parseDecimal, toInputValue } from './dom.js';

const SCALE = [1, 2, 3, 4, 5];

/**
 * Check-in-Feld schreiben und die Bereitschaft gleich mitspeichern.
 *
 * Der Score wird abgelegt statt jedes Mal neu gerechnet, damit Trends und
 * Reviews später nicht von der aktuellen Gewichtung abhängen — ein im Juli
 * erfasster Tag behält seinen Juli-Score.
 */
function saveField(store, dayKey, key, value) {
  const previous = getDay(store.getState(), dayKey).checkin ?? {};
  const merged = { ...previous, [key]: value };
  const { score } = readinessScore(merged);
  store.setDay(dayKey, {
    checkin: { [key]: value },
    readiness: score === null ? null : Math.round(score * 10) / 10,
  });
}

function hoursRow(store, dayKey, field, value) {
  const id = `checkin-${field.key}`;
  const input = decimalInput({
    id,
    placeholder: '7,5',
    value: toInputValue(value),
    onchange: (e) => {
      const num = parseDecimal(e.target.value);
      if (num === null) return;
      if (num < field.min || num > field.max) {
        e.target.value = '';
        return;
      }
      saveField(store, dayKey, field.key, num);
    },
  });

  return el('div', { class: 'checkin__row' },
    el('div', { class: 'checkin__label' },
      el('label', { class: 'checkin__name', for: id, text: field.label }),
      el('span', { class: 'eyebrow', text: 'Stunden' })),
    input);
}

function scaleRow(store, dayKey, field, value) {
  return el('div', { class: 'checkin__row' },
    el('div', { class: 'checkin__label' },
      el('span', { class: 'checkin__name', text: field.label }),
      // Hoch ist bei Muskelkater und Stress schlecht — das muss dranstehen,
      // sonst tippt man aus Gewohnheit die 5.
      el('span', {
        class: 'eyebrow',
        text: field.higherIsBetter ? 'mehr ist besser' : 'mehr ist schlechter',
      })),
    el('fieldset', { class: 'seg' },
      SCALE.map((n) =>
        el('label', { class: 'seg__opt' },
          el('input', {
            type: 'radio',
            name: `${dayKey}-${field.key}`,
            value: String(n),
            checked: value === n,
            onchange: () => saveField(store, dayKey, field.key, n),
          }),
          el('span', { text: String(n) })))),
    el('div', { class: 'checkin__poles' },
      el('span', { text: field.low }),
      el('span', { text: field.high })));
}

/** Die Felder als Block — ohne eigene Karte, damit er überall passt. */
export function checkinFields(store, dayKey) {
  const checkin = getDay(store.getState(), dayKey).checkin ?? {};
  return el('div', { class: 'checkin' },
    CHECKIN_FIELDS.map((field) => {
      const value = checkin[field.key] ?? null;
      return field.kind === 'hours'
        ? hoursRow(store, dayKey, field, value)
        : scaleRow(store, dayKey, field, value);
    }));
}

/** Kurzfassung für den zugeklappten Zustand. */
export function checkinSummary(store, dayKey) {
  const checkin = getDay(store.getState(), dayKey).checkin ?? {};
  const parts = CHECKIN_FIELDS
    .filter((f) => checkin[f.key] !== null && checkin[f.key] !== undefined)
    .map((f) => f.kind === 'hours'
      ? `${String(checkin[f.key]).replace('.', ',')} h`
      : `${f.label} ${checkin[f.key]}`);
  return parts.join(' · ');
}
