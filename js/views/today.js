/* Heute — der Screen, der täglich benutzt wird.
 *
 * Aufbau folgt der Frage, die morgens ansteht: "Was mache ich heute?"
 *
 *   1. Wochenband     — wo stehe ich in der Woche, wie weit ist das Spiel
 *   2. Bereitschaft    — die Antwort, als Zahl mit Anweisung und Begründung
 *   3. Check-in        — die Eingabe dafür (zugeklappt, wenn schon erledigt)
 *   4. Beine heute     — die harte Regel rund um den Spieltag
 *   5. Ziel heute      — Kalorien und Makros
 *   6. Gewicht
 */

import {
  todayKey, weekKeys, weekdayShort, parseKey, formatDayLong, weekdayOf,
} from '../lib/dates.js';
import { dayTypeFor, weightOn, getDay } from '../lib/state.js';
import { dayTargets, DAY_TYPE_LABELS, ageOn, KCAL_PER_G } from '../lib/energy.js';
import { legVolumeAllowance } from '../lib/planner.js';
import { readinessScore, trainingGuidance } from '../lib/readiness.js';
import { exportReminder } from '../lib/archive.js';
import { checkinFields, checkinSummary } from './checkin.js';
import {
  el, replace, int, dec, stat, card, dayWord,
  decimalInput, parseDecimal, toInputValue,
} from './dom.js';

const LEVEL_WORD = {
  heavy: 'Schwere Sätze frei',
  light: 'Nur Prophylaxe',
  none: 'Beine gesperrt',
};

/* ─── Wochenband ─────────────────────────────────────────────────────────── */

/* Kreide-Haarlinien wie Spielfeldmarkierungen, der Spieltag mit dem
   Mittelkreis-Bogen. Es kodiert etwas Wahres: die Woche ist um den Spieltag
   gebaut, nicht um den Montag. */
function weekband(state, today) {
  const p = state.profile;

  return el('div', null,
    el('div', { class: 'weekband' },
      weekKeys(today).map((key) => {
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
          el('span', {
            class: `weekband__mark${markClass ? ` weekband__mark--${markClass}` : ''}`,
          }));
      })),
    el('div', { class: 'weekband__legend' },
      el('span', { text: '⌒ Spiel' }),
      el('span', { text: '≡ Mannschaft' }),
      el('span', { text: '○ Gym geplant' }),
      el('span', { text: '● erledigt' })));
}

/* ─── Bereitschaft ───────────────────────────────────────────────────────── */

function readinessHero(readiness, guidance) {
  const hasScore = readiness.score !== null;
  const level = hasScore ? readiness.level : 'none';

  /* Die Chips sagen, was konkret anders läuft als geplant. An einem Ruhetag
     ist eine Satzangabe sinnlos — dort steht, was stattdessen zu tun ist. */
  const adjustments = [];
  if (hasScore) {
    if (readiness.level === 'rest') {
      adjustments.push('Nur Prophylaxe und Mobilität');
    } else if (guidance.setsDelta !== 0) {
      const n = Math.abs(guidance.setsDelta);
      adjustments.push(`${n} Satz${n === 1 ? '' : 'e'} weniger pro Übung`);
    } else {
      adjustments.push('Progression versuchen');
    }
    if (guidance.rpeCap !== null) {
      adjustments.push(`RPE höchstens ${guidance.rpeCap}`);
    }
    if (!readiness.isComplete) {
      const n = readiness.missing.length;
      adjustments.push(`${n} Feld${n === 1 ? '' : 'er'} offen`);
    }
  }

  return el('div', { class: `hero hero--${level}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Bereitschaft' })),
    el('div', { class: 'hero__top' },
      el('span', { class: 'hero__score' },
        hasScore ? String(Math.round(readiness.score)) : '–',
        hasScore ? el('span', { class: 'hero__of', text: 'von 100' }) : null)),
    el('div', { class: 'hero__headline', text: guidance.headline }),
    el('p', { class: 'hero__detail', text: guidance.detail }),
    adjustments.length
      ? el('div', { class: 'hero__adjust' },
        adjustments.map((a) => el('span', { class: 'chip', text: a })))
      : null);
}

function checkinSection(store, today, readiness) {
  // Solange etwas fehlt, steht das Formular offen — es ist die wichtigste
  // Handlung des Tages. Ist alles ausgefüllt, klappt es weg.
  if (!readiness.isComplete) {
    return card('Check-in',
      el('span', { class: 'eyebrow', text: 'jeden Morgen' }),
      checkinFields(store, today));
  }

  return el('details', { class: 'reveal' },
    el('summary', null,
      el('span', { text: `Check-in: ${checkinSummary(store, today)}` })),
    el('div', { class: 'reveal__body' }, checkinFields(store, today)));
}

/* ─── Beine ──────────────────────────────────────────────────────────────── */

function allowanceCard(state, today, allowance, guidance) {
  const level = guidance.legLevel;

  return el('div', { class: `card allowance allowance--${level}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Beine heute' }),
      el('span', { class: 'chip', text: DAY_TYPE_LABELS[dayTypeFor(state, today)] })),
    el('div', { class: 'allowance__level', text: LEVEL_WORD[level] }),
    el('p', { class: 'allowance__reason', text: guidance.legReason }),
    // Wenn die Bereitschaft die Stufe gesenkt hat, soll auch die
    // Spielrhythmus-Begründung sichtbar bleiben — sonst wirkt die Sperre
    // willkürlich.
    guidance.limitedBy === 'Bereitschaft' && allowance.level !== level
      ? el('p', { class: 'allowance__reason', text: `Rhythmus erlaubt heute: ${LEVEL_WORD[allowance.level].toLowerCase()}.` })
      : null,
    el('div', { class: 'allowance__meta' },
      el('span', null,
        el('b', { text: String(allowance.daysUntilMatch) }),
        ` ${dayWord(allowance.daysUntilMatch)} bis zum Spiel`),
      el('span', null,
        el('b', { text: String(allowance.daysSinceMatch) }),
        ` ${dayWord(allowance.daysSinceMatch)} danach`)));
}

/* ─── Ernährung ──────────────────────────────────────────────────────────── */

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

/* ─── Gewicht ────────────────────────────────────────────────────────────── */

function weightCard(state, today, store) {
  const day = getDay(state, today);
  const slot = el('div');
  const input = decimalInput({
    id: 'weightToday',
    placeholder: dec(weightOn(state, today), 1),
    value: toInputValue(day.weightKg),
  });

  function save() {
    replace(slot);
    const num = parseDecimal(input.value);
    if (num === null) {
      replace(slot, el('p', { class: 'field__hint', text: 'Bitte eine Zahl eintragen, z. B. 80,4.' }));
      return;
    }
    try {
      store.setDay(today, { weightKg: num });
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
        el('label', { text: ' ' }),
        el('button', {
          type: 'button', class: 'btn btn--block', text: 'Speichern', onclick: save,
        }))),
    slot,
    el('p', { class: 'field__hint' },
      'Am besten morgens nach dem Aufstehen. Einzelne Tage schwanken um ',
      'ein Kilo und mehr — bewertet wird später nur der 7-Tage-Schnitt.'));
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

/* Die Erinnerung steht auf dem Screen, den Flocke täglich sieht — nicht im
   Archiv, wo sie erst auffällt, wenn man ohnehin schon daran gedacht hat. */
function backupReminder(state, today, navigate) {
  const reminder = exportReminder(state, today);
  if (!reminder.due) return null;

  return el('div', { class: 'notice notice--warn' },
    el('span', { class: 'notice__title', text: 'Sicherung überfällig' }),
    `${reminder.text} iOS löscht den Speicher von Web-Apps, die längere Zeit `,
    'nicht geöffnet werden — dann wäre alles weg.',
    el('div', { style: 'height: var(--space-3)' }),
    el('button', {
      type: 'button', class: 'btn btn--small', text: 'Jetzt sichern',
      onclick: () => navigate('archiv'),
    }));
}

export function render({ store, navigate }) {
  const state = store.getState();
  const today = todayKey();

  const allowance = legVolumeAllowance(today, {
    matchDayWeekday: state.profile.matchDayWeekday,
    teamTrainingWeekdays: state.profile.teamTrainingWeekdays ?? [],
  });
  const readiness = readinessScore(getDay(state, today).checkin);
  const guidance = trainingGuidance(readiness, allowance);

  return el('div', { class: 'view' },
    weekband(state, today),
    el('h1', { text: formatDayLong(today) }),
    el('div', { style: 'height: var(--space-4)' }),
    backupReminder(state, today, navigate),
    readinessHero(readiness, guidance),
    checkinSection(store, today, readiness),
    allowanceCard(state, today, allowance, guidance),
    targetsCard(state, today),
    weightCard(state, today, store));
}
