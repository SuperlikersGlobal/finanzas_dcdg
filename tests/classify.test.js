import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByRules, normalize } from '../app/src/config/rules.js';

test('normalize quita acentos y baja a minúsculas', () => {
  assert.equal(normalize('ÉXITO Olímpica'), 'exito olimpica');
});

test('mercado: Éxito → Alimentación/Mercado', () => {
  const r = classifyByRules('Compra en Éxito Barranquilla');
  assert.equal(r.categoria, 'Alimentación');
  assert.equal(r.subcategoria, 'Mercado');
});

test('mercado: Tienda D1 → Mercado', () => {
  assert.equal(classifyByRules('pago tienda d1').subcategoria, 'Mercado');
});

test('transporte: Uber → Uber-Taxi', () => {
  const r = classifyByRules('UBER *TRIP help.uber.com');
  assert.equal(r.categoria, 'Transporte');
  assert.equal(r.subcategoria, 'Uber-Taxi');
});

test('peajes: Flypass vía F2X SAS → Peajes', () => {
  assert.equal(classifyByRules('F2X SAS Flypass').subcategoria, 'Peajes');
});

test('iWin/Jeeves marca iwin_prestamo y método', () => {
  const r = classifyByRules('Pago con Jeeves corporativa');
  assert.equal(r.iwin_prestamo, true);
  assert.equal(r.metodo_pago, 'TC iWin (Superlikers)');
});

test('biofood → gasto de hijos', () => {
  assert.equal(classifyByRules('BIOFOOD SERVICE SAS').categoria, 'Gastos Luhijo-Luciano');
});

test('sin match devuelve null', () => {
  assert.equal(classifyByRules('comercio totalmente desconocido xyz'), null);
});

test('mercado: Tiendas Ara → Mercado (keyword real de comercio)', () => {
  const r = classifyByRules('Compra en Tiendas Ara Cra 15');
  assert.equal(r.categoria, 'Alimentación');
  assert.equal(r.subcategoria, 'Mercado');
});

test('issue #210: "para" no debe matchear la regla de Tiendas Ara', () => {
  const r = classifyByRules(
    'Devolución de préstamo para pagar cuota de medicina prepagada'
  );
  assert.equal(r, null, 'no debe clasificarse como Alimentación/Mercado por la palabra "para"');
});
