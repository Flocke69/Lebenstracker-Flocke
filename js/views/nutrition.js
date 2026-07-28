/* Essen — zwei Abschnitte: Essen und Makros, darunter Gewicht.
 *
 * AUFGETEILT UND ZUGEKLAPPT. Vorher lagen fünf Karten hintereinander und man
 * hat sich durch den Screen gescrollt, um an den Gewichtsverlauf zu kommen.
 * Jetzt sieht man zwei Zeilen mit je einem Urteil und öffnet, was einen
 * interessiert. Das Urteil steht dabei AUF dem zugeklappten Kopf — sonst müsste
 * man aufklappen, um zu wissen, ob es sich lohnt.
 *
 * DIE MAKROS KOMMEN NICHT AUS DIESER APP. Flocke trägt sie in Yazio ein und
 * bringt einmal pro Woche vier Zahlen mit: den Wochendurchschnitt. Genau die
 * werden hier eingetragen, gegen das Wochenziel gestellt und mit einem Urteil
 * versehen. Gegen Yazio eine Lebensmitteldatenbank zu bauen wäre verlorene
 * Zeit; das Wochenmittel daneben zu legen ist die Arbeit, die Yazio nicht tut.
 *
 * Und hier steht das GEWICHT: der Streifen der Woche und der Gesamtverlauf.
 * Eingetragen wird es auf dem Heute-Screen — hier wird es ausgewertet. Beides
 * am selben Ort wäre bequemer und schlechter: der Verlauf ist keine Eingabe.
 *
 * Die Tageseingabe der Makros bleibt zugeklappt erhalten. Wer an einem
 * einzelnen Tag genauer hinsehen will, kann; die Auswertung hängt nicht davon
 * ab.
 */

import {
  todayKey, weekKeys, weekdayShort, formatDayShort, weekStartKey, addDays,
  daysBetween, formatDayLong,
} from '../lib/dates.js';
import { getDay, weightOn, dayTypeFor, kcalFromMacros } from '../lib/state.js';
import { dayTargets, DAY_TYPE_LABELS, ageOn, KCAL_PER_G } from '../lib/energy.js';
import {
  series, movingAverage, countKnown, WEIGHT_WINDOW, loggedKeys,
} from '../lib/aggregate.js';
import { weekCheck, weekHistory, WEEK_FIELDS } from '../lib/weekly.js';
import { lineChart } from './chart.js';
import {
  el, replace, card, panel, int, dec, decimalInput, parseDecimal, toInputValue,
} from './dom.js';

/** Innerhalb dieser Spanne um das Ziel gilt ein TAG als getroffen. */
export const HIT_TOLERANCE = 0.1;   // ±10 %
/** Protein gilt ab diesem Anteil des Ziels als erfüllt — nach oben offen. */
export const PROTEIN_FLOOR = 0.9;

const DAY_FIELDS = [
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

/** Hat der Tag das Ziel getroffen? null, wenn nichts eingetragen ist. */
export function hitStatus(actual, target, { floorOnly = false } = {}) {
  if (typeof actual !== 'number' || !(target > 0)) return null;
  const ratio = actual / target;
  if (floorOnly) return ratio >= PROTEIN_FLOOR;
  return ratio >= 1 - HIT_TOLERANCE && ratio <= 1 + HIT_TOLERANCE;
}

/* ─── Tagesziel ──────────────────────────────────────────────────────────── */

function macroRow(name, grams, kcalPerG, totalKcal, tone) {
  const share = totalKcal > 0 ? (grams * kcalPerG) / totalKcal : 0;
  return el('div', { class: 'macro' },
    el('div', { class: 'macro__head' },
      el('span', { class: 'macro__name', text: name }),
      el('span', { class: 'macro__value' }, int(grams), ' g')),
    el('div', {
      class: 'macro__track',
      role: 'img',
      'aria-label': `${name}: ${int(grams)} g, ${Math.round(share * 100)} Prozent der Kalorien`,
    },
      el('div', {
        class: `macro__fill macro__fill--${tone}`,
        style: `width: ${(share * 100).toFixed(1)}%`,
      })));
}

/**
 * Das Ziel für heute.
 *
 * Stand vorher auf dem Startscreen und ist hierher gewandert: morgens
 * beantwortet die Zahl keine Frage, beim Eintragen des Wochenschnitts schon —
 * dort braucht man sie als Bezugsgröße.
 */
function todayTargetCard(state, today) {
  const dayType = dayTypeFor(state, today);

  let t;
  try {
    t = targetsFor(state, today);
  } catch (err) {
    return el('div', { class: 'notice notice--error' },
      el('span', { class: 'notice__title', text: 'Ziele nicht berechenbar' }),
      err.message);
  }

  return card('Ziel heute',
    el('span', { class: `chip chip--daytype chip--${dayType}`, text: DAY_TYPE_LABELS[dayType] }),
    el('div', { class: 'kcal-hero' },
      el('span', { class: 'kcal-hero__value' }, int(t.kcal),
        el('span', { class: 'kcal-hero__unit', text: 'kcal' })),
      el('span', { class: 'kcal-hero__note', text: `Faktor ${dec(t.factor, 2)}` })),
    macroRow('Protein', t.proteinG, KCAL_PER_G.protein, t.kcal, 'protein'),
    macroRow('Kohlenhydrate', t.carbsG, KCAL_PER_G.carb, t.kcal, 'carbs'),
    macroRow('Fett', t.fatG, KCAL_PER_G.fat, t.kcal, 'fat'),
    el('p', { class: 'card__note' },
      'Protein und Fett hängen nur am Körpergewicht — die Kohlenhydrate tragen ',
      'die ganze Periodisierung. Deshalb ist der Unterschied zwischen Ruhetag ',
      'und Spieltag dort am größten.'));
}

/* ─── Gewicht: die Woche ─────────────────────────────────────────────────── */

function weightWeekCard(state, today) {
  const keys = weekKeys(today);
  const raw = series(state, keys, (d) => d.weightKg);
  const measured = countKnown(raw);
  const known = raw.filter((v) => typeof v === 'number');
  const lo = known.length ? Math.min(...known) : 0;
  const hi = known.length ? Math.max(...known) : 1;
  const span = hi - lo || 1;

  const tone = measured >= 6 ? 'good' : measured >= 3 ? 'ok' : 'bad';

  return el('div', { class: `card card--tone card--${tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Gewicht diese Woche' }),
      el('span', { class: `chip chip--${tone}`, text: `${measured} von 7 Tagen` })),

    measured === 0
      ? el('p', { class: 'field__hint' },
        'Noch nichts gewogen. Eingetragen wird es im Reiter Heute — am besten ',
        'morgens nach dem Aufstehen.')
      : el('div', null,
        el('div', { class: 'weightstrip weightstrip--tall' },
          keys.map((key, i) => {
            const value = raw[i];
            const has = typeof value === 'number';
            const height = has ? 20 + ((value - lo) / span) * 60 : 0;
            return el('div', {
              class: `weightstrip__col${key === today ? ' weightstrip__col--shown' : ''}`,
            },
              el('span', { class: 'weightstrip__value', text: has ? dec(value, 1) : '—' }),
              el('div', { class: 'weightstrip__bar-wrap' },
                has
                  ? el('div', { class: 'weightstrip__bar', style: `height: ${height.toFixed(0)}%` })
                  : el('div', { class: 'weightstrip__gap' })),
              el('span', { class: 'weightstrip__day', text: weekdayShort(key) }));
          })),
        el('p', { class: 'card__note' },
          measured < 7
            ? `An ${7 - measured} ${7 - measured === 1 ? 'Tag' : 'Tagen'} fehlt der Wert. `
              + 'Der 7-Tage-Schnitt verträgt Lücken, aber je weniger, desto ruhiger die Linie.'
            : 'Jeden Tag gewogen. Damit ist der Schnitt so belastbar, wie er werden kann.')));
}

/* ─── Gewicht: der Gesamtverlauf ─────────────────────────────────────────── */

/**
 * Alles, was je gewogen wurde — Flockes „Grafik mit dem Gesamtverlauf".
 *
 * Die Achse läuft vom ersten Messtag bis heute, ohne Lücken zu überspringen:
 * eine Pause von zwei Wochen muss als Pause zu sehen sein und nicht als
 * gerade Linie.
 */
function weightTrendCard(state, today) {
  const measuredKeys = loggedKeys(state)
    .filter((key) => typeof getDay(state, key).weightKg === 'number');

  if (measuredKeys.length === 0) {
    return card('Gesamtverlauf', null,
      el('p', { class: 'field__hint' },
        'Sobald an zwei Tagen ein Gewicht steht, wächst hier die Linie.'));
  }

  const first = measuredKeys[0];
  const dayCount = Math.max(daysBetween(first, today) + 1, 2);
  const keys = Array.from({ length: dayCount }, (_, i) => addDays(first, i));

  const raw = series(state, keys, (d) => d.weightKg);
  const avg = movingAverage(raw, WEIGHT_WINDOW);
  const knownAvg = avg.filter((v) => typeof v === 'number');
  const delta = knownAvg.length >= 2 ? knownAvg[knownAvg.length - 1] - knownAvg[0] : null;
  const spanWeeks = Math.max(1, Math.round(dayCount / 7));

  const tone = delta === null ? 'idle' : Math.abs(delta) <= 0.5 ? 'good' : 'ok';

  return el('div', { class: `card card--tone card--${tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Gesamtverlauf' }),
      el('span', { class: 'chip', text: `${spanWeeks} ${spanWeeks === 1 ? 'Woche' : 'Wochen'}` })),

    lineChart({
      keys, raw, avg, series: 'weight',
      title: 'Gewicht in Kilogramm über den gesamten Zeitraum',
      unit: 'kg', digits: 1, height: 170,
    }),

    el('div', { class: 'statrow' },
      el('div', { class: 'statrow__cell' },
        el('span', { class: 'statrow__value', text: dec(knownAvg[0], 1) }),
        el('span', { class: 'statrow__label', text: `ab ${formatDayShort(first)}` })),
      el('div', { class: 'statrow__cell' },
        el('span', { class: 'statrow__value', text: dec(knownAvg[knownAvg.length - 1], 1) }),
        el('span', { class: 'statrow__label', text: 'jetzt' })),
      el('div', { class: 'statrow__cell' },
        el('span', {
          class: `statrow__value statrow__value--${tone}`,
          text: delta === null ? '—' : `${delta > 0 ? '+' : ''}${dec(delta, 1)}`,
        }),
        el('span', { class: 'statrow__label', text: 'Veränderung' }))),

    el('p', { class: 'card__note' },
      'Die farbige Linie ist der 7-Tage-Schnitt und die eigentliche Aussage. ',
      'Die Punkte sind Tageswerte — sie schwanken um mehr, als in einer Woche ',
      'an Fett dazukommen kann.'));
}

/* ─── Yazio-Wochenschnitt ────────────────────────────────────────────────── */

function weekInput(store, weekStart, field, value) {
  const id = `week-${field.key}`;
  const hint = el('div');

  return el('div', null,
    el('label', { for: id, text: `${field.label} (${field.unit})` }),
    decimalInput({
      id,
      value: toInputValue(value),
      placeholder: '—',
      onchange: (e) => {
        replace(hint);
        const n = parseDecimal(e.target.value);
        try {
          store.setWeekMacros(weekStart, { [field.key]: n });
        } catch (err) {
          e.target.value = toInputValue(value);
          replace(hint, el('p', { class: 'field__hint', text: err.message }));
        }
      },
    }),
    hint);
}

function yazioCard(store, state, today) {
  const check = weekCheck(state, today);
  const weekStart = check.weekStart;
  const isCurrentWeek = weekStart === weekStartKey(today);

  const worst = check.fields.reduce((acc, f) => {
    const rank = { bad: 3, ok: 2, good: 1, idle: 0 };
    return rank[f.tone] > rank[acc] ? f.tone : acc;
  }, 'idle');
  const tone = check.hasEntry ? (worst === 'idle' ? 'good' : worst) : 'idle';

  /* Der Chip trägt das URTEIL, nicht den Erfassungsstand. Ein rotes
     „eingetragen" wäre widersprüchlich: eingetragen ist gut, die Farbe sagt
     schlecht. Also sagt der Chip dasselbe wie die Farbe. */
  const VERDICT_WORD = { good: 'passt', ok: 'knapp daneben', bad: 'daneben', idle: 'offen' };

  return el('div', { class: `card card--tone card--${tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Wochenschnitt aus Yazio' }),
      el('span', {
        class: `chip chip--${check.hasEntry ? tone : 'idle'}`,
        text: check.hasEntry ? VERDICT_WORD[tone] : 'offen',
      })),

    el('p', { class: 'field__hint' },
      `Woche ab ${formatDayShort(weekStart)}`,
      isCurrentWeek ? ' (läuft noch)' : '',
      '. Vier Zahlen aus Yazio — der Durchschnitt, nicht ein einzelner Tag.'),
    el('div', { style: 'height: var(--space-3)' }),

    el('div', { class: 'field__row' },
      weekInput(store, weekStart, WEEK_FIELDS[0], check.actual.kcal),
      weekInput(store, weekStart, WEEK_FIELDS[1], check.actual.proteinG)),
    el('div', { style: 'height: var(--space-4)' }),
    el('div', { class: 'field__row' },
      weekInput(store, weekStart, WEEK_FIELDS[2], check.actual.carbsG),
      weekInput(store, weekStart, WEEK_FIELDS[3], check.actual.fatG)),

    el('hr'),

    /* Das Urteil je Makro: Ist, Ziel, Abweichung und ein Wort. Vier Zeilen
       statt einer Tabelle mit acht Spalten — auf 375 px liest man Zeilen. */
    el('div', { class: 'judge' },
      check.fields.map((f) => el('div', { class: `judge__row judge__row--${f.tone}` },
        el('span', { class: 'judge__name', text: f.field.label }),
        el('span', { class: 'judge__values' },
          f.actual === null ? '—' : int(f.actual),
          el('span', { class: 'judge__target', text: ` / ${f.target === null ? '—' : int(f.target)} ${f.field.unit}` })),
        el('span', { class: `judge__word judge__word--${f.tone}`, text: f.word }),
        el('span', {
          class: 'judge__delta',
          text: f.delta === null ? '' : `${f.delta > 0 ? '+' : ''}${int(f.delta)}`,
        })))),

    el('div', { class: `notice notice--${check.suggestion.tone === 'good' ? 'good' : 'warn'}` },
      el('span', { class: 'notice__title', text: 'Anpassung' }),
      check.suggestion.reason,
      check.suggestion.change !== 0
        ? el('div', null,
          el('div', { style: 'height: var(--space-3)' }),
          el('button', {
            type: 'button', class: 'btn btn--primary btn--small',
            text: `Ziel auf ${check.suggestion.newOffset > 0 ? '+' : ''}${check.suggestion.newOffset} kcal setzen`,
            onclick: () => {
              try {
                store.setProfile({ kcalOffset: check.suggestion.newOffset });
              } catch (err) {
                console.warn('[nutrition]', err.message);
              }
            },
          }))
        : null),

    check.drift.deltaKg !== null
      ? el('p', { class: 'card__note' },
        `Grundlage: der 7-Tage-Gewichtsschnitt hat sich in zwei Wochen um `
        + `${check.drift.deltaKg > 0 ? '+' : ''}${dec(check.drift.deltaKg, 1)} kg bewegt.`)
      : el('p', { class: 'card__note' },
        'Für den Gewichtstrend fehlen noch Messwerte — dafür braucht es rund '
        + 'drei Wochen mit täglichem Wiegen.'));
}

/* ─── Verlauf der Wochenschnitte ─────────────────────────────────────────── */

function weekHistoryCard(state, today) {
  const history = weekHistory(state, today, 6, today);
  const filled = history.filter((h) => typeof h.macros.kcal === 'number');

  if (history.length === 0 || filled.length === 0) {
    return card('Wochen im Vergleich', null,
      el('p', { class: 'field__hint' },
        'Ab der zweiten eingetragenen Woche steht hier der Vergleich. Das ist ',
        'die Zahl, an der man Anpassungen tatsächlich ablesen kann.'));
  }

  return card('Wochen im Vergleich',
    el('span', {
      class: 'chip',
      text: `${filled.length} ${filled.length === 1 ? 'Woche' : 'Wochen'}`,
    }),
    el('div', { class: 'table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Woche ab' }),
          el('th', { text: 'kcal' }),
          el('th', { text: 'Protein' }),
          el('th', { text: 'KH' }),
          el('th', { text: 'Fett' }))),
        el('tbody', null,
          history.map(({ weekStart, macros }) => el('tr', {
            class: weekStart === weekStartKey(today) ? 'is-today' : null,
          },
            el('td', { text: formatDayShort(weekStart) }),
            el('td', { text: typeof macros.kcal === 'number' ? int(macros.kcal) : '—' }),
            el('td', { text: typeof macros.proteinG === 'number' ? int(macros.proteinG) : '—' }),
            el('td', { text: typeof macros.carbsG === 'number' ? int(macros.carbsG) : '—' }),
            el('td', { text: typeof macros.fatG === 'number' ? int(macros.fatG) : '—' })))))),
    el('p', { class: 'card__note' },
      'Die letzte Zeile ist die laufende Woche — sie ist noch nicht fertig.'));
}

/* ─── Tageseingabe, zugeklappt ───────────────────────────────────────────── */

function dayInput(store, dayKey, field, value) {
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

function dayDetailCard(store, state, today) {
  const day = getDay(state, today);
  const n = day.nutrition ?? {};
  const t = targetsFor(state, today);
  const computed = kcalFromMacros(n);
  const mismatch =
    computed !== null && typeof n.kcal === 'number' && Math.abs(computed - n.kcal) > 100;

  const keys = weekKeys(today);
  const rows = keys.map((key) => {
    const d = getDay(state, key);
    const dayTarget = targetsFor(state, key);
    const nutrition = d.nutrition ?? {};
    const kcalHit = hitStatus(nutrition.kcal, dayTarget.kcal);
    const proteinHit = hitStatus(nutrition.proteinG, dayTarget.proteinG, { floorOnly: true });
    const mark = (hit) => (hit === null ? '·' : hit ? '✓' : '✕');
    const cls = (hit) => (hit === null ? '' : hit ? 'is-good' : 'is-bad');

    return el('tr', { class: key === today ? 'is-today' : null },
      el('td', { text: `${weekdayShort(key)} ${formatDayShort(key)}` }),
      el('td', { text: typeof nutrition.kcal === 'number' ? int(nutrition.kcal) : '—' }),
      el('td', { text: int(dayTarget.kcal) }),
      el('td', { class: cls(kcalHit), text: mark(kcalHit) }),
      el('td', { class: cls(proteinHit), text: mark(proteinHit) }));
  });

  return el('details', { class: 'reveal', dataset: { keep: 'daydetail' } },
    el('summary', null, el('span', { text: 'Einzelne Tage — wenn du genauer hinsehen willst' })),
    el('div', { class: 'reveal__body' },
      el('p', { class: 'field__hint' },
        formatDayLong(today), ' · Ziel ', int(t.kcal), ' kcal ',
        `(${DAY_TYPE_LABELS[dayTypeFor(state, today)]})`),
      el('div', { style: 'height: var(--space-3)' }),
      el('div', { class: 'field__row' },
        dayInput(store, today, DAY_FIELDS[0], n.kcal),
        dayInput(store, today, DAY_FIELDS[1], n.proteinG)),
      el('div', { style: 'height: var(--space-4)' }),
      el('div', { class: 'field__row' },
        dayInput(store, today, DAY_FIELDS[2], n.carbsG),
        dayInput(store, today, DAY_FIELDS[3], n.fatG)),
      mismatch
        ? el('p', { class: 'field__hint' },
          `Aus deinen Makros ergeben sich ${int(computed)} kcal, eingetragen sind `
          + `${int(n.kcal)}. Für die Auswertung zählt der Kalorienwert.`)
        : null,
      el('div', { style: 'height: var(--space-4)' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'Tag' }),
            el('th', { text: 'Ist' }),
            el('th', { text: 'Ziel' }),
            el('th', { text: 'kcal' }),
            el('th', { text: 'Prot.' }))),
          el('tbody', null, rows))),
      el('p', { class: 'card__note' },
        `Getroffen heißt: Kalorien innerhalb ±${Math.round(HIT_TOLERANCE * 100)} % `
        + `vom Ziel, Protein mindestens ${Math.round(PROTEIN_FLOOR * 100)} %.`)));
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

/** Das Urteil, das auf dem zugeklappten Abschnittskopf steht. */
function foodStatus(state, today) {
  const check = weekCheck(state, today);
  if (!check.hasEntry) return { tone: 'idle', chip: 'Wochenschnitt offen' };

  const rank = { bad: 3, ok: 2, good: 1, idle: 0 };
  const worst = check.fields.reduce(
    (acc, f) => (rank[f.tone] > rank[acc] ? f.tone : acc), 'idle'
  );
  const tone = worst === 'idle' ? 'good' : worst;
  return {
    tone,
    chip: { good: 'passt', ok: 'knapp daneben', bad: 'daneben' }[tone],
  };
}

function weightStatus(state, today) {
  const measured = countKnown(series(state, weekKeys(today), (d) => d.weightKg));
  if (measured === 0) return { tone: 'idle', chip: 'nichts gewogen' };
  const tone = measured >= 6 ? 'good' : measured >= 3 ? 'ok' : 'bad';
  return { tone, chip: `${measured} von 7 Tagen` };
}

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();
  const food = foodStatus(state, today);
  const weight = weightStatus(state, today);

  return el('div', { class: 'view' },
    el('h1', { text: 'Essen' }),
    el('p', { class: 'field__hint' },
      'Zwei Abschnitte. Antippen öffnet sie — zugeklappt steht oben schon, ',
      'ob es passt.'),
    el('div', { style: 'height: var(--space-4)' }),

    /* Zugeklappt startet beides. Wer den Wochenschnitt eintragen will, tippt
       einmal; wer nur nachsehen will, ob es passt, tippt gar nicht. */
    panel({
      title: 'Essen und Makros',
      keep: 'essen-makros',
      chip: food.chip,
      tone: food.tone,
      note: 'Die Makros kommen aus Yazio. Hier steht der Wochenschnitt gegen '
          + 'das Wochenziel — die Zahl, aus der sich eine Anpassung begründen lässt.',
    },
      yazioCard(store, state, today),
      todayTargetCard(state, today),
      weekHistoryCard(state, today),
      dayDetailCard(store, state, today)),

    panel({
      title: 'Gewicht',
      keep: 'essen-gewicht',
      chip: weight.chip,
      tone: weight.tone,
      note: 'Eingetragen wird das Gewicht im Reiter Heute. Hier wird es '
          + 'ausgewertet: die Woche im Detail und der gesamte Verlauf.',
    },
      weightWeekCard(state, today),
      weightTrendCard(state, today)));
}
