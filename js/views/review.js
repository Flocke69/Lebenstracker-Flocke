/* Review — kurz, farbig, und am Monatsende mit einer Datei.
 *
 * Aufbau, und jeder Punkt ist eine Entscheidung gegen den ersten Entwurf:
 *
 *   1. Befunde als EIN Block mit farbigen Stichpunkten. Vorher waren es bis zu
 *      sechs Karten mit je vier Sätzen — das liest niemand am Sonntagabend.
 *   2. Die wichtigsten Zahlen in einer Reihe, nicht in einer Tabelle mit sieben
 *      Zeilen.
 *   3. Volumen und Fortschritt als je EIN Urteil ("passt" / "zu niedrig"), die
 *      Einzelwerte nur auf Wunsch. Die Frage lautet nicht "wie viele Sätze hat
 *      der Trizeps bekommen".
 *   4. Nur im MONAT: die zehn Fragen, eine Rückmeldung dazu, der Dateiexport
 *      und der Rückweg. In der Woche nichts davon — ein Kopierblock, den man
 *      wöchentlich sieht und monatlich braucht, wird zu Möbel.
 *
 * Der Dateiexport ist der wichtigste Knopf dieses Screens. Am Monatsende muss
 * die JSON-Datei in Flockes Dateien landen; ohne sie kann iOS den Speicher der
 * App leeren und ein Monat ist weg.
 */

import { todayKey, weekStartKey, addDays, addMonths, monthKey, formatMonth }
  from '../lib/dates.js';
import {
  weeklyReview, monthlyReview,
  reviewQuestions, buildMonthRecord, monthRecordToText, parseMonthRecord,
  volumeVerdict, progressVerdict, reviewFeedback,
} from '../lib/review.js';
import { monthDays, weekKeys } from '../lib/dates.js';
import { getReviewRecord, firstTrackedMonth } from '../lib/state.js';
import { buildExport, exportFilename, withExportStamp } from '../lib/archive.js';
import { LOW_READINESS, SHORT_SLEEP_H } from '../lib/aggregate.js';
import { MUSCLE_GROUPS } from '../../data/exercises.js';
import { el, replace, card, panel, int, dec } from './dom.js';

const SEVERITY_WORD = {
  alarm: 'Dringend', warn: 'Achtung', info: 'Hinweis', good: 'Gut',
};

/* ─── Befunde: ein Block, farbige Stichpunkte ────────────────────────────── */

/**
 * Der Leitsatz über den Stichpunkten.
 *
 * Er zählt, was los ist, damit man nach einem Blick weiß, ob man weiterlesen
 * muss. „3 Befunde" sagt das nicht — „eines dringend, zwei zum Ansehen" schon.
 */
function leadSentence(flags) {
  const n = (s) => flags.filter((f) => f.severity === s).length;
  const alarm = n('alarm');
  const warn = n('warn');
  const info = n('info');

  if (alarm === 0 && warn === 0 && info === 0) {
    return 'Nichts aufgefallen — dafür fehlen aber auch die Daten.';
  }
  if (alarm === 0 && warn === 0) {
    return 'Nichts Dringendes. Was auffällt, steht unten.';
  }

  const parts = [];
  if (alarm) parts.push(`${alarm} ${alarm === 1 ? 'Sache ist dringend' : 'Sachen sind dringend'}`);
  if (warn) parts.push(`${warn} ${warn === 1 ? 'braucht' : 'brauchen'} Aufmerksamkeit`);
  if (info) parts.push(`${info} zum Ansehen`);
  return `${parts.join(', ')}.`;
}

function findingsCard(review) {
  const flags = review.flags;
  const worst = flags.some((f) => f.severity === 'alarm') ? 'bad'
    : flags.some((f) => f.severity === 'warn') ? 'ok'
      : flags.some((f) => f.severity === 'info') ? 'idle' : 'good';

  const actions = flags.filter((f) => f.action && f.severity !== 'good');

  return el('div', { class: `card card--tone card--${worst}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Was auffällt' }),
      el('span', {
        class: `chip chip--${worst}`,
        text: `${flags.length} ${flags.length === 1 ? 'Befund' : 'Befunde'}`,
      })),

    el('p', { class: 'lead', text: leadSentence(flags) }),

    /* Ein Stichpunkt je Befund: Punkt in der Statusfarbe, Titel, Kurzform.
       Die Langfassung steckt unten im aufklappbaren Teil und im Kopierblock. */
    el('ul', { class: 'bullets' },
      flags.map((f) => el('li', { class: `bullets__item bullets__item--${f.tone}` },
        el('span', { class: 'bullets__word', text: SEVERITY_WORD[f.severity] }),
        el('span', { class: 'bullets__text' },
          el('b', { text: f.title }),
          ` — ${f.short}`)))),

    actions.length > 0
      ? el('details', { class: 'reveal reveal--table', dataset: { keep: 'befund-details' } },
        el('summary', null, el('span', { text: 'Was zu tun ist' })),
        el('div', { class: 'reveal__body' },
          el('ul', { class: 'bullets' },
            actions.map((f) => el('li', { class: `bullets__item bullets__item--${f.tone}` },
              el('span', { class: 'bullets__text' },
                el('b', { text: `${f.title}: ` }), f.action))))))
      : null);
}

/* ─── Die wichtigsten Zahlen ─────────────────────────────────────────────── */

function deltaText(value, unit, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${dec(value, digits)}${unit ? ` ${unit}` : ''}`;
}

/**
 * Die Veränderung als Pfeil plus Betrag.
 *
 * Vorher stand dort „+101 davor" — das liest sich wie „101 davor" und behauptet
 * damit das Gegenteil. Ein Pfeil hat keine Leserichtung, die man verwechseln
 * kann, und die Legende darunter erklärt ihn einmal.
 */
function deltaArrow(value, unit, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  const amount = dec(Math.abs(value), digits);
  return `${arrow} ${amount}${unit ? ` ${unit}` : ''}`;
}

/**
 * Sechs Zahlen, die zählen — und je eine Veränderung dazu.
 *
 * Eine Zahl ohne Vergleich ist auf diesem Screen wertlos: 79,9 kg sagt nichts,
 * „79,9 kg, −0,5 gegenüber davor" sagt alles.
 */
function numbersCard(review) {
  const s = review.summary;
  const c = review.comparison;

  const cells = [
    {
      label: 'Gewicht', value: dec(s.weight.last, 1), unit: 'kg',
      delta: deltaArrow(s.weight.delta, 'kg'),
      tone: !Number.isFinite(s.weight.delta) ? 'idle'
        : Math.abs(s.weight.delta) <= 0.5 ? 'good' : 'ok',
    },
    {
      label: 'Schlaf', value: dec(s.sleep.avg, 1), unit: 'h',
      delta: deltaArrow(c.sleep, 'h'),
      tone: !Number.isFinite(s.sleep.avg) ? 'idle'
        : s.sleep.avg >= 7.5 ? 'good' : s.sleep.avg >= SHORT_SLEEP_H ? 'ok' : 'bad',
    },
    {
      label: 'Sätze', value: int(s.training.sets), unit: '',
      delta: deltaArrow(c.sets, '', 0),
      tone: s.training.sets > 0 ? 'good' : 'idle',
    },
    {
      label: 'Einheiten', value: int(s.logging.daysWithTraining), unit: '',
      delta: null,
      tone: s.logging.daysWithTraining > 0 ? 'good' : 'idle',
    },
    {
      label: 'Protein Ø', value: int(s.nutrition.proteinAvg), unit: 'g',
      delta: deltaArrow(c.protein, 'g', 0),
      tone: !Number.isFinite(s.nutrition.proteinHitRate) ? 'idle'
        : s.nutrition.proteinHitRate >= 0.7 ? 'good' : 'bad',
    },
    {
      label: 'Schlechte Tage', value: int(s.readiness.lowDays), unit: '',
      delta: null,
      tone: s.readiness.days === 0 ? 'idle'
        : s.readiness.lowDays <= 2 ? 'good' : s.readiness.lowDays <= 5 ? 'ok' : 'bad',
    },
  ];

  return card('Die Zahlen',
    el('span', { class: 'chip', text: `${s.period.dayCount} Tage` }),
    el('div', { class: 'keynums' },
      cells.map((cell) => el('div', { class: `keynum keynum--${cell.tone}` },
        el('span', { class: 'keynum__value' },
          cell.value,
          cell.unit ? el('span', { class: 'keynum__unit', text: cell.unit }) : null),
        el('span', { class: 'keynum__label', text: cell.label }),
        cell.delta
          ? el('span', { class: 'keynum__delta', text: cell.delta })
          : null))),
    el('p', { class: 'card__note' },
      'Pfeil und Zahl darunter: die Veränderung gegenüber der Vorperiode.'));
}

/* ─── Volumen und Fortschritt: ein Urteil ────────────────────────────────── */

/**
 * Passt es, und geht es voran?
 *
 * Zwei Sätze statt zwölf Balken. Die Einzelwerte je Muskelgruppe bleiben
 * erreichbar — aber wer sie nicht braucht, muss nicht daran vorbeiscrollen.
 */
function volumeCard(review) {
  const volume = volumeVerdict(review.summary);
  const progress = progressVerdict(review);
  const rows = Object.entries(review.summary.training.volume)
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;

  return el('div', { class: `card card--tone card--${volume.tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Volumen und Fortschritt' }),
      el('span', { class: `chip chip--${volume.tone}`, text: volume.headline })),

    el('div', { class: 'twoverdict' },
      el('div', { class: `verdictbox verdictbox--${volume.tone}` },
        el('span', { class: 'verdictbox__label', text: 'Volumen' }),
        el('span', { class: 'verdictbox__head', text: volume.headline }),
        el('p', { class: 'verdictbox__text', text: volume.detail })),
      el('div', { class: `verdictbox verdictbox--${progress.tone}` },
        el('span', { class: 'verdictbox__label', text: 'Fortschritt' }),
        el('span', { class: 'verdictbox__head', text: progress.headline }),
        el('p', { class: 'verdictbox__text', text: progress.detail }))),

    rows.length > 0
      ? el('details', { class: 'reveal reveal--table', dataset: { keep: 'volumen-details' } },
        el('summary', null, el('span', { text: 'Je Muskelgruppe' })),
        el('div', { class: 'reveal__body' },
          rows.map(([key, sets]) => {
            const diff = review.comparison.volume?.[key];
            const tone = !Number.isFinite(diff) || Math.abs(diff) < 1 ? 'idle'
              : diff > 0 ? 'good' : 'ok';
            return el('div', { class: 'macro' },
              el('div', { class: 'macro__head' },
                el('span', { class: 'macro__name', text: MUSCLE_GROUPS[key] }),
                el('span', { class: 'macro__value' },
                  dec(sets, 1),
                  el('span', {
                    class: `macro__delta macro__delta--${tone}`,
                    text: ` (${deltaText(diff, '', 1)})`,
                  }))),
              el('div', { class: 'macro__track' },
                el('div', {
                  class: 'macro__fill macro__fill--volume',
                  style: `width: ${((sets / max) * 100).toFixed(1)}%`,
                })));
          })))
      : null);
}

/* ─── Die zehn Fragen ────────────────────────────────────────────────────── */

function questionsCard(store, state, review, mk, questions, answers) {
  const answered = questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length;

  const save = (id, value) => {
    const next = { ...answers, [id]: value };
    store.saveReview(buildMonthRecord(review, state, next, new Date().toISOString()));
  };

  const tone = answered === questions.length ? 'good' : answered > 0 ? 'ok' : 'idle';

  return el('div', { class: `card card--tone card--${tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Die zehn Fragen' }),
      el('span', { class: `chip chip--${tone}`, text: `${answered} von ${questions.length}` })),

    el('p', { class: 'field__hint' },
      'Aus den Zahlen dieses Monats gebaut. Die Antworten werden sofort ',
      'gespeichert und gehen in die Monatsdatei mit.'),
    el('div', { style: 'height: var(--space-4)' }),

    questions.map((q, i) => el('div', { class: 'q' },
      el('div', { class: 'q__head' },
        el('span', { class: 'q__num', text: String(i + 1) }),
        el('div', null,
          el('span', { class: 'q__topic', text: q.topic }),
          el('p', { class: 'q__text', text: q.question }))),
      el('p', { class: 'q__context', text: q.context }),
      el('textarea', {
        rows: 2,
        placeholder: 'Antwort …',
        value: answers[q.id] ?? '',
        'aria-label': q.question,
        onchange: (e) => save(q.id, e.target.value),
      }))));
}

/**
 * Die Rückmeldung der App zu den Antworten.
 *
 * Ehrlich in beiden Richtungen: sie sagt, was die Zahlen hergeben, und sie sagt
 * auch, dass sie den Freitext nicht liest. Eine App, die auf „Handy lag im Bett"
 * mit einer Schlafhygiene-Predigt antwortet, wird nach dem zweiten Monat nicht
 * mehr geöffnet.
 */
function feedbackCard(review, questions, answers) {
  const fb = reviewFeedback(review, questions, answers);

  if (!fb.ready) {
    return el('div', { class: 'card card--tone card--idle' },
      el('div', { class: 'card__head' },
        el('span', { class: 'eyebrow', text: 'Rückmeldung' })),
      el('p', { class: 'field__hint' },
        'Beantworte mindestens eine Frage, dann steht hier, was die Zahlen dazu ',
        'sagen.'));
  }

  return el('div', { class: `card card--tone card--${fb.tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Rückmeldung' }),
      fb.missing > 0
        ? el('span', { class: 'chip chip--ok', text: `${fb.missing} offen` })
        : el('span', { class: 'chip chip--good', text: 'vollständig' })),

    el('p', { class: 'lead', text: fb.headline }),

    el('ul', { class: 'bullets' },
      fb.points.map((p) => el('li', { class: `bullets__item bullets__item--${p.tone}` },
        el('span', { class: 'bullets__text' },
          el('b', { text: `${p.title}: ` }), p.text)))),

    fb.decision
      ? el('div', { class: 'decision' },
        el('span', { class: 'decision__label', text: 'Deine eine Änderung für den nächsten Monat' }),
        el('p', { class: 'decision__text', text: fb.decision }))
      : null,

    el('p', { class: 'card__note' },
      'Das hier sind die Regeln der App. Deine Antworten im Freitext kann sie ',
      'nicht lesen — dafür gibt es den Kopierblock unten und das Gespräch.'));
}

/* ─── Monatsdatei und Übergabe ───────────────────────────────────────────── */

/**
 * Die Datei rausgeben.
 *
 * Auf dem iPhone öffnet das Teilen-Menü — dort landet die Datei in „Dateien",
 * iCloud oder einer Nachricht. Wo kein Teilen möglich ist, wird sie normal
 * heruntergeladen. Dieselbe Mechanik wie im Archiv, absichtlich: es soll genau
 * eine Art geben, wie eine Monatsdatei entsteht.
 */
async function deliver(json, filename) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });

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

function exportCard(store, state, review, mk, answers) {
  const slot = el('div');

  /* Die Bestätigung wird NICHT in den Slot geschrieben.
   *
   * `store.update` löst ein Neuzeichnen der ganzen Ansicht aus — eine Meldung
   * im Slot wäre im selben Moment wieder weg. Genau das ist hier passiert: der
   * Export lief, der Zeitstempel stand im Zustand, und auf dem Screen war
   * nichts zu sehen.
   *
   * Die Bestätigung kommt deshalb aus dem ZUSTAND (`lastExportAt`, siehe
   * unten). Der Slot bleibt für das, was KEIN Neuzeichnen auslöst: Abbruch
   * und Fehler. */
  async function exportFile() {
    replace(slot);
    const stamp = new Date().toISOString();
    try {
      const result = await deliver(buildExport(state, mk, stamp), exportFilename(mk));
      if (!result.ok) {
        replace(slot, el('p', { class: 'field__hint', text: 'Export abgebrochen — nichts gespeichert.' }));
        return;
      }
      // Erst nach erfolgreicher Ausgabe stempeln — sonst öffnet ein
      // abgebrochener Versuch die Sperre des Monatsabschlusses.
      store.update((s) => withExportStamp(s, stamp));
    } catch (err) {
      replace(slot, el('div', { class: 'notice notice--error' },
        el('span', { class: 'notice__title', text: 'Export fehlgeschlagen' }),
        err.message));
    }
  }

  async function copyForClaude() {
    replace(slot);
    const text = monthRecordToText(
      buildMonthRecord(review, state, answers, new Date().toISOString())
    );
    try {
      await navigator.clipboard.writeText(text);
      replace(slot, el('p', { class: 'field__hint', text: 'Kopiert. Füg es im Chat ein.' }));
    } catch {
      // Ohne Zwischenablage-Recht bleibt der Text zum Markieren stehen.
      replace(slot,
        el('p', { class: 'field__hint', text: 'Kopieren nicht erlaubt — Text markieren:' }),
        el('textarea', { rows: 12, readOnly: true, value: text }));
    }
  }

  /* Der Zeitstempel aus dem Zustand ist die Bestätigung: er überlebt das
     Neuzeichnen und sagt beim nächsten Öffnen noch, ob der Monat gesichert ist. */
  const stamp = state.lastExportAt;
  const exported = typeof stamp === 'string' && !Number.isNaN(new Date(stamp).getTime())
    ? new Date(stamp)
    : null;
  const exportedText = exported
    ? `Zuletzt exportiert am ${String(exported.getDate()).padStart(2, '0')}.`
      + `${String(exported.getMonth() + 1).padStart(2, '0')}. um `
      + `${String(exported.getHours()).padStart(2, '0')}:`
      + `${String(exported.getMinutes()).padStart(2, '0')} Uhr.`
    : 'Noch nie exportiert.';

  return el('div', { class: `card card--tone card--${exported ? 'good' : 'bad'}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Monatsdateien' }),
      el('span', {
        class: `chip chip--${exported ? 'good' : 'bad'}`,
        text: exported ? 'gesichert' : 'nicht gesichert',
      })),

    el('p', { class: 'field__hint' },
      'Die Datei enthält jeden Tag im Detail, die verdichteten Zahlen, die ',
      'Wochenschnitte und deine Antworten. iOS kann den Speicher von Web-Apps ',
      'nach längerer Pause leeren — diese Datei ist die einzige Kopie, die das ',
      'übersteht.'),
    el('div', { style: 'height: var(--space-3)' }),

    el('button', {
      type: 'button', class: 'btn btn--primary btn--block',
      text: `${formatMonth(mk)} exportieren`,
      onclick: exportFile,
    }),
    el('div', { style: 'height: var(--space-2)' }),
    el('button', {
      type: 'button', class: 'btn btn--block',
      text: 'Review für Claude kopieren',
      onclick: copyForClaude,
    }),
    slot,
    el('p', { class: `card__note card__note--${exported ? 'good' : 'bad'}`, text: exportedText }),
    el('p', { class: 'card__note' },
      'Der Kopierblock ist für das Gespräch, die Datei für deine Ablage. Der ',
      'Block enthält am Ende denselben Datensatz — du kannst ihn unten wieder ',
      'einlesen.'));
}

/**
 * Der Rückweg: Datensatz einlesen.
 *
 * Erst prüfen und zeigen, was drinsteht, dann auf Knopfdruck übernehmen. Nie
 * direkt beim Einfügen — ein Import, der ohne Rückfrage schreibt, überschreibt
 * irgendwann die Antworten eines Monats mit einem Fehlgriff aus der
 * Zwischenablage.
 */
function importCard(store) {
  const slot = el('div');
  const input = el('textarea', {
    rows: 4,
    placeholder: 'Datensatz aus dem Gespräch hier einfügen …',
    'aria-label': 'Monats-Datensatz einfügen',
  });

  function check() {
    replace(slot);
    let parsed;
    try {
      parsed = parseMonthRecord(input.value);
    } catch (err) {
      replace(slot, el('div', { class: 'notice notice--error' },
        el('span', { class: 'notice__title', text: 'Nicht einlesbar' }),
        err.message));
      return;
    }

    const { record, answered, questionCount } = parsed;
    replace(slot,
      el('div', { class: 'notice notice--good' },
        el('span', { class: 'notice__title', text: `${formatMonth(record.month)} erkannt` }),
        `${answered} von ${questionCount} Fragen beantwortet, `,
        `${record.summary?.period?.dayCount ?? '—'} Tage im Zeitraum.`),
      el('button', {
        type: 'button', class: 'btn btn--primary btn--block',
        text: 'Diesen Monat übernehmen',
        onclick: () => {
          try {
            store.saveReview(record);
            input.value = '';
            replace(slot, el('p', { class: 'field__hint' },
              `${formatMonth(record.month)} liegt jetzt in der App.`));
          } catch (err) {
            replace(slot, el('div', { class: 'notice notice--error', text: err.message }));
          }
        },
      }));
  }

  return card('Monat zurückimportieren', null,
    el('p', { class: 'field__hint' },
      'Den Block aus dem Gespräch hier einfügen. Ein Monat, der schon in der ',
      'App liegt, wird ersetzt — ein zweites Review desselben Monats ist eine ',
      'Korrektur, keine zweite Meinung.'),
    el('div', { style: 'height: var(--space-3)' }),
    input,
    el('div', { style: 'height: var(--space-2)' }),
    el('button', { type: 'button', class: 'btn btn--block', text: 'Prüfen', onclick: check }),
    slot);
}

/** Was schon in der App liegt. */
function storedCard(state) {
  const reviews = [...(state.reviews ?? [])].reverse();

  return card('Gespeicherte Monats-Reviews',
    el('span', { class: 'chip', text: String(reviews.length) }),
    reviews.length === 0
      ? el('p', { class: 'field__hint' },
        'Noch keiner. Beantworte die zehn Fragen — der Monat wird dabei ',
        'automatisch gespeichert.')
      : el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'Monat' }),
            el('th', { text: 'Gewicht' }),
            el('th', { text: 'Sätze' }),
            el('th', { text: 'Fragen' }))),
          el('tbody', null,
            reviews.map((r) => el('tr', null,
              el('td', { text: formatMonth(r.month) }),
              el('td', { text: dec(r.summary?.weight?.last, 1) }),
              el('td', { text: int(r.summary?.training?.sets) }),
              el('td', {
                text: `${(r.questions ?? []).filter((q) => q.answer).length}`
                  + `/${(r.questions ?? []).length}`,
              })))))));
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

export function render({ store }) {
  const state = store.getState();
  const today = todayKey();

  // Welcher Zeitraum? Voreinstellung ist die laufende Woche.
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const mode = params.get('mode') === 'month' ? 'month' : 'week';
  const offset = Number(params.get('offset') ?? 0);

  /* Vor dem ersten erfassten Monat gibt es nichts. Die Knöpfe führen nicht
     dorthin — eine getippte Adresse aber schon, und dann stünde dort eine leere
     Auswertung für einen Monat, den es in der App nicht gibt. Deshalb wird der
     Zeitraum HIER geklemmt und nicht nur der Knopf gesperrt. Dieselbe Haltung
     wie bei shownDayKey() auf dem Heute-Screen. */
  const floorMonth = firstTrackedMonth(state, today);
  const floorDay = `${floorMonth}-01`;

  const wantedAnchor = mode === 'week' ? addDays(weekStartKey(today), offset * 7) : today;
  const anchor = mode === 'week' && wantedAnchor < floorDay
    ? weekStartKey(floorDay) < floorDay
      // Die Woche des Monatsersten beginnt im Vormonat: dann die nächste nehmen.
      ? addDays(weekStartKey(floorDay), 7)
      : weekStartKey(floorDay)
    : wantedAnchor;

  const wantedMonth = mode === 'month'
    ? (() => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() + offset);
      return monthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    })()
    : null;
  const mk = mode === 'month' && wantedMonth < floorMonth ? floorMonth : wantedMonth;

  const review = mode === 'week' ? weeklyReview(state, anchor) : monthlyReview(state, mk);
  const keys = mode === 'week' ? weekKeys(anchor) : monthDays(mk);

  const go = (m, o) => { location.hash = `#/review?mode=${m}&offset=${o}`; };

  /* Der Knopf wird gesperrt, sobald der nächste Schritt vor die Grenze führt —
     gerechnet vom TATSÄCHLICH gezeigten Zeitraum, nicht vom gewünschten Offset.
     Sonst bliebe er nach dem Klemmen oben aktiv und würde ins Leere zeigen. */
  const backTarget = mode === 'month'
    ? addMonths(mk, -1)
    // Im Wochenmodus zählt der Monat, in dem die vorige Woche BEGINNT.
    : monthKey(addDays(anchor, -7));
  const canGoBack = backTarget >= floorMonth;

  /* Fragen und Antworten werden einmal berechnet und an alle Karten
     weitergegeben: sonst rechnet reviewQuestions dreimal dasselbe. */
  const questions = mode === 'month' ? reviewQuestions(review, state) : [];
  const answers = mode === 'month'
    ? Object.fromEntries(
      (getReviewRecord(state, mk)?.questions ?? []).map((q) => [q.id, q.answer ?? ''])
    )
    : {};

  return el('div', { class: 'view' },
    el('h1', { text: 'Review' }),

    el('div', { class: 'seg', style: 'margin-bottom: var(--space-4)' },
      el('label', { class: 'seg__opt' },
        el('input', {
          type: 'radio', name: 'mode', checked: mode === 'week',
          onchange: () => go('week', 0),
        }),
        el('span', { text: 'Woche' })),
      el('label', { class: 'seg__opt' },
        el('input', {
          type: 'radio', name: 'mode', checked: mode === 'month',
          onchange: () => go('month', 0),
        }),
        el('span', { text: 'Monat' }))),

    el('div', { class: 'pager' },
      el('button', {
        type: 'button', class: 'btn btn--small',
        text: '‹ davor',
        disabled: !canGoBack,
        title: canGoBack ? '' : `Vor ${formatMonth(floorMonth)} gibt es keine Daten.`,
        onclick: () => go(mode, offset - 1),
      }),
      el('span', { class: 'pager__label', text: review.title }),
      el('button', {
        type: 'button', class: 'btn btn--small', text: 'danach ›',
        disabled: offset >= 0,
        onclick: () => go(mode, offset + 1),
      })),

    findingsCard(review),
    numbersCard(review),
    volumeCard(review),

    /* Alles Weitere gehört zum MONAT. Wöchentlich wären die zehn Fragen eine
       Pflichtübung, die nach drei Wochen nicht mehr gemacht wird — und ein
       Kopierblock, den man jede Woche sieht, wird zu Möbel. */
    mode === 'month' ? questionsCard(store, state, review, mk, questions, answers) : null,
    mode === 'month' ? feedbackCard(review, questions, answers) : null,
    mode === 'month' ? exportCard(store, state, review, mk, answers) : null,
    mode === 'month'
      ? panel({ title: 'Zurückimportieren und Archiv', keep: 'review-archiv', tone: 'idle' },
        importCard(store),
        storedCard(state))
      : null,

    mode === 'week'
      ? el('p', { class: 'field__hint' },
        'Kopieren und Dateiexport stehen im Monats-Review — dort, wo sie ',
        'gebraucht werden.')
      : null,

    el('p', { class: 'field__hint' },
      `Schwellen: Schlaf unter ${dec(SHORT_SLEEP_H, 1)} h, Bereitschaft unter `,
      `${LOW_READINESS}, Protein unter 85 % des Ziels. Alle Regeln stehen in `,
      'js/lib/review.js und sind nachlesbar.'));
}
