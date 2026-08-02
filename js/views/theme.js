/* Hell oder dunkel — eine Entscheidung, die dem Benutzer gehört.
 *
 * Voreinstellung ist das, was das Gerät sagt. Wer selbst umschaltet, überstimmt
 * das dauerhaft: die eigene Wahl schlägt die Systemwahl, sonst wäre der Knopf
 * eine Empfehlung und keine Einstellung.
 *
 * Der Wert steht in einem EIGENEN Schlüssel, nicht im Zustand der App. Er ist
 * kein Trainingsdatum: er gehört nicht in den Monatsexport, er soll ein
 * Zurücksetzen überleben, und er darf nicht mit einer Sicherung von einem
 * anderen Gerät überschrieben werden.
 */

const KEY = 'lebenstracker.theme';
const VALUES = ['dark', 'light'];

function systemTheme() {
  return globalThis.matchMedia?.('(prefers-color-scheme: light)')?.matches
    ? 'light'
    : 'dark';
}

function stored() {
  try {
    const value = localStorage.getItem(KEY);
    return VALUES.includes(value) ? value : null;
  } catch {
    // Privater Modus: dann eben nur für diese Sitzung.
    return null;
  }
}

/** Was gerade gilt — die eigene Wahl, sonst das Gerät. */
export function currentTheme() {
  return stored() ?? systemTheme();
}

/** Ob der Benutzer selbst entschieden hat (für den Beschriftungstext). */
export function isThemeChosen() {
  return stored() !== null;
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  /* Die Statusleiste des iPhones richtet sich danach — ohne das steht im
     hellen Modus weiße Schrift auf hellem Grund. */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#EDF1EA' : '#0C120F');
}

/** Beim Start aufrufen, bevor gezeichnet wird. */
export function applyStoredTheme() {
  apply(currentTheme());

  /* Wer nie selbst umgeschaltet hat, folgt weiter dem Gerät — auch wenn es
     mitten in der Sitzung wechselt (etwa bei Sonnenuntergang). */
  globalThis.matchMedia?.('(prefers-color-scheme: light)')
    ?.addEventListener?.('change', () => {
      if (!isThemeChosen()) apply(systemTheme());
    });
}

/** Umschalten und merken. Gibt das neue Thema zurück. */
export function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Nicht speicherbar: die Wahl gilt trotzdem für diese Sitzung.
  }
  apply(next);
  return next;
}
