import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearViaje, viajeActivo, cerrarViaje, resumenTarjeta, resetViajesSchemaParaTests } from '../netlify/functions/_lib/viajes.js';

// Postgres falseado en memoria para las queries de viajes.
function fakeDb() {
  const viajes = [];
  let seq = 1;
  const query = async (text, params = []) => {
    const t = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (/create table|alter table/.test(t)) return [];
    if (t.startsWith('update viajes set activo=false') && t.includes('where activo and quien')) {
      viajes.filter((v) => v.activo && v.quien === params[0]).forEach((v) => { v.activo = false; });
      return [];
    }
    if (t.startsWith('update viajes set activo=false') && t.includes('where id')) {
      const v = viajes.find((x) => x.id === Number(params[0]));
      if (!v) return [];
      v.activo = false; return [v];
    }
    if (t.startsWith('insert into viajes')) {
      const v = { id: seq++, nombre: params[0], tipo: params[1], quien: params[2], entidad_id: params[3], notas: params[4], activo: true };
      viajes.push(v); return [v];
    }
    if (t.includes('lower(nombre)=lower(')) {
      // Idempotencia de crearViaje: activo + mismo quien + mismo nombre.
      return viajes.filter((v) => v.activo && v.quien === params[0]
        && String(v.nombre).toLowerCase() === String(params[1]).toLowerCase()).slice(-1);
    }
    if (t.includes('from viajes where activo and quien')) {
      return viajes.filter((v) => v.activo && v.quien === params[0]).slice(-1);
    }
    if (t.includes('from viajes where activo')) {
      return viajes.filter((v) => v.activo).slice(-1);
    }
    return [];
  };
  return { query, viajes };
}

test('crearViaje: normaliza el tipo (familiar → personal)', async () => {
  resetViajesSchemaParaTests();
  const db = fakeDb();
  const v1 = await crearViaje({ nombre: 'Bogotá', tipo: 'negocios', quien: 'Luis' }, db);
  assert.equal(v1.tipo, 'negocios');
  const v2 = await crearViaje({ nombre: 'Playa', tipo: 'familiar', quien: 'Luis' }, db);
  assert.equal(v2.tipo, 'personal');
});

test('crearViaje idempotente: re-iniciar el mismo nombre activo NO abre duplicado', async () => {
  resetViajesSchemaParaTests();
  const db = fakeDb();
  const v1 = await crearViaje({ nombre: 'Nicaragua y México', quien: 'Luis' }, db);
  const v2 = await crearViaje({ nombre: 'nicaragua y mexico'.replace('mexico', 'méxico'), quien: 'Luis' }, db);
  // Mismo nombre (case-insensitive) → devuelve el existente, marca _ya_existia, no crea otro.
  assert.equal(v2.id, v1.id);
  assert.equal(v2._ya_existia, true);
  assert.equal(db.viajes.length, 1);
  assert.equal(db.viajes.filter((v) => v.activo).length, 1);
});

test('un solo viaje activo por persona: iniciar otro cierra el anterior', async () => {
  resetViajesSchemaParaTests();
  const db = fakeDb();
  await crearViaje({ nombre: 'Viaje A', quien: 'Luis' }, db);
  await crearViaje({ nombre: 'Viaje B', quien: 'Luis' }, db);
  const activo = await viajeActivo('Luis', db);
  assert.equal(activo.nombre, 'Viaje B');
  assert.equal(db.viajes.filter((v) => v.quien === 'Luis' && v.activo).length, 1);
});

test('cerrarViaje: cierra el activo de la persona', async () => {
  resetViajesSchemaParaTests();
  const db = fakeDb();
  await crearViaje({ nombre: 'Viaje C', quien: 'Carolina' }, db);
  const cerrado = await cerrarViaje({ quien: 'Carolina' }, db);
  assert.equal(cerrado.nombre, 'Viaje C');
  assert.equal(await viajeActivo('Carolina', db), null);
});

test('resumenTarjeta: filtra Jeeves/iWin, aplica rango y separa por beneficiario', async () => {
  resetViajesSchemaParaTests();
  const calls = [];
  const db = {
    query: async (text, params = []) => {
      const t = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
      if (/create table|alter table/.test(t)) return [];
      calls.push({ t, params });
      if (t.includes('group by 1,2 order by 3')) {
        return [
          { beneficiario: 'Empresa (iWin)', moneda: 'USD', monto: 800, n: 1 },
          { beneficiario: 'Familia (personal)', moneda: 'COP', monto: 120000, n: 2 },
        ];
      }
      if (t.includes('group by 1,2,3 order by 4')) return [{ beneficiario: 'Empresa (iWin)', categoria: 'Transporte', moneda: 'USD', monto: 800, n: 1 }];
      return [{ id: 5, beneficiario: 'Empresa (iWin)', monto: 800 }];
    },
  };
  const r = await resumenTarjeta({ desde: '2026-07-01', hasta: '2026-07-31' }, db);
  // Sólo movimientos con la tarjeta Jeeves/iWin, con el rango de fechas aplicado.
  const agg = calls.find((c) => c.t.includes('group by 1,2 order by 3'));
  assert.ok(agg.t.includes('jeeves') && agg.t.includes('iwin'));
  assert.deepEqual(agg.params, ['2026-07-01', '2026-07-31']);
  assert.equal(r.por_beneficiario.length, 2);
  assert.equal(r.por_beneficiario[0].beneficiario, 'Empresa (iWin)');
  assert.equal(r.desde, '2026-07-01');
});
