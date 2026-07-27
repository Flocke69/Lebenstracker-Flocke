/* Review — Befunde, Vergleich, Übergabe.
 *
 * Die App zeigt, was ihre Regeln erkennen. Der Knopf „Für Claude kopieren"
 * legt zusätzlich die Rohzahlen in die Zwischenablage — denn die App sieht
 * nur, was vorher als Regel hineingeschrieben wurde. Muster wie „die
 * schlechten Nächte liegen immer donnerstags" fallen ihr nicht auf.
 */

import { todayKey, weekStartKey, addDays, formatDayShort, monthKey, formatMonth }
  from '../lib/dates.js';
import { weeklyReview, monthlyReview, toMarkdown, daysToMarkdown } from '../lib/review.js';
import { monthDays, weekKeys } from '../lib/dates.js';
import { LOW_READINESS, SHORT_SLEEP_H } from '../lib/aggregate.js';
import { MUSCLE_GROUPS } from '../../data/exercises.js';
import { el, replace, card, int, dec, stat } from './dom.js';

const SEVERITY_WORD = {
  alarm: 'Dringend',
  warn: 'Achtung',
  info: 'Hinweis',
  good: 'In Ordnung',
};

/* ─── Befunde ────────────────────────────────────────────────────────────── */

function flagCard(f) {
  return el('div', { class: `finding finding--${f.severity}` },
    el('div', { class: 'finding__head' },
      // Immer ein WORT zur Farbe — nie Farbe allein.
      el('span', { class: 'finding__severity', text: SEVERITY_WORD[f.severity] }),
      el('span', { class: 'finding__title', text: f.title })),
    el('p', { class: 'finding__detail', text: f.detail }),
    f.action ? el('p', { class: 'finding__action', text: f.action }) : null);
}

/* ─── Kennzahlen ─────────────────────────────────────────────────────────── */

function deltaText(value, unit, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${dec(value, digits)}${unit ? ` ${unit}` : ''}`;
}

function numbersCard(review) {
  const s = review.summary;
  const c = review.comparison;

  return card('Zahlen',
    el('span', { class: 'chip', text: `${s.period.dayCount} Tage` }),
    el('div', { class: 'stat-grid' },
      stat('Gewicht Ø', dec(s.weight.last, 1), 'kg'),
      stat('Bereitschaft Ø', s.readiness.avg === null ? '—' : int(s.readiness.avg)),
      stat('Schlaf Ø', dec(s.sleep.avg, 1), 'h'),
      stat('Sätze', int(s.training.sets))),
    el('hr'),
    el('div', { class: 'table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: '' }),
          el('th', { text: 'Jetzt' }),
          el('th', { text: 'Davor' }))),
        el('tbody', null,
          el('tr', null,
            el('td', { text: 'Gewichtstrend' }),
            el('td', { text: deltaText(s.weight.delta, 'kg') }),
            el('td', { text: deltaText(review.previous.weight.delta, 'kg') })),
          el('tr', null,
            el('td', { text: 'Bereitschaft' }),
            el('td', { text: s.readiness.avg === null ? '—' : int(s.readiness.avg) }),
            el('td', { text: deltaText(c.readiness, '', 0) })),
          el('tr', null,
            el('td', { text: 'Sätze' }),
            el('td', { text: int(s.training.sets) }),
            el('td', { text: deltaText(c.sets, '', 0) })),
          el('tr', null,
            el('td', { text: 'Tonnage' }),
            el('td', { text: `${int(s.training.tonnage)} kg` }),
            el('td', { text: deltaText(c.tonnage, 'kg', 0) })),
          el('tr', null,
            el('td', { text: 'Kalorien Ø' }),
            el('td', { text: int(s.nutrition.kcalAvg) }),
            el('td', { text: deltaText(c.kcal, '', 0) })),
          el('tr', null,
            el('td', { text: 'Protein Ø' }),
            el('td', { text: `${int(s.nutrition.proteinAvg)} g` }),
            el('td', { text: deltaText(c.protein, 'g', 0) }))))),
    el('p', { class: 'card__note' },
      'Die Spalte „Davor" ist die Veränderung gegenüber der Vorperiode, '
      + 'nicht deren Absolutwert.'));
}

function volumeCard(review) {
  const volume = review.summary.training.volume;
  const rows = Object.entries(volume)
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1]);

  if (rows.length === 0) {
    return card('Volumen', null,
      el('p', { class: 'field__hint', text: 'Keine Sätze in diesem Zeitraum geloggt.' }));
  }

  const max = rows[0][1];
  return card('Volumen je Muskelgruppe',
    el('span', { class: 'chip', text: `${int(review.summary.training.sets)} Sätze` }),
    rows.map(([key, sets]) => {
      const diff = review.comparison.volume?.[key];
      return el('div', { class: 'macro' },
        el('div', { class: 'macro__head' },
          el('span', { class: 'macro__name', text: MUSCLE_GROUPS[key] }),
          el('span', { class: 'macro__value' },
            dec(sets, 1),
            el('span', { class: 'stat__unit', text: ` (${deltaText(diff, '', 1)})` }))),
        el('div', { class: 'macro__track' },
          el('div', {
            class: 'macro__fill',
            style: `width: ${((sets / max) * 100).toFixed(1)}%`,
          })));
    }));
}

/* ─── Übergabe ───────────────────────────────────────────────────────────── */

function copyCard(review, state, keys) {
  const slot = el('div');

  async function copy(withRawDays) {
    const text = withRawDays
      ? `${toMarkdown(review, state)}\n\n## Rohdaten je Tag\n\n${daysToMarkdown(state, keys)}`
      : toMarkdown(review, state);

    try {
      await navigator.clipboard.writeText(text);
      replace(slot, el('p', { class: 'field__hint', text: 'Kopiert. Füg es hier im Chat ein.' }));
    } catch {
      // Ohne Zwischenablage-Recht bleibt der Text zum Markieren stehen.
      replace(slot,
        el('p', { class: 'field__hint', text: 'Kopieren nicht erlaubt — Text markieren:' }),
        el('textarea', { rows: 12, readOnly: true, value: text }));
    }
  }

  return card('Für Claude kopieren',
    el('span', { class: 'chip', text: 'Markdown' }),
    el('p', { class: 'field__hint' },
      'Die App erkennt nur, was als Regel in ihr steht. Der Block enthält '
      + 'deshalb auch die Rohzahlen — Muster wie „die schlechten Nächte liegen '
      + 'immer donnerstags" sieht sie nicht, ich schon.'),
    el('div', { style: 'height: var(--space-4)' }),
    el('button', {
      type: 'button', class: 'btn btn--primary btn--block',
      text: 'Review kopieren', onclick: () => copy(false),
    }),
    el('div', { style: 'height: var(--space-2)' }),
    el('button', {
      type: 'button', class: 'btn btn--block',
      text: 'Mit Rohdaten je Tag', onclick: () => copy(true),
    }),
    slot);
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();

  // Welcher Zeitraum? Voreinstellung ist die laufende Woche.
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const mode = params.get('mode') === 'month' ? 'month' : 'week';
  const offset = Number(params.get('offset') ?? 0);

  const anchor = mode === 'week'
    ? addDays(weekStartKey(today), offset * 7)
    : today;
  const mk = mode === 'month'
    ? (() => {
      const d = new Date();
      d.setMonth(d.getMonth() + offset);
      return monthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    })()
    : null;

  const review = mode === 'week' ? weeklyReview(state, anchor) : monthlyReview(state, mk);
  const keys = mode === 'week' ? weekKeys(anchor) : monthDays(mk);

  const go = (m, o) => { location.hash = `#/review?mode=${m}&offset=${o}`; };

  return el('div', { class: 'view' },
    el('h1', { text: 'Review' }),

    el('div', { class: 'seg', style: 'margin-bottom: var(--space-4)' },
      el('label', { class: 'seg__opt' },
        el('input', { type: 'radio', name: 'mode', checked: mode === 'week',
                      onchange: () => go('week', 0) }),
        el('span', { text: 'Woche' })),
      el('label', { class: 'seg__opt' },
        el('input', { type: 'radio', name: 'mode', checked: mode === 'month',
                      onchange: () => go('month', 0) }),
        el('span', { text: 'Monat' }))),

    el('div', { class: 'pager' },
      el('button', { type: 'button', class: 'btn btn--small',
                     text: '‹ davor', onclick: () => go(mode, offset - 1) }),
      el('span', { class: 'pager__label', text: review.title }),
      el('button', {
        type: 'button', class: 'btn btn--small', text: 'danach ›',
        disabled: offset >= 0,
        onclick: () => go(mode, offset + 1),
      })),

    el('h3', { text: `${review.flags.length} Befund${review.flags.length === 1 ? '' : 'e'}` }),
    review.flags.map(flagCard),

    numbersCard(review),
    volumeCard(review),

    review.stagnating.length
      ? card('Ohne Fortschritt',
        el('span', { class: 'chip', text: `${review.stagnating.length}` }),
        el('ul', null,
          review.stagnating.map((s) =>
            el('li', null,
              el('strong', { text: s.name }),
              ` — geschätzte Maximalkraft ${dec(s.from, 1)} → ${dec(s.to, 1)} kg `,
              `über ${s.weeks} Wochen`))),
        el('p', { class: 'card__note' },
          'Geschätzt nach Epley aus dem besten Satz. Damit sind 10×20 kg und '
          + '5×24 kg vergleichbar — sonst lässt sich Fortschritt nicht messen.'))
      : null,

    copyCard(review, state, keys),

    el('p', { class: 'field__hint' },
      `Schwellen: Schlaf unter ${dec(SHORT_SLEEP_H, 1)} h, Bereitschaft unter `,
      `${LOW_READINESS}, Protein unter 85 % des Ziels. Alle Regeln stehen in `,
      'js/lib/review.js und sind nachlesbar.'));
}
