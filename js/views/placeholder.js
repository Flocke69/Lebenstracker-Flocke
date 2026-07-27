/* Auffangnetz für unbekannte Adressen.
 *
 * Bis Phase 6 standen hier die noch nicht gebauten Bereiche. Die gibt es
 * nicht mehr — jeder Reiter hat jetzt eine echte Ansicht. Was bleibt, ist der
 * Fall, dass jemand eine Adresse aufruft, die es nicht gibt: etwa ein alter
 * Link auf dem Home-Bildschirm nach einer Umbenennung.
 */

import { el } from './dom.js';

export function render({ route, navigate }) {
  return el('div', { class: 'view' },
    el('div', { class: 'placeholder' },
      el('span', { class: 'placeholder__phase', text: '?' }),
      el('h1', { text: 'Nicht gefunden' }),
      el('p', { text: `Für „${route}" gibt es keinen Bereich.` }),
      el('div', { style: 'height: var(--space-5)' }),
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        text: 'Zurück zu Heute',
        onclick: () => navigate('heute'),
      })));
}
