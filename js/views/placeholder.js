/* Platzhalter für Bereiche, die noch nicht gebaut sind.
 *
 * Absichtlich sichtbar statt ausgeblendet: die Reiter sollen von Anfang an
 * stehen, damit sich die Navigation nicht mit jeder Phase verändert — und
 * damit Flocke sieht, was noch kommt.
 */

import { el } from './dom.js';

const PLANNED = {
  training: {
    phase: 'Phase 4',
    title: 'Training',
    items: [
      'Übungskatalog mit Zuordnung zu Muskelgruppen',
      'Satz-Logger: Wiederholungen, Gewicht, RPE',
      '„Letztes Mal"-Anzeige direkt an jeder Übung',
      'Automatische Volumenreduktion bei niedriger Bereitschaft',
    ],
  },
  essen: {
    phase: 'Phase 3',
    title: 'Essen',
    items: [
      'Ist-Werte pro Tag eintragen, vier große Felder',
      'Fortschritt pro Makro gegen das Tagesziel',
      'Wochen-Trefferquote für Kalorien und Protein',
      'Kohlenhydrate periodisiert um Spiel- und Trainingstage',
    ],
  },
  trends: {
    phase: 'Phase 5',
    title: 'Trends',
    items: [
      'Gewicht mit 7-Tage-Gleitschnitt — der Tageswert ist Rauschen',
      'Schlaf und Bereitschaft im Verlauf',
      'Trainingsvolumen je Muskelgruppe als Small Multiples',
      'Korrelations-Hinweise im Text unter den Charts',
    ],
  },
  review: {
    phase: 'Phase 6',
    title: 'Review',
    items: [
      'Wochen-Review: Adhärenz, Volumen, Gewichtstrend, Flags',
      'Monats-Review mit Vergleich zu den Vormonaten',
      'Deload-Warnung bei steigendem Volumen und fallender Bereitschaft',
      '„Für Claude kopieren" für das ausführliche Gespräch',
    ],
  },
};

export function render({ route }) {
  const info = PLANNED[route];
  if (!info) {
    return el('div', { class: 'view' },
      el('div', { class: 'placeholder' },
        el('h1', { text: 'Nicht gefunden' }),
        el('p', { text: `Für „${route}" gibt es keinen Bereich.` })));
  }

  return el('div', { class: 'view' },
    el('div', { class: 'placeholder' },
      el('span', { class: 'placeholder__phase', text: info.phase }),
      el('h1', { text: info.title }),
      el('p', { text: 'Noch nicht gebaut. Geplant ist:' }),
      el('ul', { class: 'placeholder__list' },
        info.items.map((item) => el('li', { text: item })))));
}
