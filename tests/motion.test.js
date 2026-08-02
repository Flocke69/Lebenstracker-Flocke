/* Die Rechnung hinter der Bewegung.
 *
 * Diese vier Formeln entscheiden, ob sich die App anfühlt wie Papier oder wie
 * ein Formular. Sie sind DOM-frei und damit prüfbar — das ist der Grund, warum
 * sie in js/lib/ stehen und nicht bei den Ansichten.
 */

import { springStep, project, rubberband, velocityFrom } from '../js/lib/motion.js';
import { suite, test, eq, close, isTrue } from './harness.js';

/** Die Feder so lange laufen lassen, wie sie bei 60 Bildern bräuchte. */
function settle(x, v, target, { damping = 1, response = 0.4, steps = 240 } = {}) {
  const dt = 1 / 60;
  const path = [x];
  for (let i = 0; i < steps; i++) {
    const next = springStep(x, v, target, dt, damping, response);
    x = next.x;
    v = next.v;
    path.push(x);
  }
  return { x, v, path };
}

suite('Feder', () => {
  test('kommt am Ziel an und bleibt dort', () => {
    const { x, v } = settle(0, 0, 100);
    close(x, 100, 0.5, 'Endwert liegt nicht auf dem Ziel');
    close(v, 0, 1, 'Feder steht am Ende nicht still');
  });

  test('bei Dämpfung 1 wird das Ziel nicht überschritten', () => {
    const { path } = settle(0, 0, 100);
    const over = path.filter((p) => p > 100.01);
    eq(over.length, 0, 'aperiodisch gedämpfte Feder darf nicht überschwingen');
  });

  test('unter Dämpfung 1 schwingt sie über', () => {
    const { path } = settle(0, 0, 100, { damping: 0.6 });
    isTrue(path.some((p) => p > 100.5), 'zu wenig gedämpfte Feder muss überschwingen');
  });

  test('kürzere Antwortzeit ist früher am Ziel', () => {
    const dt = 1 / 60;
    const run = (response) => {
      let x = 0;
      let v = 0;
      for (let i = 0; i < 18; i++) {          // 0,3 Sekunden
        ({ x, v } = springStep(x, v, 100, dt, 1, response));
      }
      return x;
    };
    isTrue(run(0.25) > run(0.6), 'schnellere Feder muss weiter gekommen sein');
  });

  test('nimmt eine mitgegebene Geschwindigkeit auf', () => {
    // Mit Schwung in Richtung Ziel: nach einem Bild weiter als ohne.
    const withSwing = springStep(0, 500, 100, 1 / 60, 1, 0.4).x;
    const without = springStep(0, 0, 100, 1 / 60, 1, 0.4).x;
    isTrue(withSwing > without, 'Anfangsgeschwindigkeit wurde nicht übernommen');
  });

  test('ein Ziel unter dem Startwert läuft nach unten', () => {
    const { x } = settle(100, 0, 0);
    close(x, 0, 0.5, 'Feder läuft nicht in beide Richtungen');
  });
});

suite('Impulsprojektion', () => {
  test('ohne Geschwindigkeit keine Strecke', () => {
    eq(project(0), 0);
  });

  test('doppelte Geschwindigkeit, doppelte Strecke', () => {
    close(project(1000), 2 * project(500), 0.001, 'Projektion ist nicht linear');
  });

  test('Richtung bleibt erhalten', () => {
    isTrue(project(-800) < 0, 'negative Geschwindigkeit muss nach hinten zeigen');
  });

  test('trägt weiter als die halbe Sekunde Weg', () => {
    /* 800 px/s ergeben knapp 400 px Auslauf. Das ist der Grund, warum ein
       kurzer Schnipser über eine halbe Seite hinweg umblättert. */
    close(project(800), 399.2, 1, 'Auslaufstrecke passt nicht zur Erwartung');
  });

  test('stärkeres Bremsen verkürzt den Weg', () => {
    isTrue(project(800, 0.99) < project(800, 0.998), 'Bremswert wirkt nicht');
  });
});

suite('Gummiband', () => {
  test('am Rand passiert nichts', () => {
    eq(rubberband(0, 400), 0);
  });

  test('folgt immer weniger, je weiter man zieht', () => {
    const a = rubberband(50, 400);
    const b = rubberband(100, 400);
    isTrue(a < b, 'weiter ziehen muss weiter bewegen');
    isTrue(b < 2 * a, 'doppelte Zugstrecke darf nicht doppelt bewegen');
  });

  test('bleibt unter der Zugstrecke', () => {
    for (const d of [10, 100, 500, 2000]) {
      isTrue(rubberband(d, 400) < d, `bei ${d} px folgt die Fläche 1:1 statt gebremst`);
    }
  });

  test('läuft gegen eine Grenze statt ins Unendliche', () => {
    const far = rubberband(100000, 400);
    isTrue(far < 400, 'Gummiband muss gegen eine Grenze laufen');
  });
});

suite('Zeigergeschwindigkeit', () => {
  test('ein einzelner Punkt ergibt keine Geschwindigkeit', () => {
    eq(velocityFrom([{ v: 10, t: 1000 }], 1000), 0);
  });

  test('gleichmäßige Bewegung ergibt ihre Geschwindigkeit', () => {
    const pts = [{ v: 0, t: 1000 }, { v: 50, t: 1050 }, { v: 100, t: 1100 }];
    close(velocityFrom(pts, 1100), 1000, 1, '100 px in 0,1 s sind 1000 px/s');
  });

  test('alte Punkte zählen nicht mehr', () => {
    /* Der Finger lag lange still und hat sich erst zuletzt bewegt. Zählte der
       alte Punkt mit, käme eine viel zu kleine Geschwindigkeit heraus. */
    const pts = [{ v: 0, t: 0 }, { v: 0, t: 900 }, { v: 30, t: 950 }, { v: 60, t: 1000 }];
    close(velocityFrom(pts, 1000), 600, 1, 'Zeitfenster wird nicht beachtet');
  });

  test('Richtung bleibt erhalten', () => {
    const pts = [{ v: 100, t: 1000 }, { v: 0, t: 1100 }];
    isTrue(velocityFrom(pts, 1100) < 0, 'Rückwärtsbewegung muss negativ sein');
  });

  test('zwei Punkte zur selben Zeit ergeben keine Division durch null', () => {
    eq(velocityFrom([{ v: 0, t: 1000 }, { v: 50, t: 1000 }], 1000), 0);
  });
});
