/* Review — vier Fenster, ein Urteil, keine Fragen.
 *
 * Was dieser Screen beantwortet, ist genau eine Frage: PASST DAS. Ganz oben
 * steht die Antwort in einem Wort, darunter liegt sie in vier sortierten
 * Fenstern auseinandergenommen — Gewicht, Essen, Training, Erholung. Jedes
 * Fenster trägt seine Farbe, seine Grafik, seine Zahlen und die Befunde, die
 * dazugehören.
 *
 * ─── Was hier NICHT mehr steht, und warum ──────────────────────────────────
 *
 * DIE ZEHN FRAGEN SIND WEG. Flockes Ansage: unwichtig. Und sie hatte recht —
 * ein Review, das erst durch zehn Freitextfelder am Monatsende entsteht,
 * findet nicht statt. Die App urteilt jetzt selbst (overallVerdict in
 * lib/review.js), aus denselben Regeln, die auch die Befunde erzeugen.
 *
 * DIE KOPIERBLÖCKE SIND WEG. Weder die Übergabe ins Gespräch noch der
 * Datensatz zum Zurückeinlesen. Die Sicherungsdatei bleibt — sie ist die
 * einzige Kopie, die überlebt, wenn iOS den Speicher der Web-App leert. Der
 * Rückweg für eine solche Datei liegt im Archiv, wo er hingehört.
 *
 * DIE LANGE BEFUNDLISTE IST WEG. Sie stand als eigener Block ganz oben und
 * warf Schlaf, Protein und Stillstand in einen Topf. Jeder Befund trägt jetzt
 * ein Thema (FLAG_TOPIC) und steht in seinem Fenster.
 *
 * WAS EINEN MONAT ABHAKT: der Knopf „Monat abhaken" legt den Datensatz ab.
 * Solange der fehlt, erinnert der Heute-Screen weiter (monthReviewDue) — die
 * Erinnerung braucht etwas, das sie beendet.
 */

import { todayKey, weekStartKey, addDays, addMonths, monthKey, formatMonth }
  from '../lib/dates.js';
import {
  weeklyReview, monthlyReview, buildMonthRecord, monthWeekAverages,
  volumeVerdict, progressVerdict, overallVerdict,
} from '../lib/review.js';
import { monthDays, weekKeys } from '../lib/dates.js';
import { getReviewRecord, firstTrackedMonth } from '../lib/state.js';
import { weekCheck, weekEntryDue } from '../lib/weekly.js';
import { buildExport, exportFilename, withExportStamp, hasFreshExport } from '../lib/archive.js';
import { LOW_READINESS, SHORT_SLEEP_H } from '../lib/aggregate.js';
import { MUSCLE_GROUPS } from '../../data/exercises.js';
import { lineChart, barChart } from './chart.js';
import { el, replace, panel, int, dec } from './dom.js';

/* ─── Kleinteile, die jedes Fenster benutzt ──────────────────────────────── */

/**
 * Der Kopf eines Themenfensters: Überschrift links, Urteil als Chip rechts.
 *
 * Die Farbe sitzt an der Karte UND am Chip. Doppelt, mit Absicht: die Kante
 * sieht man beim Scrollen aus dem Augenwinkel, das Wort liest man, wenn man
 * stehen bleibt.
 */
function topicCard(title, verdict, ...children) {
  return el('div', { class: `card card--tone card--${verdict.tone}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: title }),
      el('span', { class: `chip chip--${verdict.tone}`, text: verdict.word })),
    el('p', { class: 'topic__line', text: verdict.line }),
    ...children);
}

/** Eine Reihe Kennzahlen, wie sie in jedem Fenster unter der Grafik steht. */
function numbers(cells) {
  return el('div', { class: 'keynums' },
    cells.map((cell) => el('div', { class: `keynum keynum--${cell.tone ?? 'idle'}` },
      el('span', { class: 'keynum__value' },
        cell.value,
        cell.unit ? el('span', { class: 'keynum__unit', text: cell.unit }) : null),
      el('span', { class: 'keynum__label', text: cell.label }))));
}

/** Die Befunde eines Themas als Stichpunkte. Ohne Befunde: nichts. */
function findings(review, topic, keep) {
  const mine = review.flags.filter((f) => f.topic === topic && f.severity !== 'good');
  if (mine.length === 0) return null;

  const actions = mine.filter((f) => f.action);

  return el('div', null,
    el('ul', { class: 'bullets' },
      mine.map((f) => el('li', { class: `bullets__item bullets__item--${f.tone}` },
        el('span', { class: 'bullets__text' },
          el('b', { text: f.title }),
          ` — ${f.short}`)))),
    actions.length > 0
      ? el('details', { class: 'reveal', dataset: { keep } },
        el('summary', null, el('span', { text: 'Was zu tun ist' })),
        el('div', { class: 'reveal__body' },
          actions.map((f) => el('p', { class: 'reveal__text' },
            el('b', { text: `${f.title}: ` }), f.action))))
      : null);
}

const arrow = (value, unit, digits = 1) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  return `${sign} ${dec(Math.abs(value), digits)}${unit ? ` ${unit}` : ''}`;
};

/* ─── Das Urteil, ganz oben ──────────────────────────────────────────────── */

/**
 * Ein Wort, ein Satz, höchstens drei Gründe.
 *
 * Der Rest des Screens ist die Begründung. Wer nur wissen will, ob etwas zu
 * tun ist, hört hier auf zu lesen — und genau das soll gehen.
 */
function verdictCard(verdict, review) {
  return el('div', { class: `card card--tone card--${verdict.tone} judgement` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Passt das?' }),
      el('span', {
        class: `chip chip--${verdict.tone}`,
        text: `${review.summary.period.dayCount} Tage`,
      })),
    el('p', { class: `judgement__word judgement__word--${verdict.tone}`, text: verdict.word }),
    el('p', { class: 'judgement__line', text: verdict.headline }),

    verdict.reasons.length > 0
      ? el('ul', { class: 'bullets judgement__reasons' },
        verdict.reasons.map((r) => el('li', { class: `bullets__item bullets__item--${r.tone}` },
          el('span', { class: 'bullets__text' },
            el('b', { text: r.title }),
            ` — ${r.short}`))))
      : null,

    verdict.judged
      ? null
      : el('p', { class: 'card__note' },
        'Trag Check-in und Gewicht täglich ein — darunter ist jedes Urteil geraten.'));
}

/* ─── Fenster 1: Gewicht ─────────────────────────────────────────────────── */

/**
 * Der Verlauf, nicht der Tageswert.
 *
 * Die Punkte sind das Rauschen, die Linie ist die Aussage. Bewertet wird
 * ausschließlich die Linie: ein einzelner Morgen sagt über eine Recomp nichts.
 */
function weightCard(review, keys) {
  const w = review.summary.weight;
  const enough = w.measured >= 4;
  const delta = w.delta;

  const verdict = !enough
    ? { tone: 'idle', word: 'zu selten gewogen', line: `Nur ${w.measured} Messungen im Zeitraum — für eine Richtung braucht es mehr.` }
    : !Number.isFinite(delta)
      ? { tone: 'idle', word: 'keine Richtung', line: 'Der geglättete Schnitt hat noch keine zwei Punkte.' }
      : Math.abs(delta) <= 0.4
        ? { tone: 'good', word: 'steht', line: `Der Schnitt hat sich um ${dec(Math.abs(delta), 1)} kg bewegt — das ist Rauschen, keine Richtung.` }
        : delta < 0
          ? { tone: 'good', word: `${dec(delta, 1)} kg`, line: 'Der Schnitt fällt. Bei einer Recomp ist das die gewollte Richtung — solange die Kraft mitgeht.' }
          : { tone: 'ok', word: `+${dec(delta, 1)} kg`, line: 'Der Schnitt steigt. Wenn das nicht gewollt ist, liegt es an den Kalorien.' };

  return topicCard('Gewicht', verdict,
    lineChart({
      keys,
      raw: w.values,
      avg: w.avgSeries,
      title: 'Gewichtsverlauf mit 7-Tage-Schnitt',
      unit: 'kg',
      series: 'weight',
      height: 150,
    }),
    numbers([
      { label: 'zuletzt', value: dec(w.last, 1), unit: 'kg', tone: 'idle' },
      { label: 'Veränderung', value: arrow(delta, 'kg'), unit: '', tone: verdict.tone },
      { label: 'gewogen', value: int(w.measured), unit: `/${review.summary.period.dayCount}`,
        tone: enough ? 'good' : 'bad' },
    ]),
    findings(review, 'weight', 'review-gewicht'));
}

/* ─── Fenster 2: Essen ───────────────────────────────────────────────────── */

/**
 * Die Yazio-Wochenschnitte gegen das Ziel.
 *
 * In der WOCHE sind das vier Zahlen mit vier Urteilen — Kalorien, Protein,
 * Kohlenhydrate, Fett. Im MONAT sind es die Wochen des Monats als Balken:
 * einzelne Wochen sagen mehr als ein Monatsmittel, weil man an ihnen sieht,
 * wann es gekippt ist.
 *
 * Fehlt der Wochenschnitt, wird das GESAGT und nicht mit einem Strich
 * überspielt. Eine leere Zelle liest man als Null.
 */
function foodCard(store, state, review, mode, anchor, navigate) {
  const missing = weekEntryDue(state, todayKey());

  if (mode === 'week') {
    const check = weekCheck(state, anchor);
    const worst = check.fields.reduce((acc, f) =>
      (f.tone === 'bad' ? 'bad' : f.tone === 'ok' && acc !== 'bad' ? 'ok' : acc),
    check.hasEntry ? 'good' : 'idle');

    const verdict = !check.hasEntry
      ? { tone: 'idle', word: 'fehlt', line: 'Für diese Woche steht kein Yazio-Schnitt in der App.' }
      : worst === 'good'
        ? { tone: 'good', word: 'im Ziel', line: 'Alle vier Werte liegen im Rahmen.' }
        : { tone: worst, word: worst === 'bad' ? 'daneben' : 'knapp daneben', line: check.suggestion.reason };

    return topicCard('Essen', verdict,
      el('div', null,
        check.fields.map((f) => el('div', { class: 'macro' },
          el('div', { class: 'macro__head' },
            el('span', { class: 'macro__name', text: f.field.label }),
            el('span', { class: 'macro__value' },
              `${int(f.actual)} ${f.field.unit}`,
              el('span', {
                class: `macro__delta macro__delta--${f.tone}`,
                text: ` ${f.word}`,
              }))),
          el('div', { class: 'macro__track' },
            el('div', {
              class: `macro__fill macro__fill--${f.tone}`,
              style: `width: ${Math.min((f.ratio ?? 0) * 100, 100).toFixed(1)}%`,
            }))))),
      el('p', { class: 'card__note' },
        check.target
          ? `Ziel dieser Woche: ${int(check.target.kcal)} kcal, `
            + `${int(check.target.proteinG)} g Protein pro Tag.`
          : 'Ohne vollständiges Profil gibt es kein Ziel zum Vergleichen.'),
      !check.hasEntry
        ? el('button', {
          type: 'button', class: 'btn btn--primary btn--block',
          text: 'Wochenschnitt eintragen',
          onclick: () => navigate('essen'),
        })
        : null,
      findings(review, 'food', 'review-essen'));
  }

  // Monat: die Wochen des Monats als Balken gegen das Ziel.
  const weeks = monthWeekAverages(state, review.month);
  const entered = weeks.filter((w) => typeof w.kcal === 'number').length;
  const n = review.summary.nutrition;
  const hitRate = n.proteinHitRate;

  const verdict = entered === 0
    ? { tone: 'idle', word: 'fehlt', line: 'Kein einziger Wochenschnitt in diesem Monat — über das Essen lässt sich nichts sagen.' }
    : entered < weeks.length
      ? { tone: 'ok', word: `${entered}/${weeks.length} Wochen`, line: 'Es fehlen Wochenschnitte. Was hier steht, gilt nur für die eingetragenen Wochen.' }
      : !Number.isFinite(hitRate)
        ? { tone: 'idle', word: 'kein Ziel', line: 'Ohne Tagesziele gibt es nichts zu vergleichen.' }
        : hitRate >= 0.7
          ? { tone: 'good', word: 'passt', line: `Protein an ${Math.round(hitRate * 100)} % der Tage erreicht. Das trägt.` }
          : { tone: 'bad', word: 'zu wenig Protein', line: `Nur an ${Math.round(hitRate * 100)} % der Tage erreicht. Unter Defizit ist Protein das, was die Muskeln hält.` };

  return topicCard('Essen', verdict,
    weeks.length > 0
      ? barChart({
        keys: weeks.map((w) => w.weekStart),
        values: weeks.map((w) => w.kcal ?? null),
        title: 'Kalorien je Woche im Monat',
        unit: 'kcal',
        series: 'kcal',
        hint: 'Tippe eine Woche an.',
        refs: Number.isFinite(n.targetKcalAvg)
          ? [{ value: n.targetKcalAvg, label: 'Ziel' }]
          : [],
        height: 130,
      })
      : null,
    numbers([
      { label: 'kcal Ø', value: int(n.kcalAvg), unit: '', tone: 'idle' },
      { label: 'Protein Ø', value: int(n.proteinAvg), unit: 'g', tone: 'idle' },
      { label: 'Protein erreicht', value: Number.isFinite(hitRate) ? `${Math.round(hitRate * 100)}` : '—',
        unit: '%', tone: !Number.isFinite(hitRate) ? 'idle' : hitRate >= 0.7 ? 'good' : 'bad' },
    ]),
    missing.due
      ? el('button', {
        type: 'button', class: 'btn btn--block',
        text: 'Fehlenden Wochenschnitt eintragen',
        onclick: () => navigate('essen'),
      })
      : null,
    findings(review, 'food', 'review-essen'));
}

/* ─── Fenster 3: Training ────────────────────────────────────────────────── */

/**
 * Zwei Fragen an einem Ort: kam genug zusammen, und geht es voran?
 *
 * Die Sätze je Muskelgruppe stehen darunter, aber aufgeklappt — die Frage
 * lautet nicht „wie viele Sätze hat der Trizeps bekommen".
 */
function trainingCard(review) {
  const volume = volumeVerdict(review.summary);
  const progress = progressVerdict(review);
  const t = review.summary.training;

  /* Das schärfere der beiden Urteile färbt das Fenster: ein grüner Rahmen über
     drei stehenden Übungen wäre eine Beschönigung. */
  const rank = { bad: 0, ok: 1, good: 2, idle: 3 };
  const worse = rank[volume.tone] <= rank[progress.tone] ? volume : progress;

  const rows = Object.entries(t.volume)
    .filter(([, sets]) => sets > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;

  return topicCard('Training',
    { tone: worse.tone, word: volume.headline, line: volume.detail },

    el('div', { class: 'twoverdict' },
      el('div', { class: `verdictbox verdictbox--${progress.tone}` },
        el('span', { class: 'verdictbox__label', text: 'Fortschritt' }),
        el('span', { class: 'verdictbox__head', text: progress.headline }),
        el('p', { class: 'verdictbox__text', text: progress.detail }))),

    numbers([
      { label: 'Sätze', value: int(t.sets), unit: '', tone: volume.tone },
      { label: 'Einheiten', value: int(review.summary.logging.daysWithTraining), unit: '',
        tone: t.sessionCount > 0 ? 'good' : 'idle' },
      { label: 'bewegt', value: int(t.tonnage / 1000), unit: 't', tone: 'idle' },
    ]),

    rows.length > 0
      ? el('details', { class: 'reveal', dataset: { keep: 'review-volumen' } },
        el('summary', null, el('span', { text: 'Sätze je Muskelgruppe' })),
        el('div', { class: 'reveal__body' },
          rows.map(([key, sets]) => el('div', { class: 'macro' },
            el('div', { class: 'macro__head' },
              el('span', { class: 'macro__name', text: MUSCLE_GROUPS[key] }),
              el('span', { class: 'macro__value', text: dec(sets, 1) })),
            el('div', { class: 'macro__track' },
              el('div', {
                class: 'macro__fill macro__fill--volume',
                style: `width: ${((sets / max) * 100).toFixed(1)}%`,
              }))))))
      : null,

    findings(review, 'training', 'review-training'));
}

/* ─── Fenster 4: Erholung ────────────────────────────────────────────────── */

/**
 * Schlaf und Bereitschaft — der Hebel, der vor Training und Essen kommt.
 *
 * Gezeigt wird die Bereitschaft als Verlauf, weil man daran die schlechten
 * Strecken sieht; der Schlaf steht als Zahl daneben, weil sein Verlauf ohne
 * die Bereitschaft daneben nichts erklärt.
 */
function recoveryCard(review, keys) {
  const s = review.summary;
  const r = s.readiness;
  const sleep = s.sleep;

  const verdict = r.days === 0
    ? { tone: 'idle', word: 'kein Check-in', line: 'Ohne Check-in gibt es keine Bereitschaft und keine Erklärung für schlechte Tage.' }
    : Number.isFinite(sleep.avg) && sleep.avg < SHORT_SLEEP_H
      ? { tone: 'bad', word: 'Schlaf zu kurz', line: `Ø ${dec(sleep.avg, 1)} Stunden. Das ist der stärkste Hebel, den du hast — vor Training und vor Essen.` }
      : r.lowDays > Math.max(2, r.days * 0.25)
        ? { tone: 'ok', word: 'viele schwache Tage', line: `${r.lowDays} Tage unter ${LOW_READINESS} Punkten. Meist ist das Schlaf, manchmal zu viel Volumen.` }
        : { tone: 'good', word: 'trägt', line: `Ø ${dec(sleep.avg, 1)} h Schlaf, ${r.lowDays} schwache Tage. Das hält.` };

  return topicCard('Erholung', verdict,
    r.values.some((v) => typeof v === 'number')
      ? lineChart({
        keys,
        raw: r.values,
        avg: null,
        title: 'Bereitschaft im Zeitraum',
        unit: '',
        digits: 0,
        series: 'ready',
        fromZero: true,
        maxCap: 100,
        refs: [{ value: LOW_READINESS, label: 'schwach' }],
        height: 140,
      })
      : null,
    numbers([
      { label: 'Schlaf Ø', value: dec(sleep.avg, 1), unit: 'h',
        tone: !Number.isFinite(sleep.avg) ? 'idle'
          : sleep.avg >= 7.5 ? 'good' : sleep.avg >= SHORT_SLEEP_H ? 'ok' : 'bad' },
      { label: 'kurze Nächte', value: int(sleep.nightsShort), unit: '',
        tone: sleep.nights === 0 ? 'idle' : sleep.nightsShort <= 2 ? 'good' : 'ok' },
      { label: 'schwache Tage', value: int(r.lowDays), unit: '',
        tone: r.days === 0 ? 'idle' : r.lowDays <= 2 ? 'good' : r.lowDays <= 5 ? 'ok' : 'bad' },
    ]),
    findings(review, 'recovery', 'review-erholung'));
}

/* ─── Monatsdatei und Abhaken ────────────────────────────────────────────── */

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

/**
 * Sichern und abhaken — die zwei Handlungen am Monatsende.
 *
 * SICHERN ist die wichtigere. iOS kann den Speicher einer Web-App nach
 * längerer Pause leeren; diese Datei ist die einzige Kopie, die das übersteht.
 *
 * ABHAKEN legt den Monat mit seinen Zahlen und dem Urteil ab. Das ist auch
 * das, was die Erinnerung auf dem Heute-Screen beendet — ohne einen
 * Abschluss würde sie ewig weiterfragen.
 */
function monthCard(store, state, review, mk) {
  const slot = el('div');

  /* Die Bestätigung kommt aus dem ZUSTAND, nicht in den Slot: `store.update`
     zeichnet die ganze Ansicht neu, eine Meldung im Slot wäre im selben
     Moment wieder weg. Der Slot bleibt für das, was KEIN Neuzeichnen
     auslöst — Abbruch und Fehler. */
  async function exportFile() {
    replace(slot);
    const stamp = new Date().toISOString();
    try {
      const result = await deliver(buildExport(state, mk, stamp), exportFilename(mk));
      if (!result.ok) {
        replace(slot, el('p', { class: 'field__hint', text: 'Export abgebrochen — nichts gespeichert.' }));
        return;
      }
      store.update((s) => withExportStamp(s, stamp));
    } catch (err) {
      replace(slot, el('div', { class: 'notice notice--error' },
        el('span', { class: 'notice__title', text: 'Export fehlgeschlagen' }),
        err.message));
    }
  }

  const fresh = hasFreshExport(state, mk);
  const done = Boolean(getReviewRecord(state, mk));
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

  return el('div', { class: `card card--tone card--${fresh ? 'good' : 'bad'}` },
    el('div', { class: 'card__head' },
      el('span', { class: 'eyebrow', text: 'Monat abschließen' }),
      el('span', {
        class: `chip chip--${fresh ? 'good' : 'bad'}`,
        text: fresh ? 'gesichert' : 'nicht gesichert',
      })),

    el('p', { class: 'field__hint' },
      'Die Datei enthält jeden Tag im Detail, die verdichteten Zahlen und die ',
      'Wochenschnitte. iOS kann den Speicher von Web-Apps nach längerer Pause ',
      'leeren — diese Datei ist die einzige Kopie, die das übersteht.'),
    el('div', { style: 'height: var(--space-3)' }),

    el('button', {
      type: 'button', class: 'btn btn--primary btn--block',
      text: `${formatMonth(mk)} sichern`,
      onclick: exportFile,
    }),
    el('div', { style: 'height: var(--space-2)' }),
    el('button', {
      type: 'button',
      class: `btn btn--block${done ? ' btn--ghost' : ''}`,
      text: done ? 'abgehakt — noch mal ablegen' : 'Monat abhaken',
      onclick: () => store.saveReview(buildMonthRecord(review, state, new Date().toISOString())),
    }),
    slot,
    el('p', { class: `card__note card__note--${fresh ? 'good' : 'bad'}`, text: exportedText }),
    el('p', { class: 'card__note' },
      done
        ? 'Abgehakt — der Heute-Screen fragt nicht mehr nach diesem Monat.'
        : 'Solange der Monat nicht abgehakt ist, erinnert der Heute-Screen daran.'));
}

/** Was schon abgelegt ist — der Inhalt des zugeklappten Abschnitts. */
function storedList(state) {
  const reviews = [...(state.reviews ?? [])].reverse();

  return el('div', null,
    reviews.length === 0
      ? el('p', { class: 'field__hint' },
        'Noch keiner. Am Monatsende auf „Monat abhaken" — die Zahlen und das ',
        'Urteil bleiben dann hier stehen, auch wenn die Tage längst verdichtet sind.')
      : el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'Monat' }),
            el('th', { text: 'Gewicht' }),
            el('th', { text: 'Sätze' }),
            el('th', { text: 'Urteil' }))),
          el('tbody', null,
            reviews.map((r) => el('tr', null,
              el('td', { text: formatMonth(r.month) }),
              el('td', { text: dec(r.summary?.weight?.last, 1) }),
              el('td', { text: int(r.summary?.training?.sets) }),
              el('td', { text: r.verdict?.word ?? '—' })))))));
}

/* ─── Zusammenbau ────────────────────────────────────────────────────────── */

export function render({ store, navigate }) {
  const state = store.getState();
  const today = todayKey();

  // Welcher Zeitraum? Voreinstellung ist die laufende Woche.
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const mode = params.get('mode') === 'month' ? 'month' : 'week';
  const offset = Number(params.get('offset') ?? 0);

  /* Vor dem ersten erfassten Monat gibt es nichts. Die Knöpfe führen nicht
     dorthin — eine getippte Adresse aber schon, und dann stünde dort eine leere
     Auswertung für einen Monat, den es in der App nicht gibt. Deshalb wird der
     Zeitraum HIER geklemmt und nicht nur der Knopf gesperrt. */
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
  const verdict = overallVerdict(review);

  const go = (m, o) => { location.hash = `#/review?mode=${m}&offset=${o}`; };

  /* Der Knopf wird gesperrt, sobald der nächste Schritt vor die Grenze führt —
     gerechnet vom TATSÄCHLICH gezeigten Zeitraum, nicht vom gewünschten Offset. */
  const backTarget = mode === 'month'
    ? addMonths(mk, -1)
    : monthKey(addDays(anchor, -7));
  const canGoBack = backTarget >= floorMonth;

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

    verdictCard(verdict, review),

    /* Die vier Fenster, immer in derselben Reihenfolge. Sie ist nicht nach
       Wichtigkeit sortiert, sondern nach Ursache: das Gewicht ist das
       Ergebnis, das Essen die Ursache, Training und Erholung die Bedingungen.
       Eine feste Reihenfolge findet man mit dem Daumen wieder — eine, die sich
       nach Dringlichkeit umsortiert, nicht. */
    weightCard(review, keys),
    foodCard(store, state, review, mode, anchor, navigate),
    trainingCard(review),
    recoveryCard(review, keys),

    mode === 'month' ? monthCard(store, state, review, mk) : null,
    mode === 'month'
      ? panel({
        title: 'Abgehakte Monate',
        keep: 'review-archiv',
        chip: String((state.reviews ?? []).length),
      }, storedList(state))
      : null,

    el('p', { class: 'field__hint' },
      `Schwellen: Schlaf unter ${dec(SHORT_SLEEP_H, 1)} h, Bereitschaft unter `,
      `${LOW_READINESS}, Protein an weniger als 70 % der Tage erreicht — ein `,
      'Tag zählt ab 90 % des Ziels. Alle Regeln stehen in js/lib/review.js.'));
}
