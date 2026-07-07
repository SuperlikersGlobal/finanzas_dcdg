import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCategorias, seedReglas } from '../scripts/seed-config-datos.js';
import { CATS } from '../app/src/config/categories.js';
import { RULES } from '../app/src/config/rules.js';

// ---------------------------------------------------------------------------
// Fake mínimo de Postgres para `categorias`/`reglas`, suficiente para ejercitar
// las consultas que emite el script de siembra (Fase 1.5: config-como-datos).
// ---------------------------------------------------------------------------
function fakeDb() {
  const categorias = [];
  const reglas = [];
  let seq = 0;
  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.startsWith('select categoria, subcategoria from categorias')) return categorias.slice();
    if (t.startsWith('insert into categorias')) {
      const [categoria, subcategoria] = params;
      if (categorias.some((c) => c.categoria === categoria && c.subcategoria === subcategoria)) return [];
      const row = { categoria, subcategoria };
      categorias.push(row);
      return [row];
    }
    if (t.startsWith('select patron, categoria, subcategoria, metodo_pago, iwin_prestamo')) return reglas.slice();
    if (t.startsWith('insert into reglas')) {
      const [patron, categoria, subcategoria, metodo_pago, iwin_prestamo, prioridad] = params;
      const row = { id: ++seq, patron, categoria, subcategoria, metodo_pago, iwin_prestamo, prioridad, activo: true };
      reglas.push(row);
      return [row];
    }
    return [];
  }
  return { query, _categorias: categorias, _reglas: reglas };
}

const totalSubcategorias = Object.values(CATS).reduce((n, subs) => n + subs.length, 0);
const totalKeywords = RULES.reduce((n, r) => n + r.match.length, 0);

test('seedCategorias: carga todas las categoría/subcategoría de CATS en una DB vacía', async () => {
  const db = fakeDb();
  const nuevas = await seedCategorias(db);
  assert.equal(nuevas, totalSubcategorias);
  assert.equal(db._categorias.length, totalSubcategorias);
});

test('seedCategorias: re-correr sobre una DB ya sembrada no duplica nada', async () => {
  const db = fakeDb();
  await seedCategorias(db);
  const segunda = await seedCategorias(db);
  assert.equal(segunda, 0);
  assert.equal(db._categorias.length, totalSubcategorias);
});

test('seedReglas: carga una fila por keyword de RULES en una DB vacía', async () => {
  const db = fakeDb();
  const nuevas = await seedReglas(db);
  assert.equal(nuevas, totalKeywords);
  assert.equal(db._reglas.length, totalKeywords);
  // La prioridad preserva el orden original de RULES (primera regla que
  // matchea gana, igual que con el array hardcodeado).
  const iwin = db._reglas.find((r) => r.patron === 'jeeves');
  assert.equal(iwin.categoria, 'Corporativo');
  assert.equal(iwin.iwin_prestamo, true);
  assert.equal(iwin.prioridad, RULES.findIndex((r) => r.id === 'iwin'));
});

test('seedReglas: re-correr sobre una DB ya sembrada no duplica nada', async () => {
  const db = fakeDb();
  await seedReglas(db);
  const segunda = await seedReglas(db);
  assert.equal(segunda, 0);
  assert.equal(db._reglas.length, totalKeywords);
});
