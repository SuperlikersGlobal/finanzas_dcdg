import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCOP,
  formatMoneda,
  parseMonto,
  normalizarFecha,
  corregirAnioProbable,
  mesDeISO,
  ultimos4,
} from '../app/src/utils/formatters.js';

test('formatCOP formatea pesos', () => {
  assert.equal(formatCOP(45000), '$45.000');
  assert.equal(formatCOP(1200000), '$1.200.000');
});

test('formatMoneda: USD con prefijo US$, COP como pesos', () => {
  assert.equal(formatMoneda(3899, 'USD'), 'US$ 3,899');
  assert.equal(formatMoneda(45000, 'COP'), '$45.000');
  assert.equal(formatMoneda(45000, undefined), '$45.000'); // sin moneda → COP
  assert.equal(formatMoneda(3899, 'usd'), 'US$ 3,899'); // case-insensitive
});

test('parseMonto: formato CO con puntos de miles', () => {
  assert.equal(parseMonto('45.000'), 45000);
  assert.equal(parseMonto('1.234.567'), 1234567);
});

test('parseMonto: sufijos mil/k/M', () => {
  assert.equal(parseMonto('120mil'), 120000);
  assert.equal(parseMonto('45k'), 45000);
  assert.equal(parseMonto('1.2M'), 1200000);
});

test('parseMonto: con símbolo $ y espacios', () => {
  assert.equal(parseMonto('$ 45.000'), 45000);
});

test('parseMonto: número simple', () => {
  assert.equal(parseMonto('45000'), 45000);
  assert.equal(parseMonto(45000), 45000);
});

test('parseMonto: inválido → null', () => {
  assert.equal(parseMonto(''), null);
  assert.equal(parseMonto('abc'), null);
});

test('normalizarFecha acepta ISO y DD/MM', () => {
  assert.equal(normalizarFecha('2026-07-04'), '2026-07-04');
  assert.equal(normalizarFecha('4/7', 2026), '2026-07-04');
  assert.equal(normalizarFecha('04/07/2026'), '2026-07-04');
});

test('mesDeISO extrae el mes', () => {
  assert.equal(mesDeISO('2026-07-04'), 7);
});

test('ultimos4 extrae 4 dígitos finales', () => {
  assert.equal(ultimos4('Bcol 0965 tarjeta 2331'), '2331');
  assert.equal(ultimos4('sin numero'), '');
});

test('corregirAnioProbable: recibo fechado ~1 año atrás por error → sube el año', () => {
  // SilvIA leyó "27 de jul" y puso 2025; se registró el 2026-07-28.
  assert.equal(corregirAnioProbable('2025-07-27', new Date(2026, 6, 28)), '2026-07-27');
});

test('corregirAnioProbable: fecha reciente no se toca', () => {
  assert.equal(corregirAnioProbable('2026-07-20', new Date(2026, 6, 28)), '2026-07-20');
});

test('corregirAnioProbable: compra genuina de hace unos meses NO se cambia', () => {
  assert.equal(corregirAnioProbable('2025-12-25', new Date(2026, 6, 28)), '2025-12-25'); // ~215 días
});

test('corregirAnioProbable: fecha muy vieja (>430 días) no se toca', () => {
  assert.equal(corregirAnioProbable('2024-01-01', new Date(2026, 6, 28)), '2024-01-01');
});

test('corregirAnioProbable: no sube el año si quedaría en el futuro', () => {
  // +1 año caería después de hoy → se deja como está.
  assert.equal(corregirAnioProbable('2025-09-01', new Date(2026, 6, 28)), '2025-09-01');
});
