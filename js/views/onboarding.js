/* Onboarding — das Profil anlegen.
 *
 * Einmalig, deshalb ein einziges scrollendes Formular statt eines Assistenten:
 * Flocke sieht auf einen Blick, was gefragt wird, und kann springen.
 *
 * Gefragt wird nur, was die App wirklich braucht:
 *   Geschlecht, Geburtsjahr, Größe, Gewicht  → Mifflin-St Jeor
 *   Spieltag, Mannschaftstraining, Gym-Tage  → Platzierung der Einheiten
 *
 * Alles andere (Aktivitätsfaktoren, Protein pro Kilo, Kalorien-Korrektur) hat
 * sinnvolle Standardwerte und kommt später ins Profil.
 */

import { WEEKDAYS_SHORT, WEEKDAYS_LONG, todayKey } from '../lib/dates.js';
import { suggestGymWeekdays, pickLegDay } from '../lib/planner.js';
import { el, replace } from './dom.js';

const currentYear = new Date().getFullYear();

function segRadio(name, options, checkedValue, onChange, wrap = false) {
  return el('div', { class: `seg${wrap ? ' seg--wrap' : ''}` },
    options.map((opt) =>
      el('label', { class: 'seg__opt' },
        el('input', {
          type: 'radio',
          name,
          value: String(opt.value),
          checked: opt.value === checkedValue,
          onchange: () => onChange(opt.value),
        }),
        el('span', { text: opt.label }))));
}

function segCheckboxes(name, options, selected, onChange) {
  return el('div', { class: 'seg seg--wrap' },
    options.map((opt) =>
      el('label', {
        class: `seg__opt${opt.disabled ? ' seg__opt--disabled' : ''}`,
        title: opt.title ?? '',
      },
        el('input', {
          type: 'checkbox',
          name,
          value: String(opt.value),
          checked: selected.includes(opt.value),
          disabled: Boolean(opt.disabled),
          onchange: (e) => onChange(opt.value, e.target.checked),
        }),
        el('span', { text: opt.label }))));
}

function numberField(id, label, hint, attrs) {
  return el('div', { class: 'field' },
    el('label', { for: id, text: label }),
    el('input', { id, type: 'number', inputMode: 'decimal', ...attrs }),
    hint ? el('p', { class: 'field__hint', text: hint }) : null);
}

export function render({ store, onDone }) {
  const draft = {
    sex: null,
    matchDayWeekday: null,
    teamTrainingWeekdays: [],
    gymWeekdays: [],
  };

  const errorSlot = el('div');
  const gymSlot = el('div');
  const legSlot = el('div');

  const weekdayOptions = (extra = {}) =>
    [1, 2, 3, 4, 5, 6, 0].map((w) => ({
      value: w,
      label: WEEKDAYS_SHORT[w],
      ...(typeof extra === 'function' ? extra(w) : extra),
    }));

  /* Der Spieltag darf kein Gym-Tag sein — die App würde sich sonst selbst
     widersprechen. Deshalb wird er hier gesperrt statt erst beim Speichern
     abgelehnt. */
  function renderGymPicker() {
    const disabledDay = draft.matchDayWeekday;
    replace(gymSlot,
      segCheckboxes('gym', weekdayOptions((w) => ({
        disabled: w === disabledDay,
        title: w === disabledDay ? 'Spieltag — hier kein Krafttraining' : '',
      })), draft.gymWeekdays, (value, checked) => {
        draft.gymWeekdays = checked
          ? [...draft.gymWeekdays, value].sort((a, b) => a - b)
          : draft.gymWeekdays.filter((d) => d !== value);
        renderLegHint();
      }));
    renderLegHint();
  }

  /* Sofortige Rückmeldung, welcher Tag die schwere Bein-Einheit tragen kann.
     Das ist die wichtigste Regel der App — sie soll schon hier sichtbar sein,
     nicht erst nach dem Speichern. */
  function renderLegHint() {
    if (draft.matchDayWeekday === null || draft.gymWeekdays.length === 0) {
      replace(legSlot);
      return;
    }
    const result = pickLegDay({
      matchDayWeekday: draft.matchDayWeekday,
      teamTrainingWeekdays: draft.teamTrainingWeekdays,
      gymWeekdays: draft.gymWeekdays,
    });
    replace(legSlot,
      el('div', { class: `notice${result.weekday === null ? ' notice--warn' : ''}` },
        el('span', {
          class: 'notice__title',
          text: result.weekday === null
            ? 'Kein Tag für schweres Beintraining'
            : `Bein-Einheit: ${result.dayName}`,
        }),
        // `detail` statt `reason`: der Tag steht schon in der Überschrift.
        result.detail ?? result.reason));
  }

  function applySuggestion() {
    if (draft.matchDayWeekday === null) return;
    try {
      const s = suggestGymWeekdays({
        matchDayWeekday: draft.matchDayWeekday,
        teamTrainingWeekdays: draft.teamTrainingWeekdays,
        count: 3,
      });
      draft.gymWeekdays = s.gymWeekdays;
      renderGymPicker();
    } catch (err) {
      replace(errorSlot, el('div', { class: 'notice notice--error', text: err.message }));
    }
  }

  function save(event) {
    event.preventDefault();
    replace(errorSlot);

    const read = (id) => {
      const raw = document.getElementById(id).value.trim();
      return raw === '' ? null : Number(raw.replace(',', '.'));
    };

    try {
      store.setProfile({
        sex: draft.sex,
        birthYear: read('birthYear'),
        heightCm: read('heightCm'),
        startWeightKg: read('startWeightKg'),
        matchDayWeekday: draft.matchDayWeekday,
        teamTrainingWeekdays: draft.teamTrainingWeekdays,
        gymWeekdays: draft.gymWeekdays,
      });
      onDone();
    } catch (err) {
      replace(errorSlot,
        el('div', { class: 'notice notice--error' },
          el('span', { class: 'notice__title', text: 'Das passt noch nicht' }),
          err.message));
      errorSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  const form = el('form', { class: 'view', onsubmit: save, novalidate: true },
    el('h1', { text: 'Erst mal ein paar Zahlen' }),
    el('p', { class: 'field__hint' },
      'Daraus rechnet die App deinen Bedarf nach Mifflin-St Jeor und legt die ',
      'Krafteinheiten um deinen Spieltag herum. Alles hier ist später im ',
      'Profil änderbar.'),

    el('div', { class: 'card' },
      el('div', { class: 'field' },
        el('label', { text: 'Geschlecht' }),
        segRadio('sex', [
          { value: 'm', label: 'männlich' },
          { value: 'w', label: 'weiblich' },
        ], draft.sex, (v) => { draft.sex = v; })),

      el('div', { class: 'field__row' },
        numberField('birthYear', 'Geburtsjahr', null, {
          min: 1920, max: currentYear - 10, step: 1, placeholder: '2001',
        }),
        numberField('heightCm', 'Größe in cm', null, {
          min: 100, max: 250, step: 1, placeholder: '180',
        })),

      numberField('startWeightKg', 'Aktuelles Gewicht in kg',
        'Nur der Startwert. Ab morgen trägst du täglich ein — gewertet wird ' +
        'der 7-Tage-Schnitt, nicht der Tageswert.',
        { min: 20, max: 400, step: 0.1, placeholder: '80,0' })),

    el('div', { class: 'card' },
      el('div', { class: 'field' },
        el('label', { text: 'Spieltag' }),
        segRadio('matchDay', weekdayOptions(), draft.matchDayWeekday, (v) => {
          draft.matchDayWeekday = v;
          // Ein bereits gewählter Gym-Tag am Spieltag fällt weg.
          draft.gymWeekdays = draft.gymWeekdays.filter((d) => d !== v);
          renderGymPicker();
        }, true),
        el('p', { class: 'field__hint' },
          'Am Spieltag und am Tag davor gibt die App kein Beinvolumen frei — ',
          'unabhängig davon, wie gut du dich fühlst.')),

      el('div', { class: 'field' },
        el('label', { text: 'Mannschaftstraining' }),
        segCheckboxes('team', weekdayOptions(), draft.teamTrainingWeekdays,
          (value, checked) => {
            draft.teamTrainingWeekdays = checked
              ? [...draft.teamTrainingWeekdays, value].sort((a, b) => a - b)
              : draft.teamTrainingWeekdays.filter((d) => d !== value);
            renderGymPicker();
          }),
        el('p', { class: 'field__hint' },
          'Mehrfachauswahl möglich. Am Tag vor dem Mannschaftstraining ',
          'bleibt schweres Beintraining aus, sonst leidet das Training.'))),

    el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('span', { class: 'eyebrow', text: 'Krafttraining' }),
        el('button', {
          type: 'button',
          class: 'btn btn--ghost btn--small',
          text: 'Vorschlag einsetzen',
          onclick: applySuggestion,
        })),
      el('div', { class: 'field' },
        gymSlot,
        el('p', { class: 'field__hint' },
          'Der Vorschlag hält Spieltag und Vortag frei, lässt das ',
          'Mannschaftstraining unangetastet und legt die Einheiten so weit ',
          'auseinander wie möglich.')),
      legSlot),

    errorSlot,

    el('button', { type: 'submit', class: 'btn btn--primary btn--block', text: 'Los geht’s' }),
    el('p', { class: 'field__hint' },
      'Heute ist ', WEEKDAYS_LONG[new Date().getDay()], ', ',
      todayKey(), '. Die Daten bleiben auf diesem Gerät.'));

  renderGymPicker();
  return form;
}
