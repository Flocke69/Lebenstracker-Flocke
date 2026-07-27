/* Heute — der Screen, der täglich benutzt wird.
 *
 * Stand Phase 1: Wochenband, Tagestyp, die Beinvolumen-Regel und die
 * Tagesziele für Kalorien und Makros. Der Check-in mit dem Bereitschafts-Wert
 * kommt in Phase 2 und schiebt sich dann über die Ziele — er ist die
 * eigentliche Antwort auf "was ist heute richtig".
 */

import {
  todayKey, weekKeys, weekdayShort, parseKey, formatDayLong, weekdayOf,
} from '../lib/dates.js';
import { dayTypeFor, weightOn, getDay } from '../lib/state.js';
import { dayTargets, DAY_TYPE_LABELS, ageOn, KCAL_PER_G } from '../lib/energy.js';
import { legVolumeAllowance } from '../lib/planner.js';
import { el, replace, int, dec, stat, card, dayWord } from './dom.js';

const LEVEL_WORD = {
  heavy: 'Schwere Sätze frei',
  light: 'Nur Prophylaxe',
  none: 'Beine gesperrt',
};

/* Das Wochenband. Kreide-Haarlinien wie Spielfeldmarkierungen, der Spieltag
   mit dem Mittelkreis-Bogen, das Mannschaftstraining mit Doppellinie. Es
   kodiert etwas Wahres: die Woche ist um den Spieltag gebaut, nicht um den
   Montag. */
function weekband(state, today) {
  const p = state.profile;
  const keys = weekKeys(today);

  return el('div', null,
    el('div', { class: 'weekband' },
      keys.map((key) => {
        const weekday = weekdayOf(key);
        const day = getDay(state, key);
        const isToday = key === today;

        let markClass = null;
        if (weekday === p.matchDayWeekday) markClass = 'match';
        else if ((p.teamTrainingWeekdays ?? []).includes(weekday)) markClass = 'team';
        else if ((p.gymWeekdays ?? []).includes(weekday)) {
          markClass = day.sessions.length > 0 ? 'done' : 'gym';
        }

        return el('div', {
          class: `weekband__day${isToday ? ' weekband__day--today' : ''}`,
          'aria-current': isToday ? 'date' : null,
        },
          el('span', { class: 'weekband__label', text: weekdayShort(key) }),
          el('span', { class: 'weekband__num', text: String(parseKey(key).getDate()) }),
          el('span', { class: `weekband__mark${markClass ? ` weekband__mark--${markClass}` : ''}` }));
      })),
    el('div', { class: 'weekband__legend' },
      el('span', { text: '⌒ Spiel' }),
      el('span', { text: '≡ Mannschaft' }),
      el('span', { text: '○ Gym geplant' }),
      el('span', { text: '● erledigt' })));
}

/* Die Beinvolumen-Regel. Kein Ampelsystem: "frei" ist kreideweiß, also die
   Abwesenheit von Farbe. Das Flutlicht geht nur an, wenn eingeschränkt wird —
   und jede Stufe trägt zusätzlich ein Wort. */
function allowanceCard(state, today) {
  const a = legVolumeAllowance(today, {
    matchDayWeekday: state.profile.matchDayWeekday,
    teamTrainingWeekdays: state.profile.teamTrainingWeekdays ?? [],
  });

  return el('div', { class: `card allowance allowance--${a.level}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Beine heute' }),
      el('span', { class: 'chip', text: DAY_TYPE_LABELS[dayTypeFor(state, today)] })),
    el('div', { class: 'allowance__level', text: LEVEL_WORD[a.level] }),
    el('p', { class: 'allowance__reason', text: a.reason }),
    el('div', { class: 'allowance__meta' },
      el('span', null,
        el('b', { text: String(a.daysUntilMatch) }),
        ` ${dayWord(a.daysUntilMatch)} bis zum Spiel`),
      el('span', null,
        el('b', { text: String(a.daysSinceMatch) }),
        ` ${dayWord(a.daysSinceMatch)} danach`)));
}

function macroRow(name, grams, kcalPerG, totalKcal) {
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
      el('div', { class: 'macro__fill', style: `width: ${(share * 100).toFixed(1)}%` })));
}

function targetsCard(state, today) {
  const p = state.profile;
  const weightKg = weightOn(state, today);
  const dayType = dayTypeFor(state, today);

  let t;
  try {
    t = dayTargets({
      sex: p.sex,
      weightKg,
      heightCm: p.heightCm,
      age: ageOn(p.birthYear, today),
      dayType,
      factors: p.activityFactors,
      proteinPerKg: p.proteinPerKg,
      fatPerKg: p.fatPerKg,
      kcalOffset: p.kcalOffset,
    });
  } catch (err) {
    return el('div', { class: 'notice notice--error' },
      el('span', { class: 'notice__title', text: 'Ziele nicht berechenbar' }),
      err.message);
  }

  return card('Ziel heute',
    el('span', { class: 'chip', text: `Faktor ${dec(t.factor, 2)}` }),
    el('div', { class: 'stat-grid' },
      stat('Kalorien', int(t.kcal), 'kcal'),
      stat('Gewicht', dec(weightKg, 1), 'kg')),
    el('hr'),
    macroRow('Protein', t.proteinG, KCAL_PER_G.protein, t.kcal),
    macroRow('Kohlenhydrate', t.carbsG, KCAL_PER_G.carb, t.kcal),
    macroRow('Fett', t.fatG, KCAL_PER_G.fat, t.kcal),
    el('p', { class: 'card__note' },
      `Ruheumsatz ${int(t.bmr)} kcal nach Mifflin-St Jeor, mal Faktor `,
      `${dec(t.factor, 2)} für ${DAY_TYPE_LABELS[dayType]}. Protein und Fett `,
      'hängen nur am Körpergewicht — die Kohlenhydrate tragen die ganze ',
      'Periodisierung.'));
}

function weightCard(state, today, store) {
  const day = getDay(state, today);
  const slot = el('div');
  const input = el('input', {
    id: 'weightToday',
    type: 'number',
    inputMode: 'decimal',
    step: 0.1,
    min: 20,
    max: 400,
    placeholder: dec(weightOn(state, today), 1),
    value: day.weightKg === null ? '' : String(day.weightKg),
  });

  function save() {
    replace(slot);
    const raw = input.value.trim().replace(',', '.');
    if (raw === '') return;
    try {
      store.setDay(today, { weightKg: Number(raw) });
    } catch (err) {
      replace(slot, el('p', { class: 'field__hint', text: err.message }));
    }
  }

  return card('Gewicht heute',
    day.weightKg !== null ? el('span', { class: 'chip', text: 'eingetragen' }) : null,
    el('div', { class: 'field__row' },
      el('div', null,
        el('label', { for: 'weightToday', text: 'Kilogramm' }),
        input),
      el('div', null,
        el('label', { text: ' ' }),
        el('button', {
          type: 'button', class: 'btn btn--block', text: 'Speichern', onclick: save,
        }))),
    slot,
    el('p', { class: 'field__hint' },
      'Am besten morgens nach dem Aufstehen. Einzelne Tage schwanken um ',
      'ein Kilo und mehr — bewertet wird später nur der 7-Tage-Schnitt.'));
}

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();

  return el('div', { class: 'view' },
    weekband(state, today),
    el('h1', { text: formatDayLong(today) }),
    el('p', { class: 'field__hint', text: 'Phase 1: Ziele und Beinregel stehen. Der Check-in mit Bereitschafts-Wert kommt als Nächstes.' }),
    el('div', { style: 'height: var(--space-4)' }),
    allowanceCard(state, today),
    targetsCard(state, today),
    weightCard(state, today, store));
}
