/* Der tägliche Check-in.
 *
 * VIER FRAGEN, IN EINEM FENSTER. Auf dem Heute-Screen steht nur eine Karte
 * "Check-in"; angetippt öffnet sich das Fenster, "Abgeschlossen" schließt es
 * wieder. Der Grund ist banal und entscheidend: was dauerhaft auf dem
 * Hauptscreen liegt, wird nach zwei Wochen überlesen. Was sich öffnet und
 * wieder zugeht, ist eine Handlung mit Anfang und Ende.
 *
 * Schlafdauer als Zahl, alles andere als Fünferskala zum Antippen. Keine
 * Schieberegler — auf dem Handy ist Tippen schneller und trifft sicherer als
 * Ziehen.
 *
 * Jede Eingabe speichert sofort. Der Knopf unten schließt nur das Fenster, er
 * sendet nichts ab: ein Absenden-Knopf, der vergessen werden kann, kostet
 * irgendwann einen Tag Daten.
 */

import { CHECKIN_FIELDS, readinessScore } from '../lib/readiness.js';
import { getDay } from '../lib/state.js';
import { formatDayLong, todayKey } from '../lib/dates.js';
import { el, decimalInput, parseDecimal, toInputValue } from './dom.js';
import { openSheet } from './sheet.js';
import { readinessArc, factorBars } from './gauge.js';

const SCALE = [1, 2, 3, 4, 5];

/**
 * Check-in-Feld schreiben und die Bereitschaft gleich mitspeichern.
 *
 * Der Score wird abgelegt statt jedes Mal neu gerechnet, damit Trends und
 * Reviews später nicht von der aktuellen Gewichtung abhängen — ein im Juli
 * erfasster Tag behält seinen Juli-Score. Angezeigt wird er nie.
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
  const hint = el('p', { class: 'field__hint' });

  const input = decimalInput({
    id,
    placeholder: '7,5',
    value: toInputValue(value),
    onchange: (e) => {
      const num = parseDecimal(e.target.value);
      if (num === null) {
        hint.textContent = e.target.value.trim() === ''
          ? '' : 'Bitte eine Zahl eintragen, z. B. 7,5.';
        return;
      }
      if (num < field.min || num > field.max) {
        // Nicht still verwerfen: sonst tippt man 75 statt 7,5 und wundert sich.
        hint.textContent = `${field.min} bis ${field.max} Stunden — ${toInputValue(num)} `
          + 'kann nicht stimmen.';
        return;
      }
      hint.textContent = '';
      saveField(store, dayKey, field.key, num);
    },
  });

  return el('div', { class: 'question' },
    el('label', { class: 'question__text', for: id, text: field.question }),
    el('div', { class: 'question__hours' },
      input,
      el('span', { class: 'question__unit', text: 'Stunden' })),
    hint);
}

function scaleRow(store, dayKey, field, value) {
  return el('div', { class: 'question' },
    el('span', { class: 'question__text', text: field.question }),
    el('fieldset', { class: 'seg seg--scale' },
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
    // Hoch ist bei Muskelkater und Stress schlecht — das muss dranstehen,
    // sonst tippt man aus Gewohnheit die 5.
    el('div', { class: 'question__poles' },
      el('span', { text: `1 = ${field.low}` }),
      el('span', { text: `5 = ${field.high}` })));
}

/** Die vier Fragen als Block — ohne eigene Karte, damit er überall passt. */
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

/** Kurzfassung für die Karte auf dem Heute-Screen. */
export function checkinSummary(store, dayKey) {
  const checkin = getDay(store.getState(), dayKey).checkin ?? {};
  const parts = CHECKIN_FIELDS
    .filter((f) => checkin[f.key] !== null && checkin[f.key] !== undefined)
    .map((f) => (f.kind === 'hours'
      ? `${String(checkin[f.key]).replace('.', ',')} h Schlaf`
      : `${f.label} ${checkin[f.key]}`));
  return parts.join(' · ');
}

/**
 * Das Fenster.
 *
 * Oben die Grafik, damit man beim Antippen sofort sieht, was sich ändert —
 * unten die Fragen. Wer die vierte Frage beantwortet, sieht die Grafik im
 * selben Moment umspringen; das ist die ganze Rückmeldung, die es braucht.
 */
export function openCheckin(store, dayKey) {
  const isToday = dayKey === todayKey();

  openSheet({
    store,
    eyebrow: isToday ? 'Check-in heute' : `Check-in nachtragen`,
    title: isToday ? 'Wie geht es dir?' : formatDayLong(dayKey),
    doneLabel: 'Abgeschlossen',
    body: () => {
      const readiness = readinessScore(getDay(store.getState(), dayKey).checkin);
      return el('div', null,
        el('div', { class: 'sheet__hero' },
          readinessArc(readiness),
          factorBars(readiness)),
        checkinFields(store, dayKey),
        readiness.isComplete
          ? el('p', { class: 'field__hint', text: 'Alles beantwortet. Fenster kann zu.' })
          : el('p', { class: 'field__hint' },
            `Noch ${readiness.missing.length} von ${CHECKIN_FIELDS.length} offen. `,
            'Halb ausgefüllt zählt auch — die App rechnet mit dem, was da ist.'));
    },
  });
}
