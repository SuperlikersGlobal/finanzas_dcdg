import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reglasConFallback, categoriasConFallback } from '../netlify/functions/_lib/config-datos.js';
import { RULES } from '../app/src/config/rules.js';
import { CATS } from '../app/src/config/categories.js';

// ---------------------------------------------------------------------------
// Fake mínimo de Postgres para `reglas`/`categorias` (Fase 1.5: config-como-datos).
// ---------------------------------------------------------------------------
function fakeDb({ reglas = [], categorias = [], falla = false } = {}) {
  return {
    query: async (text) => {
      if (falla) throw new Error('DB no responde');
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('select patron, categoria, subcategoria, metodo_pago, iwin_prestamo')) return reglas;
      if (t.startsWith('select categoria, subcategoria from categorias')) return categorias;
      return [];
    },
  };
}

test('reglasConFallback: agrupa filas de la DB por (categoria,subcategoria,metodo,iwin) en el shape de RULES', async () => {
  const reglas = [
    { patron: 'tienda d1', categoria: 'Alimentación', subcategoria: 'Mercado', metodo_pago: null, iwin_prestamo: false },
    { patron: 'd1 ', categoria: 'Alimentación', subcategoria: 'Mercado', metodo_pago: null, iwin_prestamo: false },
    { patron: 'jeeves', categoria: 'Corporativo', subcategoria: 'Adelanto Honorarios', metodo_pago: 'TC iWin (Superlikers)', iwin_prestamo: true },
  ];
  const out = await reglasConFallback(fakeDb({ reglas }));
  assert.equal(out.length, 2);
  const mercado = out.find((r) => r.categoria === 'Alimentación');
  assert.deepEqual(mercado.match, ['tienda d1', 'd1 ']);
  const iwin = out.find((r) => r.categoria === 'Corporativo');
  assert.equal(iwin.metodo_pago, 'TC iWin (Superlikers)');
  assert.equal(iwin.iwin_prestamo, true);
});

test('reglasConFallback: tabla vacía (aún no sembrada) → cae a RULES', async () => {
  const out = await reglasConFallback(fakeDb({ reglas: [] }));
  assert.equal(out, RULES);
});

test('reglasConFallback: la consulta falla → cae a RULES', async () => {
  const out = await reglasConFallback(fakeDb({ falla: true }));
  assert.equal(out, RULES);
});

test('categoriasConFallback: agrupa filas de la DB en el shape de CATS', async () => {
  const categorias = [
    { categoria: 'Alimentación', subcategoria: 'Mercado' },
    { categoria: 'Alimentación', subcategoria: 'Restaurante' },
    { categoria: 'Transporte', subcategoria: 'Uber/Taxi' },
  ];
  const out = await categoriasConFallback(fakeDb({ categorias }));
  assert.deepEqual(out, {
    'Alimentación': ['Mercado', 'Restaurante'],
    'Transporte': ['Uber/Taxi'],
  });
});

test('categoriasConFallback: tabla vacía (aún no sembrada) → cae a CATS', async () => {
  const out = await categoriasConFallback(fakeDb({ categorias: [] }));
  assert.equal(out, CATS);
});

test('categoriasConFallback: la consulta falla → cae a CATS', async () => {
  const out = await categoriasConFallback(fakeDb({ falla: true }));
  assert.equal(out, CATS);
});
