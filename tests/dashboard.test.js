import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, periodRangeAnterior, variacionPct } from '../app/src/ui/dashboard.js';

test('periodRangeAnterior: mes en curso → mes calendario anterior completo', () => {
  const hoy = new Date(2026, 6, 15); // 2026-07-15
  const r = periodRangeAnterior('mes', hoy);
  assert.equal(r.desde, '2026-06-01');
  assert.equal(r.hasta, '2026-06-30');
});

test('periodRangeAnterior: mes pasado → dos meses atrás completo', () => {
  const hoy = new Date(2026, 6, 15); // 2026-07-15
  const r = periodRangeAnterior('mespasado', hoy);
  assert.equal(r.desde, '2026-05-01');
  assert.equal(r.hasta, '2026-05-31');
});

test('periodRange: mes en curso → hasta FIN DE MES, no hoy (no oculta movimientos fechados adelante)', () => {
  const hoy = new Date(2026, 6, 15); // 2026-07-15
  const r = periodRange('mes', hoy);
  assert.equal(r.desde, '2026-07-01');
  assert.equal(r.hasta, '2026-07-31'); // incluye p. ej. un recibo fechado 07-28 por desfase UTC
});

test('periodRange: año → cubre todo el año calendario (incluye meses futuros)', () => {
  const hoy = new Date(2026, 6, 9); // 2026-07-09
  const r = periodRange('anio', hoy);
  assert.equal(r.desde, '2026-01-01');
  assert.equal(r.hasta, '2026-12-31'); // hasta fin de año, no solo hoy → registros futuros mal fechados quedan visibles
});

test('periodRangeAnterior: año → mismo tramo del año anterior', () => {
  const hoy = new Date(2026, 6, 15); // 2026-07-15
  const r = periodRangeAnterior('anio', hoy);
  assert.equal(r.desde, '2025-01-01');
  assert.equal(r.hasta, '2025-07-15');
});

test('periodRange y periodRangeAnterior no se superponen (mes en curso)', () => {
  const hoy = new Date(2026, 6, 15);
  const actual = periodRange('mes', hoy);
  const anterior = periodRangeAnterior('mes', hoy);
  assert.ok(anterior.hasta < actual.desde);
});

test('variacionPct: baja de 100 a 80 → -20%', () => {
  assert.equal(variacionPct(80, 100), -20);
});

test('variacionPct: sube de 100 a 150 → +50%', () => {
  assert.equal(variacionPct(150, 100), 50);
});

test('variacionPct: sin base de comparación (anterior 0) → null', () => {
  assert.equal(variacionPct(100, 0), null);
});
