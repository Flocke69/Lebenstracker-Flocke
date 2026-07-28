/* Archiv — sichern, abschließen, zurückspielen.
 *
 * Beim Monatswechsel legt sich dieser Screen VOR die App. Nicht als Hinweis,
 * den man wegwischt: solange nicht gesichert ist, bleibt „Monat abschließen"
 * deaktiviert, und die Sperre sitzt in js/lib/archive.js — nicht hier.
 *
 * Der Grund ist unangenehm konkret: iOS Safari löscht die Daten von Web-Apps,
 * die rund sieben Wochen nicht geöffnet wurden. Die Exportdateien sind die
 * einzige Kopie, die das überlebt.
 */

import { todayKey, formatMonth, formatDayShort } from '../lib/dates.js';
import {
  needsRollover, canCloseMonth, rolloverPreview, buildExport, exportFilename,
  withExportStamp, closeMonth, inspectImport, applyImport, exportReminder,
} from '../lib/archive.js';
import { el, replace, card, int, dec, stat } from './dom.js';

/* ─── Datei rausgeben ────────────────────────────────────────────────────── */

/**
 * Sicherung ausgeben.
 *
 * Auf dem iPhone öffnet das Teilen-Menü — dort landet die Datei in „Dateien",
 * iCloud oder einer Nachricht. Wo kein Teilen möglich ist, wird sie normal
 * heruntergeladen.
 */
async function deliver(json, filename) {
  const text = JSON.stringify(json, null, 2);
  const blob = new Blob([text], { type: 'application/json' });

  if (navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return { ok: true, via: 'Teilen-Menü' };
      }
    } catch (err) {
      if (err?.name === 'AbortError') return { ok: false, via: 'abgebrochen' };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { ok: true, via: 'Download' };
}

/* ─── Bausteine ──────────────────────────────────────────────────────────── */

function summaryStats(summary) {
  return el('div', { class: 'stat-grid' },
    stat('Tage erfasst', int(summary.logging.daysWithCheckin)),
    stat('Einheiten', int(summary.logging.daysWithTraining)),
    stat('Sätze', int(summary.training.sets)),
    stat('Gewicht Ø', dec(summary.weight.last, 1), 'kg'));
}

function exportButton(store, { label = 'Monat sichern', primary = true, month = null } = {}) {
  const slot = el('div');

  async function run() {
    const state = store.getState();
    const mk = month ?? state.currentMonth;
    const stamp = new Date().toISOString();
    try {
      const result = await deliver(buildExport(state, mk, stamp), exportFilename(mk));
      if (!result.ok) {
        replace(slot, el('p', { class: 'field__hint', text: 'Sicherung abgebrochen.' }));
        return;
      }
      /* Erst nach erfolgreicher Ausgabe stempeln — sonst öffnet ein
         abgebrochener Versuch die Sperre.

         Danach wird NICHT in den Slot geschrieben: `store.update` zeichnet die
         Ansicht neu, der Slot wäre im selben Moment weg. Die Bestätigung kommt
         aus dem Zustand — die Zeile „Heute gesichert" oben im Screen. */
      store.update((s) => withExportStamp(s, stamp));
    } catch (err) {
      replace(slot,
        el('div', { class: 'notice notice--error' },
          el('span', { class: 'notice__title', text: 'Sichern fehlgeschlagen' }),
          err.message));
    }
  }

  return el('div', null,
    el('button', {
      type: 'button',
      class: `btn btn--block${primary ? ' btn--primary' : ''}`,
      text: label,
      onclick: run,
    }),
    slot);
}

function importCard(store) {
  const slot = el('div');
  const input = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    onchange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      replace(slot);
      try {
        const raw = JSON.parse(await file.text());
        const info = inspectImport(raw);
        replace(slot,
          el('div', { class: 'notice' },
            el('span', { class: 'notice__title', text: `${info.label} — ${info.dayCount} Tage` }),
            info.exportedAt ? `Gesichert am ${info.exportedAt.slice(0, 10)}. ` : '',
            'Bestehende Tage bleiben unangetastet.'),
          el('button', {
            type: 'button', class: 'btn btn--primary btn--block', text: 'Diese Tage einspielen',
            onclick: () => {
              try {
                let bericht;
                store.update((s) => {
                  const out = applyImport(s, raw);
                  bericht = out;
                  return out.state;
                });
                replace(slot, el('p', { class: 'field__hint' },
                  `${bericht.added} Tage eingespielt, ${bericht.skipped} übersprungen `
                  + '(waren schon vorhanden).'));
              } catch (err) {
                replace(slot, el('div', { class: 'notice notice--error', text: err.message }));
              }
            },
          }),
          el('div', { style: 'height: var(--space-2)' }),
          el('button', {
            type: 'button', class: 'btn btn--block', text: 'Vorhandene Tage überschreiben',
            onclick: () => {
              try {
                let bericht;
                store.update((s) => {
                  const out = applyImport(s, raw, { overwrite: true });
                  bericht = out;
                  return out.state;
                });
                replace(slot, el('p', { class: 'field__hint',
                  text: `${bericht.added} Tage eingespielt, vorhandene ersetzt.` }));
              } catch (err) {
                replace(slot, el('div', { class: 'notice notice--error', text: err.message }));
              }
            },
          }));
      } catch (err) {
        replace(slot,
          el('div', { class: 'notice notice--error' },
            el('span', { class: 'notice__title', text: 'Datei nicht lesbar' }),
            err.message));
      }
      event.target.value = '';
    },
  });

  return card('Sicherung zurückspielen', null,
    el('p', { class: 'field__hint' },
      'Eine Exportdatei auswählen. Tage, die schon in der App stehen, bleiben ',
      'erhalten — ein Import ergänzt, er löscht nichts.'),
    el('div', { style: 'height: var(--space-3)' }),
    input,
    slot);
}

/* ─── Der blockierende Monatsabschluss ───────────────────────────────────── */

/**
 * Wird beim Monatswechsel VOR die App gelegt.
 *
 * Kein Wegklicken: die App ist erst wieder benutzbar, wenn der Monat
 * abgeschlossen ist — und das geht nur mit Sicherung.
 */
export function renderRollover({ store, onDone }) {
  const state = store.getState();
  const preview = rolloverPreview(state);
  const today = todayKey();
  const check = canCloseMonth(state, today);

  const finishSlot = el('div');

  const tage = `${preview.dayCount} ${preview.dayCount === 1 ? 'Tag' : 'Tage'}`;

  return el('div', { class: 'view' },
    el('h1', { text: `${preview.label} ist vorbei` }),
    el('p', { class: 'field__hint' },
      `${tage} erfasst. Bevor der neue Monat startet, wird `,
      'alles gesichert und zu einem Monats-Datensatz verdichtet.'),
    el('div', { style: 'height: var(--space-4)' }),

    card('Das steckt drin',
      el('span', { class: 'chip', text: tage }),
      summaryStats(preview.summary),
      el('p', { class: 'card__note' },
        'Nach dem Abschluss bleiben diese Kennzahlen dauerhaft in der App und ',
        'tragen die Langzeit-Trends. Die Tagesdetails liegen dann nur noch in ',
        'der Exportdatei.')),

    card('1 · Sichern',
      el('span', { class: 'chip', text: 'Pflicht' }),
      el('p', { class: 'field__hint' },
        'Die Datei enthält jeden Tag im Detail plus die verdichteten Zahlen. ',
        'Leg sie irgendwo ab, wo du sie wiederfindest — iCloud, Dateien, egal.'),
      el('div', { style: 'height: var(--space-3)' }),
      exportButton(store, { label: `${preview.label} sichern`, month: preview.month })),

    card('2 · Abschließen',
      check.allowed ? el('span', { class: 'chip', text: 'bereit' }) : null,
      el('p', { class: 'field__hint', text: check.reason }),
      el('div', { style: 'height: var(--space-3)' }),
      el('button', {
        type: 'button',
        class: 'btn btn--primary btn--block',
        text: 'Monat abschließen',
        disabled: !check.allowed,
        onclick: () => {
          try {
            store.update((s) => closeMonth(s, today));
            onDone();
          } catch (err) {
            replace(finishSlot,
              el('div', { class: 'notice notice--error', text: err.message }));
          }
        },
      }),
      finishSlot,
      el('p', { class: 'card__note' },
        'Ohne Sicherung wird nichts gelöscht. Das ist keine Empfehlung, ',
        'sondern eine Bedingung im Code — ein Monat Daten darf nicht an einem ',
        'Fehltipp hängen.')));
}

/* ─── Der normale Archiv-Screen ──────────────────────────────────────────── */

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();
  const reminder = exportReminder(state, today);
  const months = [...(state.months ?? [])].reverse();

  return el('div', { class: 'view' },
    el('h1', { text: 'Archiv' }),
    el('p', { class: 'field__hint' },
      'Deine Daten liegen ausschließlich auf diesem Gerät. iOS löscht den ',
      'Speicher von Web-Apps, die rund sieben Wochen nicht geöffnet wurden — ',
      'die Exportdateien sind die einzige Kopie, die das übersteht.'),
    el('div', { style: 'height: var(--space-4)' }),

    reminder.due
      ? el('div', { class: 'notice notice--warn' },
        el('span', { class: 'notice__title', text: 'Sicherung überfällig' }),
        reminder.text)
      : el('div', { class: 'notice', text: reminder.text }),

    card(`Laufender Monat — ${formatMonth(state.currentMonth)}`,
      el('span', { class: 'chip', text: `${Object.keys(state.days ?? {}).length} Tage` }),
      el('p', { class: 'field__hint' },
        'Du kannst jederzeit zwischendurch sichern. Das ändert nichts an den ',
        'Daten, setzt aber die Erinnerung zurück.'),
      el('div', { style: 'height: var(--space-3)' }),
      exportButton(store, { label: 'Jetzt sichern' })),

    importCard(store),

    card('Abgeschlossene Monate',
      el('span', { class: 'chip', text: String(months.length) }),
      months.length === 0
        ? el('p', { class: 'field__hint' },
          'Noch keiner. Am ersten Tag des nächsten Monats meldet sich die App ',
          'von selbst und führt dich durch den Abschluss.')
        : el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null,
              el('th', { text: 'Monat' }),
              el('th', { text: 'Tage' }),
              el('th', { text: 'Gewicht' }),
              el('th', { text: 'Bereit.' }),
              el('th', { text: 'Sätze' }))),
            el('tbody', null,
              months.map((m) => el('tr', null,
                el('td', { text: formatMonth(m.month) }),
                el('td', { text: int(m.summary?.logging?.daysWithCheckin) }),
                el('td', { text: dec(m.summary?.weight?.last, 1) }),
                el('td', { text: int(m.summary?.readiness?.avg) }),
                el('td', { text: int(m.summary?.training?.sets) }))))))));
}
