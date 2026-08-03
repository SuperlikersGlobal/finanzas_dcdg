import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyByRules, normalize } from '../app/src/config/rules.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import { clasificar } from '../netlify/functions/_lib/classify.js';

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

test('classifyByRules acepta una lista de reglas inyectada (Fase 1.5: reglas desde la DB)', () => {
  const reglasCustom = [
    { id: 'x', match: ['patronsoloaqui'], categoria: 'CategoriaCustom', subcategoria: 'SubCustom' },
  ];
  // Con la lista custom, matchea la regla custom (que no existe en RULES).
  assert.equal(classifyByRules('compra en PatronSoloAqui hoy', reglasCustom).categoria, 'CategoriaCustom');
  // Con RULES (default), ese patrón no existe → null.
  assert.equal(classifyByRules('compra en PatronSoloAqui hoy'), null);
});

// ---------------------------------------------------------------------------
// Fase 1.5 (config-como-datos): `clasificar()` lee las reglas de Postgres
// primero (vía `_lib/config-datos.js`), con `RULES` como semilla/fallback si
// la DB no responde o la tabla `reglas` aún está vacía (no sembrada).
// ---------------------------------------------------------------------------

test('clasificar: usa las reglas de la DB cuando responden (config-como-datos)', async () => {
  const filas = [
    { patron: 'superexotic123', categoria: 'CategoriaSoloDB', subcategoria: 'SubDB', metodo_pago: null, iwin_prestamo: false },
  ];
  const fakeDb = {
    query: async (text) => {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t.startsWith('select patron, categoria, subcategoria, metodo_pago, iwin_prestamo')) return filas;
      return [];
    },
  };
  setSqlForTests(fakeDb);
  try {
    const r = await clasificar('Compra en SuperExotic123 tienda', { usarModelo: false });
    assert.equal(r.categoria, 'CategoriaSoloDB');
    assert.equal(r.subcategoria, 'SubDB');
    assert.equal(r.fuente, 'reglas');
    // Ese patrón no existe en RULES: prueba que sí vino de la DB, no del fallback.
    assert.equal(classifyByRules('Compra en SuperExotic123 tienda'), null);
  } finally {
    setSqlForTests(null);
  }
});

test('clasificar: tabla `reglas` vacía (aún no sembrada) → cae a RULES hardcodeadas', async () => {
  const fakeDb = { query: async () => [] };
  setSqlForTests(fakeDb);
  try {
    const r = await clasificar('Compra en Éxito Barranquilla', { usarModelo: false });
    assert.equal(r.categoria, 'Alimentación');
    assert.equal(r.subcategoria, 'Mercado');
  } finally {
    setSqlForTests(null);
  }
});

test('clasificar: la consulta a la DB falla (error de red) → cae a RULES hardcodeadas', async () => {
  const fakeDb = { query: async () => { throw new Error('DB caída'); } };
  setSqlForTests(fakeDb);
  try {
    const r = await clasificar('UBER *TRIP help.uber.com', { usarModelo: false });
    assert.equal(r.categoria, 'Transporte');
    assert.equal(r.subcategoria, 'Uber-Taxi');
  } finally {
    setSqlForTests(null);
  }
});

test('clasificar: sin DATABASE_URL configurada (hoy en CI/local), sigue clasificando con RULES', async () => {
  const r = await clasificar('BIOFOOD SERVICE SAS', { usarModelo: false });
  assert.equal(r.categoria, 'Gastos Luhijo-Luciano');
});
