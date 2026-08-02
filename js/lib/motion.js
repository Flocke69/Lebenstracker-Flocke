/* Die Rechnung hinter der Bewegung — ohne DOM, ohne Zeitgeber, testbar.
 *
 * Warum das hier eine eigene Datei ist und nicht in views/ steht: es sind drei
 * Formeln, an denen sich das ganze Gefühl der App entscheidet, und Formeln
 * prüft man mit Zahlen, nicht mit dem Auge.
 *
 * ─── Warum Federn und keine Übergänge ───────────────────────────────────────
 *
 * Eine CSS-Transition rechnet stur von A nach B über eine feste Dauer. Greift
 * man das Element auf halbem Weg, muss sie abgebrochen und neu gestartet
 * werden — und der neue Lauf beginnt mit Geschwindigkeit null. Das ist die
 * Mauer, gegen die man beim Umkehren einer Bewegung läuft.
 *
 * Eine Feder hat kein Ziel-in-Zeit, sondern einen Zielwert plus einen aktuellen
 * Zustand aus Ort UND Geschwindigkeit. Ein neues Ziel ändert nur den Zielwert;
 * die Geschwindigkeit bleibt, und die Bewegung geht ohne Naht weiter.
 *
 * Zwei Regler statt drei (Masse/Steifigkeit/Dämpfung), wie in Apples
 * Werkzeugkasten:
 *
 *   damping  — Überschwingen. 1.0 = kriecht sauber ans Ziel, kein Nachwippen.
 *              Darunter schwingt es über. Voreinstellung für alles, was NICHT
 *              aus einer Geste kommt.
 *   response — wie schnell der Wert am Ziel ist, in Sekunden. KEINE Dauer:
 *              eine Feder hat keine, die Einschwingzeit ergibt sich.
 *
 * Nachwippen gibt es nur, wenn die Geste selbst Schwung hatte. Ein Menü, das
 * eingeblendet wird, darf nicht nachwippen — da war kein Finger, der es warf.
 */

/**
 * Ein Integrationsschritt der gedämpften Feder (semi-implizites Euler).
 *
 * Semi-implizit und nicht das Lehrbuch-Euler: die neue Geschwindigkeit geht
 * SOFORT in den Ort ein. Das kostet eine Zeile und macht das Verfahren bei
 * schwankender Bildrate stabil — mit dem expliziten Verfahren schaukelt eine
 * straffe Feder bei einem verpassten Bild auf.
 *
 * @param {number} x        aktueller Wert
 * @param {number} v        aktuelle Geschwindigkeit (Einheiten pro Sekunde)
 * @param {number} target   Zielwert
 * @param {number} dt       vergangene Zeit in Sekunden
 * @param {number} damping  Dämpfungsverhältnis (1 = aperiodisch)
 * @param {number} response Antwortzeit in Sekunden
 * @returns {{x: number, v: number}}
 */
export function springStep(x, v, target, dt, damping, response) {
  const omega = (2 * Math.PI) / response;
  const a = -omega * omega * (x - target) - 2 * damping * omega * v;
  const nextV = v + a * dt;
  return { x: x + nextV * dt, v: nextV };
}

/**
 * Wohin gleitet etwas aus, das mit dieser Geschwindigkeit losgelassen wurde?
 *
 * Das ist Apples Projektion aus "Designing Fluid Interfaces", und sie ist
 * NICHT die Formel aus dem Physikbuch (v²/2a). Gebremst wird exponentiell,
 * genau wie beim Scrollen — deshalb dieser Ausdruck.
 *
 * Wozu: eine Wischgeste darf nicht danach beurteilt werden, WO der Finger
 * losgelassen hat, sondern wohin die Bewegung zeigt. Sonst blättert ein
 * kurzer, schneller Schnipser nicht um, obwohl jeder erwartet, dass er es tut.
 *
 * @param {number} velocity     Pixel pro Sekunde beim Loslassen
 * @param {number} deceleration 0.998 fürs normale Scrollgefühl, 0.99 knackiger
 * @returns {number} zurückgelegte Strecke bis zum Stillstand, in Pixeln
 */
export function project(velocity, deceleration = 0.998) {
  return (velocity / 1000) * deceleration / (1 - deceleration);
}

/**
 * Gummiband an einer Kante.
 *
 * Je weiter über die Kante gezogen wird, desto weniger folgt die Fläche. Ein
 * harter Anschlag liest sich als "eingefroren", ein weicher als "reagiert,
 * aber hier ist nichts mehr". Der Rückgabewert ist immer kleiner als die
 * Zugstrecke und läuft gegen `dimension * constant`.
 *
 * @param {number} overshoot Strecke über die Kante hinaus (positiv)
 * @param {number} dimension Größe der Fläche, an der gezogen wird
 * @param {number} constant  0.55 ist der Wert, den iOS benutzt
 */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Geschwindigkeit aus einer kurzen Punktehistorie.
 *
 * Nicht aus dem letzten Bild: zwei aufeinanderfolgende Zeigerereignisse liegen
 * wenige Millisekunden auseinander, und ein einzelner Ausreißer würde die
 * Geschwindigkeit verdoppeln. Gemittelt wird über die Punkte des letzten
 * Zeitfensters — was älter ist, beschreibt nicht mehr, was der Finger GERADE
 * tut.
 *
 * @param {Array<{v: number, t: number}>} points Wert und Zeitstempel (ms)
 * @param {number} now      aktueller Zeitstempel in ms
 * @param {number} windowMs Zeitfenster, das zählt
 * @returns {number} Einheiten pro Sekunde, 0 wenn zu wenig bekannt ist
 */
export function velocityFrom(points, now, windowMs = 100) {
  const recent = points.filter((p) => now - p.t <= windowMs);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return 0;
  return (last.v - first.v) / dt;
}
