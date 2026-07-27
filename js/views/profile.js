/* Profil — alles, was die App zum Rechnen benutzt, an einer Stelle änderbar.
 *
 * Bis hierher lagen diese Werte nur im Onboarding: einmal eingetragen, nie
 * wieder erreichbar. Das geht nicht — Gewichtsziel, Protein und Trainingstage
 * ändern sich, und niemand soll dafür die App zurücksetzen müssen.
 *
 * Jede Änderung greift sofort und wird begründet angezeigt, damit
 * nachvollziehbar bleibt, warum morgen eine andere Zahl im Ziel steht.
 */

import { WEEKDAYS_SHORT, WEEKDAYS_LONG, todayKey } from '../lib/dates.js';
import {
  DAY_TYPES, DAY_TYPE_LABELS, DAY_TYPE_SHORT, DEFAULT_FACTORS, ageOn, dayTargets,
} from '../lib/energy.js';
import { pickLegDay } from '../lib/planner.js';
import { weightOn } from '../lib/state.js';
import {
  el, replace, card, int, dec, decimalInput, parseDecimal, toInputValue,
} from './dom.js';

/** Voreinstellungen für das Kalorienziel — ein Tipp statt Rechnen. */
const GOAL_PRESETS = [
  { offset: 0, label: 'Erhaltung', hint: 'Gewicht stabil, reine Recomp' },
  { offset: -300, label: '−300', hint: 'rund 0,3 kg pro Woche runter' },
  { offset: -500, label: '−500', hint: 'rund 0,5 kg pro Woche runter' },
  { offset: 200, label: '+200', hint: 'Aufbau, langsam' },
];

function section(title, hint, ...children) {
  return card(title, null,
    hint ? el('p', { class: 'field__hint', text: hint }) : null,
    el('div', { style: 'height: var(--space-3)' }),
    ...children);
}

function weekdayCheckboxes(name, selected, disabledDay, onChange) {
  return el('div', { class: 'seg seg--wrap' },
    [1, 2, 3, 4, 5, 6, 0].map((w) =>
      el('label', {
        class: `seg__opt${w === disabledDay ? ' seg__opt--disabled' : ''}`,
      },
        el('input', {
          type: 'checkbox',
          name,
          value: String(w),
          checked: selected.includes(w),
          disabled: w === disabledDay,
          onchange: (e) => onChange(w, e.target.checked),
        }),
        el('span', { text: WEEKDAYS_SHORT[w] }))));
}

export function render({ store }) {
  const state = store.getState();
  const p = state.profile;
  const today = todayKey();
  const errorSlot = el('div');

  /** Änderung schreiben und Fehler sichtbar machen, statt sie zu schlucken. */
  function patch(values) {
    replace(errorSlot);
    try {
      store.setProfile(values);
    } catch (err) {
      replace(errorSlot,
        el('div', { class: 'notice notice--error' },
          el('span', { class: 'notice__title', text: 'Das geht nicht' }),
          err.message));
    }
  }

  const numberRow = (id, label, value, hint, onSave) =>
    el('div', { class: 'field' },
      el('label', { for: id, text: label }),
      decimalInput({
        id,
        value: toInputValue(value),
        onchange: (e) => {
          const n = parseDecimal(e.target.value);
          if (n === null) { e.target.value = toInputValue(value); return; }
          onSave(n);
        },
      }),
      hint ? el('p', { class: 'field__hint', text: hint }) : null);

  /* ─── Vorschau: was die Einstellungen konkret bedeuten ─────────────────── */

  const preview = () => {
    const weightKg = weightOn(state, today);
    const rows = DAY_TYPES.map((dayType) => {
      const t = dayTargets({
        sex: p.sex, weightKg, heightCm: p.heightCm, age: ageOn(p.birthYear, today),
        dayType, factors: p.activityFactors, proteinPerKg: p.proteinPerKg,
        fatPerKg: p.fatPerKg, kcalOffset: p.kcalOffset,
        offsetExemptDayTypes: p.offsetExemptDayTypes,
      });
      return el('tr', null,
        el('td', { text: DAY_TYPE_SHORT[dayType] }),
        el('td', { text: int(t.kcal) }),
        el('td', { text: int(t.carbsG) }),
        el('td', {
          text: t.offsetExempt
            ? 'aus'
            : (t.appliedOffset === 0 ? '—' : int(t.appliedOffset)),
        }));
    });

    // Der Seitenkörper darf nie waagerecht scrollen — breite Inhalte
    // scrollen in ihrem eigenen Kasten.
    return el('div', { class: 'table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Tag' }),
          el('th', { text: 'kcal' }),
          el('th', { text: 'KH g' }),
          el('th', { text: 'Korr.' }))),
        el('tbody', null, rows)));
  };

  const legDay = pickLegDay({
    matchDayWeekday: p.matchDayWeekday,
    teamTrainingWeekdays: p.teamTrainingWeekdays,
    gymWeekdays: p.gymWeekdays.length ? p.gymWeekdays : [p.matchDayWeekday === 4 ? 3 : 4],
  });

  return el('div', { class: 'view' },
    el('h1', { text: 'Profil' }),
    el('p', { class: 'field__hint' },
      'Jede Änderung greift sofort. Die Tabelle unten zeigt, was dabei ',
      'herauskommt — bevor du dich morgen über eine andere Zahl wunderst.'),
    el('div', { style: 'height: var(--space-4)' }),

    errorSlot,

    /* ─── Kalorienziel ──────────────────────────────────────────────────── */
    section('Kalorienziel',
      'Die Korrektur wird auf den berechneten Bedarf aufgeschlagen. '
      + 'Protein und Fett bleiben davon unberührt — gespart wird nur an '
      + 'Kohlenhydraten.',
      el('div', { class: 'seg' },
        GOAL_PRESETS.map((preset) =>
          el('label', { class: 'seg__opt', title: preset.hint },
            el('input', {
              type: 'radio',
              name: 'goal',
              checked: p.kcalOffset === preset.offset,
              onchange: () => patch({ kcalOffset: preset.offset }),
            }),
            el('span', { text: preset.label })))),
      el('p', { class: 'field__hint' },
        GOAL_PRESETS.find((g) => g.offset === p.kcalOffset)?.hint
        ?? `Eigener Wert: ${int(p.kcalOffset)} kcal`),

      el('div', { style: 'height: var(--space-4)' }),

      el('label', { text: 'Defizit an diesen Tagen aussetzen' }),
      el('div', { class: 'seg' },
        DAY_TYPES.map((type) =>
          el('label', { class: 'seg__opt' },
            el('input', {
              type: 'checkbox',
              name: 'exempt',
              checked: (p.offsetExemptDayTypes ?? []).includes(type),
              onchange: (e) => {
                const current = new Set(p.offsetExemptDayTypes ?? []);
                if (e.target.checked) current.add(type); else current.delete(type);
                patch({ offsetExemptDayTypes: [...current] });
              },
            }),
            el('span', { text: DAY_TYPE_SHORT[type] })))),
      el('p', { class: 'field__hint' },
        'Am Spieltag mehrere hundert Kalorien zu kürzen ist die eine Stelle, '
        + 'an der ein Defizit die Leistung wirklich kostet. Die Wochenbilanz '
        + 'verschiebt sich dadurch um einen Tagesbetrag.')),

    /* ─── Vorschau ──────────────────────────────────────────────────────── */
    card('Das kommt dabei heraus',
      el('span', { class: 'chip', text: `${dec(weightOn(state, today), 1)} kg` }),
      preview(),
      el('p', { class: 'card__note' },
        'Kohlenhydrate tragen die gesamte Periodisierung — deshalb ist der '
        + 'Unterschied zwischen Ruhetag und Spieltag dort am größten.')),

    /* ─── Makros ────────────────────────────────────────────────────────── */
    section('Makros',
      'Protein und Fett hängen am Körpergewicht und bleiben jeden Tag gleich.',
      el('div', { class: 'field__row' },
        numberRow('proteinPerKg', 'Protein g/kg', p.proteinPerKg,
          'Im Defizit besser 2,2 als 2,0.', (n) => patch({ proteinPerKg: n })),
        numberRow('fatPerKg', 'Fett g/kg', p.fatPerKg,
          'Unter 0,6 leidet der Hormonhaushalt.', (n) => patch({ fatPerKg: n })))),

    /* ─── Körper ────────────────────────────────────────────────────────── */
    section('Körper',
      'Grundlage für Mifflin-St Jeor. Das Tagesgewicht trägst du im Reiter '
      + 'Heute ein — hier steht nur der Startwert.',
      el('div', { class: 'field__row' },
        numberRow('heightCm', 'Größe in cm', p.heightCm, null,
          (n) => patch({ heightCm: n })),
        numberRow('birthYear', 'Geburtsjahr', p.birthYear,
          `derzeit ${ageOn(p.birthYear, today)} Jahre`,
          (n) => patch({ birthYear: n }))),
      numberRow('startWeightKg', 'Startgewicht in kg', p.startWeightKg, null,
        (n) => patch({ startWeightKg: n }))),

    /* ─── Woche ─────────────────────────────────────────────────────────── */
    section('Deine Woche',
      'Spieltag und Trainingstage steuern, wann die App Beinvolumen freigibt.',
      el('div', { class: 'field' },
        el('label', { text: 'Spieltag' }),
        el('div', { class: 'seg seg--wrap' },
          [1, 2, 3, 4, 5, 6, 0].map((w) =>
            el('label', { class: 'seg__opt' },
              el('input', {
                type: 'radio',
                name: 'matchDay',
                checked: p.matchDayWeekday === w,
                onchange: () => patch({
                  matchDayWeekday: w,
                  gymWeekdays: p.gymWeekdays.filter((d) => d !== w),
                }),
              }),
              el('span', { text: WEEKDAYS_SHORT[w] }))))),

      el('div', { class: 'field' },
        el('label', { text: 'Mannschaftstraining' }),
        weekdayCheckboxes('team', p.teamTrainingWeekdays, null, (w, on) => {
          const set = new Set(p.teamTrainingWeekdays);
          if (on) set.add(w); else set.delete(w);
          patch({ teamTrainingWeekdays: [...set] });
        })),

      el('div', { class: 'field' },
        el('label', { text: 'Gym-Tage' }),
        weekdayCheckboxes('gym', p.gymWeekdays, p.matchDayWeekday, (w, on) => {
          const set = new Set(p.gymWeekdays);
          if (on) set.add(w); else set.delete(w);
          patch({ gymWeekdays: [...set] });
        }),
        el('p', { class: 'field__hint' },
          legDay.weekday === null
            ? legDay.reason
            : `Schwere Beinarbeit liegt damit am ${legDay.dayName}.`))),

    /* ─── Aktivitätsfaktoren ────────────────────────────────────────────── */
    section('Aktivitätsfaktoren',
      'Der Bedarf ist Ruheumsatz mal Faktor. Wenn dein Gewicht über Wochen '
      + 'anders läuft als erwartet, liegt es meistens hier — nicht an der Formel.',
      el('div', { class: 'field__row' },
        DAY_TYPES.map((type) =>
          numberRow(`factor-${type}`, DAY_TYPE_LABELS[type],
            p.activityFactors[type],
            `Standard ${dec(DEFAULT_FACTORS[type], 2)}`,
            (n) => patch({ activityFactors: { ...p.activityFactors, [type]: n } }))))),

    el('p', { class: 'field__hint' },
      'Alle Daten liegen ausschließlich auf diesem Gerät. Denk an den ',
      'monatlichen Export — ohne ihn kann iOS die App-Daten nach längerer ',
      'Pause löschen.'));
}
