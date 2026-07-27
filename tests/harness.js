/* Minimales Test-Harness.
 *
 * Es gibt kein node und kein npm in dieser Umgebung, also läuft der
 * Test-Runner im Browser: tests.html lädt die Testdateien als ES-Module,
 * jede registriert ihre Fälle hier, am Ende rendert report() das Ergebnis.
 *
 * Getestet wird ausschließlich js/lib/ — reine Funktionen ohne DOM. Genau
 * dafür ist die Trennung zwischen lib/ und views/ gedacht.
 */

const suites = [];
let current = null;

export function suite(name, fn) {
  current = { name, cases: [] };
  suites.push(current);
  fn();
  current = null;
}

export function test(name, fn) {
  if (!current) throw new Error(`test("${name}") liegt außerhalb einer suite()`);
  const c = { name, error: null };
  current.cases.push(c);
  try {
    fn();
  } catch (err) {
    c.error = err;
  }
}

/* ─── Zusicherungen ──────────────────────────────────────────────────────── */

function fail(msg, actual, expected) {
  const err = new Error(
    `${msg}\n      erwartet: ${format(expected)}\n      erhalten: ${format(actual)}`
  );
  err.assertion = true;
  throw err;
}

function format(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(format).join(', ')}]`;
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function eq(actual, expected, msg = 'Werte stimmen nicht überein') {
  if (actual !== expected) fail(msg, actual, expected);
}

export function deepEq(actual, expected, msg = 'Strukturen stimmen nicht überein') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(msg, actual, expected);
}

/** Gleitkommavergleich. Ohne Toleranz ist jeder Kalorienvergleich sinnlos. */
export function close(actual, expected, tol = 0.01, msg = 'Wert außerhalb der Toleranz') {
  if (typeof actual !== 'number' || Number.isNaN(actual)) {
    fail(`${msg} (kein gültiger Zahlenwert)`, actual, expected);
  }
  if (Math.abs(actual - expected) > tol) {
    fail(`${msg} (Toleranz ±${tol})`, actual, expected);
  }
}

export function isTrue(actual, msg = 'Bedingung nicht erfüllt') {
  if (actual !== true) fail(msg, actual, true);
}

export function isFalse(actual, msg = 'Bedingung sollte falsch sein') {
  if (actual !== false) fail(msg, actual, false);
}

/** Fängt ab, dass fehlende Eingaben stillschweigend zu NaN werden. */
export function isFinite_(actual, msg = 'Wert ist nicht endlich') {
  if (!Number.isFinite(actual)) fail(msg, actual, 'eine endliche Zahl');
}

export function throws(fn, msg = 'Aufruf hätte einen Fehler werfen müssen') {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) fail(msg, 'kein Fehler', 'ein Fehler');
}

/* ─── Bericht ────────────────────────────────────────────────────────────── */

export function report(root) {
  let total = 0;
  let failed = 0;
  const frag = document.createDocumentFragment();

  for (const s of suites) {
    const sFailed = s.cases.filter((c) => c.error).length;
    total += s.cases.length;
    failed += sFailed;

    const section = document.createElement('section');
    section.className = 'suite' + (sFailed ? ' suite--failed' : '');

    const h = document.createElement('h2');
    h.textContent = s.name;
    const count = document.createElement('span');
    count.className = 'suite__count';
    count.textContent = sFailed
      ? `${sFailed} von ${s.cases.length} fehlgeschlagen`
      : `${s.cases.length} bestanden`;
    h.appendChild(count);
    section.appendChild(h);

    const list = document.createElement('ul');
    list.className = 'cases';
    for (const c of s.cases) {
      const li = document.createElement('li');
      li.className = c.error ? 'case case--fail' : 'case case--pass';
      const label = document.createElement('span');
      label.className = 'case__name';
      label.textContent = c.name;
      li.appendChild(label);
      if (c.error) {
        const pre = document.createElement('pre');
        pre.className = 'case__error';
        pre.textContent = c.error.assertion
          ? c.error.message
          : `${c.error.name}: ${c.error.message}`;
        li.appendChild(pre);
      }
      list.appendChild(li);
    }
    section.appendChild(list);
    frag.appendChild(section);
  }

  const summary = document.createElement('div');
  summary.className = 'summary' + (failed ? ' summary--fail' : ' summary--pass');
  summary.innerHTML =
    `<span class="summary__num">${total - failed}/${total}</span>` +
    `<span class="summary__label">${
      failed ? `${failed} fehlgeschlagen` : 'alle bestanden'
    }</span>`;

  root.textContent = '';
  root.appendChild(summary);
  root.appendChild(frag);

  // Für spätere Automatisierung abgreifbar
  window.__testResult = { total, failed, passed: total - failed };
  return failed === 0;
}
