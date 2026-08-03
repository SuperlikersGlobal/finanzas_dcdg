import { test } from 'node:test';
import assert from 'node:assert/strict';
import { padRowsForReplace } from '../netlify/functions/_lib/sheets.js';

// padRowsForReplace es la lógica pura (sin red) detrás de replaceSheetContent:
// rellena con celdas vacías hasta cubrir el tamaño que ya tenía la hoja, para
// que un backup con menos filas/columnas que la corrida anterior deje esas
// celdas sobrantes en blanco (en vez de arrastrar datos viejos).

test('no agrega padding si la hoja nueva es igual o más grande que la anterior', () => {
  const rows = [['a', 'b'], ['c', 'd']];
  const out = padRowsForReplace(rows, 2, 2);
  assert.deepEqual(out, rows);
});

test('agrega filas en blanco hasta cubrir el rowCount anterior', () => {
  const rows = [['a', 'b']];
  const out = padRowsForReplace(rows, 3, 2);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], ['a', 'b']);
  assert.deepEqual(out[1], ['', '']);
  assert.deepEqual(out[2], ['', '']);
});

test('agrega columnas en blanco hasta cubrir el columnCount anterior y pareja todas las filas', () => {
  const rows = [['a'], ['b', 'c', 'd']];
  const out = padRowsForReplace(rows, 0, 5);
  for (const r of out) assert.equal(r.length, 5);
  assert.deepEqual(out[0], ['a', '', '', '', '']);
  assert.deepEqual(out[1], ['b', 'c', 'd', '', '']);
});

test('sin dimensiones previas (hoja nueva), usa el tamaño de los datos', () => {
  const rows = [['x', 'y'], ['z']];
  const out = padRowsForReplace(rows, 0, 0);
  assert.equal(out.length, 2);
  assert.equal(out[0].length, 2);
  assert.equal(out[1].length, 2);
});
