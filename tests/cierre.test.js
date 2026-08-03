import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anioMesDeFecha, crearAsiento } from '../netlify/functions/_lib/asientos.js';
import { setSqlForTests } from '../netlify/functions/_lib/db.js';
import {
  ensureCierresSchema, resetCierresSchemaParaTests, estaPeriodoCerrado, cerrarPeriodo, listPeriodosCerrados,
} from '../netlify/functions/_lib/repo.js';

// ---------------------------------------------------------------------------
// anioMesDeFecha — pura.
// ---------------------------------------------------------------------------
test('anioMesDeFecha: extrae año y mes de YYYY-MM-DD', () => {
  assert.deepEqual(anioMesDeFecha('2026-07-08'), { anio: 2026, mes: 7 });
  assert.deepEqual(anioMesDeFecha('2025-12-31'), { anio: 2025, mes: 12 });
});

test('anioMesDeFecha: rechaza formatos inválidos', () => {
  assert.throws(() => anioMesDeFecha(''), /Fecha inválida/);
  assert.throws(() => anioMesDeFecha('08/07/2026'), /Fecha inválida/);
  assert.throws(() => anioMesDeFecha(null), /Fecha inválida/);
});

// ---------------------------------------------------------------------------
// Capa de datos — Postgres falseado. Verifica el DDL idempotente en runtime
// (modo auto-ok para el esquema) y las operaciones de cierre.
// ---------------------------------------------------------------------------
function fakeDb() {
  const periodos = [];
  let nextId = 1;
  const ddlCalls = [];

  async function query(text, params = []) {
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (t.startsWith('create table')) { ddlCalls.push(t); return []; }
    if (t.startsWith('insert into periodos_cerrados') && t.includes('on conflict')) {
      const [anio, mes, entidad_id, cerrado_por] = params;
      if (periodos.some((p) => p.anio === anio && p.mes === mes && p.entidad_id === entidad_id)) return [];
      const row = { id: nextId++, anio, mes, entidad_id, cerrado_por };
      periodos.push(row);
      return [row];
    }
    if (t.startsWith('select 1 from periodos_cerrados')) {
      const [anio, mes, eid] = params;
      const match = periodos.some((p) => p.anio === anio && p.mes === mes && (p.entidad_id === 0 || p.entidad_id === eid));
      return match ? [{ '?column?': 1 }] : [];
    }
    if (t.startsWith('select * from periodos_cerrados where anio = $1 and mes = $2 and entidad_id')) {
      const [anio, mes, eid] = params;
      return periodos.filter((p) => p.anio === anio && p.mes === mes && p.entidad_id === eid);
    }
    if (t.startsWith('select * from periodos_cerrados where anio')) {
      const [anio] = params;
      return periodos.filter((p) => p.anio === anio);
    }
    if (t.startsWith('select * from periodos_cerrados order')) {
      return periodos.slice();
    }
    return [];
  }

  return { query, _periodos: periodos, _ddlCalls: ddlCalls };
}

test('ensureCierresSchema: crea la tabla, memoizado (no repite el DDL)', async () => {
  resetCierresSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  await ensureCierresSchema();
  const ddlTrasPrimera = db._ddlCalls.length;
  assert.ok(ddlTrasPrimera > 0);

  await ensureCierresSchema();
  assert.equal(db._ddlCalls.length, ddlTrasPrimera);

  setSqlForTests(null);
  resetCierresSchemaParaTests();
});

test('cerrarPeriodo / estaPeriodoCerrado: cierre global cubre cualquier entidad', async () => {
  resetCierresSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  assert.equal(await estaPeriodoCerrado({ anio: 2026, mes: 6 }), false);
  const r = await cerrarPeriodo({ anio: 2026, mes: 6, cerrado_por: 'luis@iwin.im' });
  assert.equal(r.ya_estaba_cerrado, false);
  assert.equal(await estaPeriodoCerrado({ anio: 2026, mes: 6 }), true);
  assert.equal(await estaPeriodoCerrado({ anio: 2026, mes: 6, entidad_id: 42 }), true); // el cierre global cubre todo
  assert.equal(await estaPeriodoCerrado({ anio: 2026, mes: 7 }), false); // otro mes, no afectado

  setSqlForTests(null);
  resetCierresSchemaParaTests();
});

test('cerrarPeriodo: idempotente (cerrar dos veces no falla, avisa que ya estaba)', async () => {
  resetCierresSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  const r1 = await cerrarPeriodo({ anio: 2026, mes: 6 });
  const r2 = await cerrarPeriodo({ anio: 2026, mes: 6 });
  assert.equal(r1.ya_estaba_cerrado, false);
  assert.equal(r2.ya_estaba_cerrado, true);
  assert.equal(db._periodos.length, 1); // no duplica

  setSqlForTests(null);
  resetCierresSchemaParaTests();
});

test('cerrarPeriodo: cerrar una entidad puntual no cierra las demás', async () => {
  resetCierresSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  await cerrarPeriodo({ anio: 2026, mes: 6, entidad_id: 7 });
  assert.equal(await estaPeriodoCerrado({ anio: 2026, mes: 6, entidad_id: 7 }), true);
  assert.equal(await estaPeriodoCerrado({ anio: 2026, mes: 6, entidad_id: 8 }), false);
  assert.equal(await estaPeriodoCerrado({ anio: 2026, mes: 6 }), false); // sin entidad = global, no afectado por el cierre de #7

  setSqlForTests(null);
  resetCierresSchemaParaTests();
});

test('listPeriodosCerrados: filtra por año', async () => {
  resetCierresSchemaParaTests();
  const db = fakeDb();
  setSqlForTests(db);

  await cerrarPeriodo({ anio: 2025, mes: 12 });
  await cerrarPeriodo({ anio: 2026, mes: 6 });
  assert.equal((await listPeriodosCerrados({ anio: 2026 })).length, 1);
  assert.equal((await listPeriodosCerrados({})).length, 2);

  setSqlForTests(null);
  resetCierresSchemaParaTests();
});

// ---------------------------------------------------------------------------
// crearAsiento respeta el cierre — integración con asientos.js.
// ---------------------------------------------------------------------------
function fakeAsientosDb(periodosCerrados = []) {
  const asientos = [];
  let seq = 0;
  return {
    _asientos: asientos,
    async query(text, params = []) {
      const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.startsWith('create table')) return [];
      if (t.startsWith('select codigo, nombre, clase')) {
        return ['1110', '5105'].map((codigo) => ({ codigo, nombre: codigo, clase: 1, naturaleza: 'debito', cuenta_padre: null }));
      }
      if (t.startsWith('select 1 from periodos_cerrados')) {
        const [anio, mes, eid] = params;
        const match = periodosCerrados.some((p) => p.anio === anio && p.mes === mes && (p.entidad_id === 0 || p.entidad_id === eid));
        return match ? [{ '?column?': 1 }] : [];
      }
      if (t.startsWith('insert into asientos')) {
        const row = { id: ++seq, fecha: params[0], descripcion: params[1], origen: params[3], idempotency_key: params[6] };
        asientos.push(row);
        return [row];
      }
      if (t.startsWith('insert into asiento_lineas')) return [];
      return [];
    },
  };
}

const LINEAS_BASE = [{ cuenta: '5105', debito: 100 }, { cuenta: '1110', credito: 100 }];

test('crearAsiento: rechaza un asiento con fecha dentro de un periodo cerrado', async () => {
  resetCierresSchemaParaTests();
  const db = fakeAsientosDb([{ anio: 2026, mes: 6, entidad_id: 0 }]);
  await assert.rejects(
    () => crearAsiento({ fecha: '2026-06-15', descripcion: 'Ajuste tardío', lineas: LINEAS_BASE }, db),
    /periodo 06\/2026 está cerrado/,
  );
  assert.equal(db._asientos.length, 0);
  resetCierresSchemaParaTests();
});

test('crearAsiento: un mes abierto no se ve afectado por el cierre de otro mes', async () => {
  resetCierresSchemaParaTests();
  const db = fakeAsientosDb([{ anio: 2026, mes: 6, entidad_id: 0 }]);
  const r = await crearAsiento({ fecha: '2026-07-01', descripcion: 'Mes siguiente', lineas: LINEAS_BASE }, db);
  assert.equal(r.registrado, true);
  resetCierresSchemaParaTests();
});
