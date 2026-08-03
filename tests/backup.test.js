import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupRows, runBackupCompleto } from '../netlify/functions/_lib/backup.js';

const movimiento = {
  id: 1, fecha: '2026-07-01', tipo: 'gasto', categoria: 'Alimentación', subcategoria: 'Mercado',
  descripcion: 'Éxito', monto: 50000, moneda: 'COP', metodo_pago: 'Tarjeta', quien_pago: 'Luis',
  tarjeta: '1234', cuenta_destino: null, notas: null, origen: 'App', idempotency_key: 'k1',
  creado_en: '2026-07-01T10:00:00Z', actualizado_en: null,
};
const empresaMov = {
  id: 1, empresa: 'Delca2', flujo: 'Empresa → Familia', mes: 'Julio', anio: 2026, concepto: 'Retiro',
  titular: 'Carolina', monto: 100000, moneda: 'COP', estado: 'pagado', origen: 'App',
  movimiento_id: null, creado_en: '2026-07-01T10:00:00Z',
};
const ingreso = {
  id: 1, entidad_id: 2, fecha: '2026-07-01', cedula: 'honorarios', concepto: 'Diseño',
  tercero_id: null, cuenta_id: null, monto: 200000, moneda: 'COP', retencion_fuente: 0,
  actividad: null, notas: null, origen: 'App', idempotency_key: 'i1', creado_en: '2026-07-01T10:00:00Z',
};

test('buildBackupRows arma las 3 secciones con encabezado, título y filas', () => {
  const rows = buildBackupRows(
    { movimientos: [movimiento], empresasMov: [empresaMov], ingresos: [ingreso] },
    new Date('2026-07-07T08:00:00Z')
  );
  const flat = rows.map((r) => r.join('|'));

  assert.ok(flat[0].includes('Backup DB'));
  assert.ok(flat[0].includes('2026-07-07T08:00:00.000Z'));

  assert.ok(flat.includes('# movimientos (1)'));
  assert.ok(flat.some((l) => l.startsWith('id|fecha|tipo|categoria')));
  assert.ok(flat.some((l) => l.includes('Éxito') && l.includes('50000')));

  assert.ok(flat.includes('# empresas_mov (1)'));
  assert.ok(flat.some((l) => l.includes('Delca2') && l.includes('Retiro')));

  assert.ok(flat.includes('# ingresos (1)'));
  assert.ok(flat.some((l) => l.includes('honorarios') && l.includes('Diseño')));
});

test('buildBackupRows con tablas vacías igual arma los encabezados (0 filas)', () => {
  const rows = buildBackupRows({});
  const flat = rows.map((r) => r.join('|'));
  assert.ok(flat.includes('# movimientos (0)'));
  assert.ok(flat.includes('# empresas_mov (0)'));
  assert.ok(flat.includes('# ingresos (0)'));
});

test('buildBackupRows convierte valores null en celdas vacías', () => {
  const rows = buildBackupRows({ movimientos: [movimiento] });
  const fila = rows.find((r) => r[5] === 'Éxito');
  assert.ok(fila);
  // subcategoria va con valor, notas/cuenta_destino/actualizado_en son null -> ''
  const idx = MOV_INDEX('notas');
  assert.equal(fila[idx], '');
});

function MOV_INDEX(col) {
  const cols = ['id', 'fecha', 'tipo', 'categoria', 'subcategoria', 'descripcion', 'monto', 'moneda',
    'metodo_pago', 'quien_pago', 'tarjeta', 'cuenta_destino', 'notas', 'origen',
    'idempotency_key', 'creado_en', 'actualizado_en'];
  return cols.indexOf(col);
}

test('runBackupCompleto lee las 3 tablas (solo lectura) y reemplaza la hoja dedicada (sql y sheet falseados)', async () => {
  const queries = [];
  const fakeSql = {
    query: async (text) => {
      const t = text.replace(/\s+/g, ' ').trim();
      queries.push(t);
      if (t.includes('from movimientos')) return [{ ...movimiento }];
      if (t.includes('from empresas_mov')) return [{ ...empresaMov }];
      if (t.includes('from ingresos')) return [{ ...ingreso }];
      return [];
    },
  };
  let escrito = null;
  const fakeWrite = async (sheetName, rows) => { escrito = { sheetName, rows }; };

  const resultado = await runBackupCompleto(fakeSql, fakeWrite);

  assert.deepEqual(resultado, { ok: true, movimientos: 1, empresas_mov: 1, ingresos: 1 });
  assert.equal(queries.length, 3);
  // Solo lectura: ninguna de las 3 consultas escribe.
  for (const q of queries) assert.ok(/^select/i.test(q));
  // Escribe en la hoja dedicada de backup (no en Registro Gastos/EMPRESAS).
  assert.equal(escrito.sheetName, '⚙️ BACKUP DB');
  assert.ok(Array.isArray(escrito.rows) && escrito.rows.length > 0);
});

test('runBackupCompleto respeta SHEET_BACKUP si está configurado', async () => {
  const prev = process.env.SHEET_BACKUP;
  process.env.SHEET_BACKUP = 'BACKUP TEST';
  try {
    const fakeSql = { query: async () => [] };
    let escrito = null;
    await runBackupCompleto(fakeSql, async (sheetName) => { escrito = sheetName; });
    assert.equal(escrito, 'BACKUP TEST');
  } finally {
    if (prev == null) delete process.env.SHEET_BACKUP; else process.env.SHEET_BACKUP = prev;
  }
});
