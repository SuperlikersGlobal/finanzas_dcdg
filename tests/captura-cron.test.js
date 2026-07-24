import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularDesde } from '../netlify/functions/captura-cron.js';

const AHORA = Date.parse('2026-07-24T12:00:00Z');

test('calcularDesde: sin flag → ventana rodante de ~2 días', () => {
  const { since, backfill } = calcularDesde({ backfillDesde: null, ahora: AHORA });
  assert.equal(backfill, false);
  assert.equal(since.toISOString(), '2026-07-22T12:00:00.000Z');
});

test('calcularDesde: con CAPTURA_BACKFILL_DESDE → barrido amplio desde esa fecha', () => {
  const { since, backfill } = calcularDesde({ backfillDesde: '2026-07-01', ahora: AHORA });
  assert.equal(backfill, true);
  assert.equal(since.toISOString(), '2026-07-01T00:00:00.000Z');
});

test('calcularDesde: flag inválido → cae a la ventana rodante', () => {
  const { since, backfill } = calcularDesde({ backfillDesde: 'no-es-fecha', ahora: AHORA });
  assert.equal(backfill, false);
  assert.equal(since.toISOString(), '2026-07-22T12:00:00.000Z');
});
