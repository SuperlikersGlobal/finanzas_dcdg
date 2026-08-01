import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarMovimientosPorMonto, resetCorreccionSchemaParaTests } from '../netlify/functions/_lib/repo.js';

// SQL falseado: absorbe el DDL de ensureCorreccionSchema y responde el select.
function fakeSql(rows) {
  return {
    query: async (text) => {
      const s = String(text).replace(/\s+/g, ' ').toLowerCase();
      if (/alter table|create table|add column|create index/.test(s)) return [];
      if (/from movimientos/.test(s)) return rows;
      return [];
    },
  };
}

test('buscarMovimientosPorMonto: devuelve los candidatos del select', async () => {
  resetCorreccionSchemaParaTests();
  const rows = [
    { id: 7, fecha: '2026-07-20', tipo: 'gasto', categoria: 'Imprevistos', descripcion: 'TIENDA D1', monto: 26000, quien_pago: 'Luis' },
    { id: 5, fecha: '2026-07-18', tipo: 'gasto', categoria: 'Imprevistos', descripcion: 'OTRO', monto: 26000, quien_pago: 'Luis' },
  ];
  const res = await buscarMovimientosPorMonto({ monto: 26000 }, fakeSql(rows));
  assert.equal(res.length, 2);
  assert.equal(res[0].id, 7);
});

test('buscarMovimientosPorMonto: monto no numérico → []', async () => {
  resetCorreccionSchemaParaTests();
  const res = await buscarMovimientosPorMonto({ monto: 'abc' }, fakeSql([]));
  assert.deepEqual(res, []);
});
