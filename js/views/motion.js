/* Federn und Zeigerverfolgung — die Bewegung, die man anfassen kann.
 *
 * Die Rechnung steht in js/lib/motion.js und ist getestet. Hier kommt nur
 * dazu, was ohne Browser nicht geht: ein Bildtakt und ein Zeiger.
 *
 * REGEL FÜR DIE GANZE APP: was der Finger berühren kann, läuft über eine
 * Feder. Was nur ein- und ausblendet, darf eine CSS-Transition bleiben. Der
 * Unterschied ist nicht Geschmack — eine Transition lässt sich nicht mitten
 * im Flug greifen und umdrehen, ohne dass es springt.
 */

import { springStep, velocityFrom } from '../lib/motion.js';

const reduced = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

/**
 * Eine Feder auf einem Zahlenwert.
 *
 * @param {number} value  Startwert
 * @param {object} opts
 * @param {number} [opts.damping=1]    1 = kein Überschwingen. Nachwippen nur,
 *                                     wenn die Geste selbst Schwung hatte.
 * @param {number} [opts.response=0.4] Antwortzeit in Sekunden, keine Dauer
 * @param {number} [opts.epsilon=0.05] Ruhefenster in Werteinheiten
 * @param {Function} opts.onChange     bekommt bei jedem Bild den neuen Wert
 * @param {Function} [opts.onRest]     einmal, wenn die Feder zur Ruhe kommt
 */
export class Spring {
  constructor(value, { damping = 1, response = 0.4, epsilon = 0.05, onChange, onRest = null } = {}) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.damping = damping;
    this.response = response;
    this.epsilon = epsilon;
    this.onChange = onChange;
    this.onRest = onRest;
    this.frame = null;
    this.last = 0;
    this.tick = this.tick.bind(this);
  }

  tick(now) {
    /* Auf eine Dreißigstelsekunde begrenzt. Ohne die Grenze macht die Feder
       nach einem Tab-Wechsel oder einer Verzögerung EINEN riesigen Schritt und
       schießt sichtbar über das Ziel hinaus. */
    const dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;

    const next = springStep(this.x, this.v, this.target, dt, this.damping, this.response);
    this.x = next.x;
    this.v = next.v;

    /* Ruhefenster: Ort UND Geschwindigkeit müssen klein sein. Nur den Ort zu
       prüfen würde die Feder mitten im Durchschwingen anhalten. */
    if (Math.abs(this.x - this.target) < this.epsilon
        && Math.abs(this.v) < this.epsilon * 10) {
      this.x = this.target;
      this.v = 0;
      this.frame = null;
      this.onChange(this.x);
      this.onRest?.();
      return;
    }

    this.onChange(this.x);
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Neues Ziel. Die Geschwindigkeit bleibt — das ist die Übergabe vom Finger
   *  an die Animation, ohne sichtbare Naht. */
  to(target, velocity) {
    this.target = target;
    if (velocity !== undefined) this.v = velocity;

    /* Weniger Bewegung: sofort auf dem Zielwert, aber onRest läuft trotzdem —
       daran hängen Aufräumarbeiten wie das Entfernen eines Fensters. */
    if (reduced()) {
      this.stop();
      this.x = target;
      this.v = 0;
      this.onChange(this.x);
      this.onRest?.();
      return;
    }

    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  /** 1:1 mit dem Finger: Wert direkt setzen, laufende Feder anhalten. */
  set(x) {
    this.stop();
    this.x = x;
    this.v = 0;
    this.onChange(x);
  }

  /** Anhalten, ohne den Wert zu ändern — für den Griff mitten im Flug. */
  stop() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  get isMoving() {
    return this.frame !== null;
  }
}

/**
 * Zeigerverfolgung: merkt sich die letzten Punkte und liefert die
 * Geschwindigkeit beim Loslassen.
 */
export class Tracker {
  constructor(limit = 6) {
    this.points = [];
    this.limit = limit;
  }

  push(value, now = performance.now()) {
    this.points.push({ v: value, t: now });
    if (this.points.length > this.limit) this.points.shift();
  }

  velocity(now = performance.now()) {
    return velocityFrom(this.points, now);
  }

  reset() {
    this.points.length = 0;
  }
}

export { project, rubberband } from '../lib/motion.js';
export { reduced as prefersReducedMotion };
