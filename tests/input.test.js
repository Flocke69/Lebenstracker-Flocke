import { suite, test, eq, isTrue } from './harness.js';
import { parseDecimal, toInputValue, decimalInput, dayWord } from '../js/views/dom.js';

/* Diese Suite hält einen echten Fehler fest, der beim ersten Durchlauf im
 * Browser aufgefallen ist: die Schlafdauer wurde nicht gespeichert.
 *
 * Ursache war <input type="number">. Ein Zahlenfeld weist nach
 * HTML-Spezifikation jeden Wert ab, der keine gültige Fließkommazahl mit
 * PUNKT ist. Auf einer deutschen Tastatur liegt aber ein Komma auf der
 * Dezimaltaste — aus "7,5" wurde ein leerer Wert, und die Eingabe
 * verschwand stillschweigend.
 */

suite('Eingabe — deutsche Dezimalzahlen', () => {
  test('Komma wird angenommen', () => {
    eq(parseDecimal('7,5'), 7.5);
    eq(parseDecimal('80,4'), 80.4);
    eq(parseDecimal('5,25'), 5.25);
  });

  test('Punkt wird ebenfalls angenommen', () => {
    eq(parseDecimal('7.5'), 7.5);
    eq(parseDecimal('80'), 80);
  });

  test('Leerzeichen stören nicht', () => {
    eq(parseDecimal('  7,5  '), 7.5);
  });

  test('Leer ergibt null, nicht 0', () => {
    eq(parseDecimal(''), null);
    eq(parseDecimal('   '), null);
    eq(parseDecimal(null), null);
    eq(parseDecimal(undefined), null);
  });

  test('Unlesbares ergibt null statt NaN', () => {
    eq(parseDecimal('abc'), null);
    eq(parseDecimal('7,5 kg'), null);
    eq(parseDecimal('--'), null);
  });

  test('negative Zahlen bleiben erhalten — die Prüfung passiert woanders', () => {
    eq(parseDecimal('-3,5'), -3.5);
  });
});

suite('Eingabe — Anzeige im Feld', () => {
  test('Punkt wird zu Komma', () => {
    eq(toInputValue(7.5), '7,5');
    eq(toInputValue(80.4), '80,4');
  });

  test('feste Nachkommastellen auf Wunsch', () => {
    eq(toInputValue(80, 1), '80,0');
    eq(toInputValue(80.44, 1), '80,4');
  });

  test('null und undefined ergeben ein leeres Feld', () => {
    eq(toInputValue(null), '');
    eq(toInputValue(undefined), '');
  });

  test('Hin und zurück ändert den Wert nicht', () => {
    for (const v of [7.5, 80.4, 0, 100, 5.25]) {
      eq(parseDecimal(toInputValue(v)), v, `Rundlauf für ${v}`);
    }
  });
});

suite('Eingabe — das Feld selbst', () => {
  test('decimalInput ist KEIN Zahlenfeld', () => {
    const input = decimalInput({ id: 'probe' });
    eq(input.type, 'text', 'type="number" wuerde das Komma verwerfen');
    eq(input.inputMode, 'decimal', 'trotzdem die Zifferntastatur');
  });

  test('ein echtes Zahlenfeld verwirft das Komma — der Beleg für den Umweg', () => {
    const num = document.createElement('input');
    num.type = 'number';
    num.value = '7,5';
    eq(num.value, '', 'genau hier ging die Schlafdauer verloren');

    const dec = decimalInput({});
    dec.value = '7,5';
    eq(dec.value, '7,5', 'das Textfeld behält den Wert');
  });

  test('decimalInput trägt die Klasse für die Displayschrift', () => {
    isTrue(decimalInput({}).classList.contains('num'));
    isTrue(decimalInput({ class: 'extra' }).classList.contains('extra'));
  });
});

suite('Eingabe — Kleinigkeiten', () => {
  test('dayWord unterscheidet Singular und Plural', () => {
    eq(dayWord(1), 'Tag');
    eq(dayWord(0), 'Tage');
    eq(dayWord(3), 'Tage');
  });
});
